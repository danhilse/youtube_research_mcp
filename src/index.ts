#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from 'googleapis';
import chalk from 'chalk';
import dotenv from 'dotenv';

dotenv.config();

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

interface VideoInfo {
  id: string;
  title: string;
  duration: string;
}

interface SearchResult {
  searchQuery: string;
  shorts: VideoInfo[];
  longVideos: VideoInfo[];
}

interface ResearchState {
  topic: string;
  currentQueryIndex: number;
  searchQueries: string[];
  results: SearchResult[];
  isComplete: boolean;
}

class YouTubeResearchServer {
  private state: ResearchState | null = null;

  private formatProgress(message: string, step: number, total: number): string {
    const header = `Step ${step}/${total}: ${message}`;
    const border = '='.repeat(Math.max(header.length, message.length) + 4);
    return `${chalk.blue(border)}\n${chalk.yellow(header)}\n${chalk.blue(border)}`;
  }

  private async searchYouTube(query: string): Promise<{
    shorts: VideoInfo[];
    longVideos: VideoInfo[];
  }> {
    const response = await youtube.search.list({
      part: ['id', 'snippet'],
      q: query,
      type: ['video'],
      videoDefinition: 'high',
      maxResults: 50,
    });

    if (!response.data.items) {
      return { shorts: [], longVideos: [] };
    }

    const videoIds = response.data.items
      .map(item => item.id?.videoId)
      .filter((id): id is string => id !== null && id !== undefined);
    
    if (videoIds.length === 0) {
      return { shorts: [], longVideos: [] };
    }

    const videoDetails = await youtube.videos.list({
      part: ['contentDetails', 'snippet'],
      id: videoIds
    });

    const shorts: VideoInfo[] = [];
    const longVideos: VideoInfo[] = [];

    if (!videoDetails.data || !videoDetails.data.items) {
      return { shorts, longVideos };
    }

    for (const video of videoDetails.data.items) {
      if (!video.id || !video.contentDetails?.duration) continue;

      const duration = video.contentDetails.duration;
      const durationSecs = this.parseDuration(duration);

      const videoInfo = {
        id: video.id,
        title: video.snippet?.title || 'Untitled',
        duration: duration
      };

      if (durationSecs <= 30 && shorts.length < 4) {
        shorts.push(videoInfo);
      } else if (durationSecs > 30 && durationSecs <= 1500 && longVideos.length < 2) {
        longVideos.push(videoInfo);
      }

      // Break if we have enough videos
      if (shorts.length === 4 && longVideos.length === 2) {
        break;
      }
    }

    return {
      shorts,
      longVideos
    };
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');
    
    return hours * 3600 + minutes * 60 + seconds;
  }

  public async startResearch(topic: string, queries: string[]): Promise<{ 
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
    try {
      // Initialize new research state
      this.state = {
        topic,
        searchQueries: queries,
        currentQueryIndex: 0,
        results: [],
        isComplete: false
      };

      console.error(this.formatProgress(
        `Starting research on: ${topic}`,
        1,
        queries.length + 1
      ));

      // Perform first search
      const firstQuery = queries[0];
      console.error(this.formatProgress(
        `Searching for: ${firstQuery}`,
        2,
        queries.length + 1
      ));

      const firstResults = await this.searchYouTube(firstQuery);
      this.state.results.push({
        searchQuery: firstQuery,
        ...firstResults
      });
      this.state.currentQueryIndex = 1;

      const hasMoreQueries = this.state.currentQueryIndex < this.state.searchQueries.length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "in_progress",
            currentQuery: firstQuery,
            results: firstResults,
            remainingQueries: hasMoreQueries ? queries.slice(1) : [],
            hasMoreQueries,
            progress: {
              current: 1,
              total: queries.length
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error in startResearch:', error);
      this.state = null;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  public async continueResearch(): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> {
    if (!this.state) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: "No research in progress",
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }

    try {
      const currentQuery = this.state.searchQueries[this.state.currentQueryIndex];
      
      if (!currentQuery) {
        // Research is complete
        const finalResults = [...this.state.results];
        this.state.isComplete = true;
        
        console.error(this.formatProgress(
          'Research complete!',
          this.state.searchQueries.length + 1,
          this.state.searchQueries.length + 1
        ));

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "complete",
              topic: this.state.topic,
              results: finalResults,
              totalQueries: this.state.searchQueries.length,
              totalVideos: finalResults.reduce((acc, result) => 
                acc + result.shorts.length + result.longVideos.length, 0
              )
            }, null, 2)
          }]
        };
      }

      // Perform next search
      console.error(this.formatProgress(
        `Searching for: ${currentQuery}`,
        this.state.currentQueryIndex + 2,
        this.state.searchQueries.length + 1
      ));

      const results = await this.searchYouTube(currentQuery);
      
      this.state.results.push({
        searchQuery: currentQuery,
        ...results
      });
      this.state.currentQueryIndex++;

      const hasMoreQueries = this.state.currentQueryIndex < this.state.searchQueries.length;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "in_progress",
            currentQuery,
            results,
            remainingQueries: hasMoreQueries ? 
              this.state.searchQueries.slice(this.state.currentQueryIndex) : [],
            hasMoreQueries,
            progress: {
              current: this.state.currentQueryIndex,
              total: this.state.searchQueries.length
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('Error in continueResearch:', error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            status: 'failed'
          }, null, 2)
        }],
        isError: true
      };
    }
  }
}

const RESEARCH_TOOL: Tool = {
  name: "youtube-research",
  description: "Search YouTube (Shorts under 1 min and long form 1-35 min) for a topic",
  inputSchema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Search query for YouTube"
      },
      queries: {
        type: "array",
        description: "List of 2-4 search queries to use",
        items: {
          type: "string"
        },
        minItems: 2,
        maxItems: 4
      }
    },
    required: ["topic", "queries"]
  }
};

const server = new Server(
  {
    name: "youtube-research-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const researchServer = new YouTubeResearchServer();

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [RESEARCH_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "youtube-research") {
    const { topic, queries } = request.params.arguments || {};
    
    if (!topic || typeof topic !== 'string' || !Array.isArray(queries)) {
      return {
        content: [{
          type: "text",
          text: "Missing required parameters: topic (string) and queries (string[])"
        }],
        isError: true
      };
    }

    if (queries.length < 2 || queries.length > 4) {
      return {
        content: [{
          type: "text",
          text: "Must provide between 2 and 4 search queries"
        }],
        isError: true
      };
    }

    if (queries.some(q => typeof q !== 'string')) {
      return {
        content: [{
          type: "text",
          text: "All queries must be strings"
        }],
        isError: true
      };
    }

    return researchServer.startResearch(topic, queries);
  }

  return {
    content: [{
      type: "text",
      text: `Unknown tool: ${request.params.name}`
    }],
    isError: true
  };
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("YouTube Research MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});