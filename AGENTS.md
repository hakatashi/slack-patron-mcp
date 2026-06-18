# Agent Guidelines: slack-patron-mcp

## Project Overview

A remote MCP (Model Context Protocol) server written in TypeScript. It wraps the slack-patron API (URL configured via `SLACK_PATRON_BASE_URL`) and exposes Slack message history to Claude via Streamable HTTP transport.

## Architecture

```
src/
  index.ts          – HTTP server entry point (reads PORT from env)
  server.ts         – Express app factory: auth middleware + MCP handler per request (stateless)
  upstream.ts       – HTTP client for slack-patron: upstreamGet / upstreamPost + UpstreamError
  tools/
    list_channels.ts         – GET /channels.json → formatted #name (ID) list
    get_channel_messages.ts  – POST /api/conversations.history (resolves channel name→ID)
    get_thread_replies.ts    – POST /api/conversations.replies
```

## Key Invariants

- **Stateless MCP**: A new `McpServer` + `StreamableHTTPServerTransport` instance is created per request. No session state is maintained.
- **Read-only**: No write endpoints are implemented. Never add them without explicit approval.
- **No secrets in output**: Tokens and stack traces must never appear in tool responses or logs. Always catch errors and return friendly messages with only the HTTP status code.
- **Always limit upstream calls**: Every call to the upstream API must include a `limit` parameter. Never fetch unbounded data.

## Environment Variables

| Variable | Used in | Purpose |
|----------|---------|---------|
| `MCP_SERVER_AUTH_TOKEN` | `src/server.ts` | Bearer token for authenticating MCP clients |
| `SLACK_PATRON_API_TOKEN` | `src/server.ts` → tools | Bearer token for the slack-patron upstream API |
| `SLACK_PATRON_BASE_URL` | `src/upstream.ts` | Base URL of the slack-patron upstream API (no trailing slash) |
| `PORT` | `src/index.ts` | HTTP listen port (default: 29112) |

## Build & Test

```bash
npm run build      # tsgo (TypeScript native compiler via @typescript/native-preview)
npm run typecheck  # tsgo --noEmit  (full type checking)
npm test           # jest with isolatedModules (no type checking, fast)
```

**Important**: The build uses `tsgo` from `@typescript/native-preview`. ts-jest uses `typescript@6` because ts-jest cannot use `@typescript/native-preview` (it does not expose the TypeScript compiler API). Run `npm run typecheck` separately when type changes are made.

## Adding a New Tool

1. Create `src/tools/your_tool.ts` — export `registerYourTool(server, token)`.
2. Call `upstreamGet` or `upstreamPost` from `src/upstream.ts`. Never call `fetch` directly.
3. Register the tool in `createMcpServer()` in `src/server.ts`.
4. Add tests in `tests/tools.test.ts` — mock `global.fetch`.
5. Document the new tool in `README.md`.

## Testing Conventions

- `tests/setup.ts` installs `global.fetch = jest.fn()` for all test suites.
- Use `InMemoryTransport` + `Client` from the MCP SDK to invoke tools end-to-end in `tools.test.ts`.
- Auth tests use `supertest` in `server.test.ts`.
- Never make real network calls in tests.

## Upstream API Reference

Base URL: set via `SLACK_PATRON_BASE_URL` environment variable

| Method | Path | Body params | Notes |
|--------|------|-------------|-------|
| GET | `/channels.json` | — | Returns hash `{ channelId: { id, name, ... } }` |
| GET | `/users.json` | — | Returns hash `{ userId: { id, name, ... } }` |
| POST | `/api/conversations.history` | `channel`, `oldest`, `latest`, `inclusive`, `cursor`, `limit` (≤1000) | Slack-format response |
| POST | `/api/conversations.replies` | `channel`, `ts`, `oldest`, `latest`, `inclusive`, `cursor`, `limit` | Slack-format response |

All requests require `Authorization: Bearer <SLACK_PATRON_API_TOKEN>` and form-encoded body (`Content-Type: application/x-www-form-urlencoded`).
