import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { timingSafeEqual, createHash } from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { registerListChannels } from "./tools/list_channels.js";
import { registerGetChannelMessages } from "./tools/get_channel_messages.js";
import { registerGetThreadReplies } from "./tools/get_thread_replies.js";

// Hash both values to a fixed-length buffer before constant-time compare,
// since timingSafeEqual requires equal-length buffers.
function timingSafeStringEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function bearerAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.MCP_SERVER_AUTH_TOKEN ?? "";
  if (expected === "") {
    res.status(500).json({ error: "Server misconfigured: MCP_SERVER_AUTH_TOKEN not set" });
    return;
  }
  const authHeader = (req.headers["authorization"] as string | undefined) ?? "";
  const match = /^Bearer (.+)$/.exec(authHeader);
  const provided = match ? match[1] : "";

  if (!timingSafeStringEqual(provided, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function createMcpServer(upstreamToken: string): McpServer {
  const server = new McpServer({
    name: "slack-patron-mcp",
    version: "1.0.0",
  });
  registerListChannels(server, upstreamToken);
  registerGetChannelMessages(server, upstreamToken);
  registerGetThreadReplies(server, upstreamToken);
  return server;
}

export function createApp(): Express {
  // host: "0.0.0.0" skips localhost-only DNS rebinding protection so that
  // nginx-proxied Host headers are not rejected.
  // Bearer token auth provides equivalent protection.
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok" });
  });

  app.post(
    "/mcp",
    bearerAuthMiddleware,
    async (req: Request, res: Response): Promise<void> => {
      const upstreamToken = process.env.SLACK_PATRON_API_TOKEN ?? "";
      const server = createMcpServer(upstreamToken);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: no session tracking
      });

      try {
        await server.connect(transport);
        // req.body is pre-parsed JSON by express.json() inside createMcpExpressApp
        await transport.handleRequest(req, res, req.body);
        res.on("close", () => {
          transport.close();
          server.close();
        });
      } catch {
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    }
  );

  app.get("/mcp", (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  app.delete("/mcp", (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  return app;
}
