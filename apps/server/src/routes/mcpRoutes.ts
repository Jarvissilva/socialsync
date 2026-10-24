import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import type { DB } from "../database.js";
import { createMcpServer } from "../mcp/server.js";

export function mcpRouter(db: DB, config: Config) {
  const router = Router();
  router.all("/", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
      return;
    }
    // Each request owns its protocol state; durable publishing state stays in
    // the existing services/database. No sessions or extra worker are created.
    const server = createMcpServer(db, config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 1024 * 1024,
    });
    res.once("close", () => {
      void server.close().catch(() => {
        console.error("MCP request cleanup failed. Internal details withheld.");
      });
    });
    try {
      await server.connect(transport);
      // Let the MCP SDK parse and validate JSON-RPC, headers, and body limits.
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent)
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "The MCP request could not be completed.",
          },
          id: null,
        });
    }
  });
  return router;
}
