import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { timingSafeEqual, createHash, createHmac } from "crypto";
import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { registerListChannels } from "./tools/list_channels.js";
import { registerListUsers } from "./tools/list_users.js";
import { registerGetUserInfo } from "./tools/get_user_info.js";
import { registerGetChannelMessages } from "./tools/get_channel_messages.js";
import { registerGetChannelMessagesRaw } from "./tools/get_channel_messages_raw.js";
import { registerGetThreadReplies } from "./tools/get_thread_replies.js";
import { registerGetThreadRepliesRaw } from "./tools/get_thread_replies_raw.js";
import { registerPostMessage } from "./tools/post_message.js";
import { registerSearchMessages } from "./tools/search_messages.js";
import { registerDownloadFile } from "./tools/download_file.js";

// Hash both values to a fixed-length buffer before constant-time compare,
// since timingSafeEqual requires equal-length buffers.
function timingSafeStringEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function generateCode(payload: object): string {
  const secret = process.env.MCP_SERVER_AUTH_TOKEN ?? "default-secret";
  const serialized = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(serialized).digest("base64url");
  return `${serialized}.${signature}`;
}

function verifyCode(code: string): any {
  const secret = process.env.MCP_SERVER_AUTH_TOKEN ?? "";
  if (!secret) return null;
  const parts = code.split(".");
  if (parts.length !== 2) return null;
  const [serialized, signature] = parts;
  
  const expectedSignature = createHmac("sha256", secret).update(serialized).digest("base64url");
  
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  
  try {
    const decoded = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8"));
    if (decoded.exp && Date.now() / 1000 > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function generateJwt(payload: object): string {
  const secret = process.env.MCP_SERVER_AUTH_TOKEN ?? "default-secret";
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token: string): any {
  const secret = process.env.MCP_SERVER_AUTH_TOKEN ?? "";
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  
  const expectedSignature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
    
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.exp && Date.now() / 1000 > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
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

  // 1. Try validating as a JWT (issued by OAuth)
  const decoded = verifyJwt(provided);
  if (decoded) {
    next();
    return;
  }

  // 2. Try validating as the raw bearer token (legacy client compatibility)
  if (timingSafeStringEqual(provided, expected)) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

function createMcpServer(upstreamToken: string, slackToken: string): McpServer {
  const server = new McpServer({
    name: "slack-patron-mcp",
    version: "1.0.0",
  });
  registerListChannels(server, upstreamToken);
  registerListUsers(server, upstreamToken);
  registerGetUserInfo(server, upstreamToken);
  registerGetChannelMessages(server, upstreamToken);
  registerGetChannelMessagesRaw(server, upstreamToken);
  registerGetThreadReplies(server, upstreamToken);
  registerGetThreadRepliesRaw(server, upstreamToken);
  registerPostMessage(server, slackToken);
  registerSearchMessages(server, upstreamToken);
  registerDownloadFile(server, slackToken);
  return server;
}

function renderAuthorizePage(
  res: Response,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  resource: string,
  error: string
): void {
  const errorHtml = error
    ? `<div class="error-message">${error}</div>`
    : "";

  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize Claude - Slack Patron MCP</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-gradient: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      --card-bg: rgba(30, 41, 59, 0.7);
      --border-color: rgba(255, 255, 255, 0.08);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent-color: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      --accent-hover: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
      --danger-color: #ef4444;
      --success-color: #10b981;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-gradient);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border-color);
      border-radius: 24px;
      padding: 40px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
      animation: fadeIn 0.6s ease-out;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .logo-container {
      margin-bottom: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: 16px;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    
    .logo-icon {
      width: 32px;
      height: 32px;
      color: #818cf8;
    }
    
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 32px;
      line-height: 1.5;
    }
    
    .form-group {
      margin-bottom: 24px;
      text-align: left;
    }
    
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    input[type="password"] {
      width: 100%;
      padding: 14px 16px;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      color: var(--text-primary);
      font-size: 15px;
      transition: all 0.3s ease;
    }
    
    input[type="password"]:focus {
      outline: none;
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    }
    
    button {
      width: 100%;
      padding: 14px;
      background: var(--accent-color);
      border: none;
      border-radius: 12px;
      color: white;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }
    
    button:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
    }
    
    button:active {
      transform: translateY(0);
    }
    
    .error-message {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: #f87171;
      padding: 12px;
      border-radius: 12px;
      font-size: 14px;
      margin-bottom: 24px;
      text-align: left;
      line-height: 1.4;
    }
    
    .meta-info {
      margin-top: 32px;
      font-size: 12px;
      color: var(--text-secondary);
      border-top: 1px solid var(--border-color);
      padding-top: 20px;
    }
    
    code {
      background: rgba(0, 0, 0, 0.2);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <svg class="logo-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </div>
    <h1>Slack Patron MCP</h1>
    <p class="subtitle">Claude コネクタへのアクセスを認可します。設定されている Bearer Token を入力してください。</p>
    
    ${errorHtml}
    
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${clientId}">
      <input type="hidden" name="redirect_uri" value="${redirectUri}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="code_challenge" value="${codeChallenge}">
      <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod}">
      <input type="hidden" name="resource" value="${resource}">
      
      <div class="form-group">
        <label for="password">Bearer Token</label>
        <input type="password" id="password" name="password" placeholder="••••••••••••••••" required autofocus>
      </div>
      
      <button type="submit">アクセスを認可する</button>
    </form>
    
    <div class="meta-info">
      Client ID: <code>${clientId || "N/A"}</code>
    </div>
  </div>
</body>
</html>`);
}

export function createApp(): Express {
  // host: "0.0.0.0" skips localhost-only DNS rebinding protection so that
  // nginx-proxied Host headers are not rejected.
  // Bearer token auth provides equivalent protection.
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok" });
  });

  // --- OAuth 2.1 (PKCE) Server Endpoints ---

  // 1. OAuth Discovery (RFC 8414)
  app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response): void => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${protocol}://${host}`;
    
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"]
    });
  });

  // 2. Protected Resource Metadata (RFC 9728)
  app.get("/.well-known/oauth-protected-resource", (req: Request, res: Response): void => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${protocol}://${host}`;
    
    res.json({
      resource: `${baseUrl}/mcp`,
      authorization_servers: [baseUrl]
    });
  });

  // 3. Authorization Endpoint (GET)
  app.get("/oauth/authorize", (req: Request, res: Response): void => {
    const clientId = (req.query.client_id as string) || "";
    const redirectUri = (req.query.redirect_uri as string) || "";
    const state = (req.query.state as string) || "";
    const codeChallenge = (req.query.code_challenge as string) || "";
    const codeChallengeMethod = (req.query.code_challenge_method as string) || "";
    const resource = (req.query.resource as string) || "";
    
    renderAuthorizePage(res, clientId, redirectUri, state, codeChallenge, codeChallengeMethod, resource, "");
  });

  // 4. Authorization Endpoint (POST)
  app.post("/oauth/authorize", (req: Request, res: Response): void => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, resource, password } = req.body;
    
    const expectedPassword = process.env.MCP_SERVER_AUTH_TOKEN ?? "";
    if (expectedPassword === "") {
      renderAuthorizePage(
        res,
        client_id,
        redirect_uri,
        state,
        code_challenge,
        code_challenge_method,
        resource,
        "Server misconfigured: Bearer token is not set on the server."
      );
      return;
    }
    
    if (!timingSafeStringEqual(password || "", expectedPassword)) {
      renderAuthorizePage(
        res,
        client_id,
        redirect_uri,
        state,
        code_challenge,
        code_challenge_method,
        resource,
        "パスワード（Bearer Token）が正しくありません。"
      );
      return;
    }
    
    if (!redirect_uri) {
      res.status(400).send("Missing redirect_uri");
      return;
    }
    
    // Generate auth code (valid for 5 minutes)
    const codePayload = {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      resource,
      exp: Math.floor(Date.now() / 1000) + 300
    };
    const code = generateCode(codePayload);
    
    // Redirect back to the client
    try {
      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) {
        redirectUrl.searchParams.set("state", state);
      }
      res.redirect(redirectUrl.toString());
    } catch (err) {
      res.status(400).send("Invalid redirect_uri URL format");
    }
  });

  // 5. Token Endpoint (POST)
  app.post("/oauth/token", async (req: Request, res: Response): Promise<void> => {
    const { grant_type, code, redirect_uri, client_id, code_verifier } = req.body;
    
    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    
    if (!code) {
      res.status(400).json({ error: "invalid_request", error_description: "Missing code" });
      return;
    }
    
    const decodedCode = verifyCode(code);
    if (!decodedCode) {
      res.status(400).json({ error: "invalid_grant", error_description: "Invalid or expired code" });
      return;
    }
    
    if (decodedCode.redirect_uri && decodedCode.redirect_uri !== redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "Redirect URI mismatch" });
      return;
    }
    
    if (decodedCode.client_id && decodedCode.client_id !== client_id) {
      res.status(400).json({ error: "invalid_grant", error_description: "Client ID mismatch" });
      return;
    }
    
    // Validate PKCE
    if (decodedCode.code_challenge) {
      if (!code_verifier) {
        res.status(400).json({ error: "invalid_grant", error_description: "Missing code_verifier" });
        return;
      }
      
      let computedChallenge: string;
      if (decodedCode.code_challenge_method === "S256" || !decodedCode.code_challenge_method) {
        const hash = createHash("sha256").update(code_verifier).digest();
        computedChallenge = hash.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      } else {
        res.status(400).json({ error: "invalid_grant", error_description: "Unsupported code_challenge_method" });
        return;
      }
      
      if (computedChallenge !== decodedCode.code_challenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
        return;
      }
    }
    
    // Issue Access Token valid for 1 year
    const expiresIn = 365 * 24 * 60 * 60;
    const tokenPayload = {
      client_id: client_id,
      aud: decodedCode.resource || undefined,
      exp: Math.floor(Date.now() / 1000) + expiresIn
    };
    
    const accessToken = generateJwt(tokenPayload);
    
    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn
    });
  });

  // --- MCP Protocol Endpoint ---

  const mcpHandler = async (req: Request, res: Response): Promise<void> => {
    const upstreamToken = process.env.SLACK_PATRON_API_TOKEN ?? "";
    const slackToken = process.env.SLACK_TOKEN ?? "";
    const server = createMcpServer(upstreamToken, slackToken);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: no session tracking
    });

    try {
      await server.connect(transport);
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
  };

  // Support both GET (SSE) and POST (JSON-RPC) on /mcp and /
  app.post("/mcp", bearerAuthMiddleware, mcpHandler);
  app.get("/mcp", bearerAuthMiddleware, mcpHandler);
  app.post("/", bearerAuthMiddleware, mcpHandler);
  app.get("/", bearerAuthMiddleware, mcpHandler);

  app.delete("/mcp", (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  app.delete("/", (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  return app;
}
