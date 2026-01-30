#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { OpenTacoClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";

async function main() {
  // Load and validate configuration
  const config = loadConfig();

  // Create the API client
  const client = new OpenTacoClient(config);

  // Create MCP server
  const server = new McpServer({
    name: "opentaco",
    version: "0.1.0",
  });

  // Register all tools
  registerAllTools(server, client);

  // Connect via STDIO transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Failed to start OpenTaco MCP server:", error);
  process.exit(1);
});
