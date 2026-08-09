import request from "supertest";
import { createApp } from "../src/server";

// Suppress console output from the MCP SDK and our server
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

describe("GET /health", () => {
  it("returns 200 with status ok, no auth required", async () => {
    process.env.MCP_SERVER_AUTH_TOKEN = "test-secret";
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /mcp — auth middleware", () => {
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env.MCP_SERVER_AUTH_TOKEN;
    process.env.MCP_SERVER_AUTH_TOKEN = "correct-token";
    process.env.SLACK_PATRON_API_TOKEN = "upstream-token";
  });

  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env.MCP_SERVER_AUTH_TOKEN;
    } else {
      process.env.MCP_SERVER_AUTH_TOKEN = savedToken;
    }
  });

  it("returns 401 with no Authorization header", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/mcp")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 401 with wrong token", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer wrong-token")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer prefix is missing", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "correct-token")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
  });

  it("returns 500 when MCP_SERVER_AUTH_TOKEN is not set", async () => {
    delete process.env.MCP_SERVER_AUTH_TOKEN;
    const app = createApp();
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer anything")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(500);
  });

  it("401 response does not reveal the expected token", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer wrong")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("correct-token");
  });
});

// GET /mcp is the SSE stream endpoint, so it goes through the same auth middleware as POST.
// A successful GET holds the connection open, so only the rejection path is asserted here.
describe("GET /mcp — SSE endpoint", () => {
  it("returns 401 with no Authorization header", async () => {
    process.env.MCP_SERVER_AUTH_TOKEN = "test-secret";
    const app = createApp();
    const res = await request(app).get("/mcp");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 401 with wrong token", async () => {
    process.env.MCP_SERVER_AUTH_TOKEN = "test-secret";
    const app = createApp();
    const res = await request(app).get("/mcp").set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /mcp", () => {
  it("returns 405 Method Not Allowed", async () => {
    process.env.MCP_SERVER_AUTH_TOKEN = "test-secret";
    const app = createApp();
    const res = await request(app).delete("/mcp");
    expect(res.status).toBe(405);
  });
});
