#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CineMindClient } from "./client.js";
import { createMcpServer } from "./server.js";

/**
 * Local MCP server for Claude Desktop, Claude Code and other clients that
 * launch servers as a subprocess. It talks to a running CineMind API.
 * Logs go to stderr: stdout carries the protocol.
 */
const apiUrl = process.env.CINEMIND_API_URL ?? "http://localhost:4000";
const token = process.env.CINEMIND_API_TOKEN;
if (!token) {
  console.error("CINEMIND_API_TOKEN is required");
  process.exit(1);
}

const server = createMcpServer(new CineMindClient(apiUrl, token), {
  allowWrites: process.env.CINEMIND_MCP_ALLOW_WRITES === "true",
});
await server.connect(new StdioServerTransport());
console.error(`cinemind-mcp connected to ${apiUrl}`);
