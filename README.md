# My YouTube MCP Server

This MCP server integrates:

- **Sequential Thinking**: Logs each step as separate "thoughts" to provide visibility into the server's operations.
- **YouTube Aggregated Search**: 
  - **Sampling**: Uses MCP's sampling mechanism to generate search queries based on user topics.
  - **YouTube API Integration**: Fetches short and long videos for each search query.
  - **Result Aggregation**: Compiles and returns video IDs with metadata.

## Setup Instructions

1. **Clone the Repository**

   ```bash
   git clone https://github.com/yourusername/my-youtube-server.git
   cd my-youtube-server