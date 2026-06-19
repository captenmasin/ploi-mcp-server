#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PloiClient, VERSION, registerPloiTools } from "./tools.js";

function requireApiToken(): string {
  const token = process.env.PLOI_API_TOKEN;

  if (!token) {
    throw new Error("PLOI_API_TOKEN is required to start the Ploi.io MCP server.");
  }

  return token;
}

async function main(): Promise<void> {
  const client = new PloiClient({
    apiToken: requireApiToken(),
    baseUrl: process.env.PLOI_API_BASE_URL,
    userAgent: process.env.PLOI_USER_AGENT,
  });

  const server = new McpServer({
    name: "ploi-mcp-server",
    version: VERSION,
  });

  registerPloiTools(server, client);

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
