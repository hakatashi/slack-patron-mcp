import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListChannels } from "../src/tools/list_channels";
import { registerGetChannelMessages } from "../src/tools/get_channel_messages";
import { registerGetThreadReplies } from "../src/tools/get_thread_replies";
import { registerPostMessage } from "../src/tools/post_message";

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  mockFetch.mockReset();
  process.env.SLACK_PATRON_BASE_URL = "https://test.example.com";
});

async function createTestClient(token: string, slackToken = "slack-tok"): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerListChannels(server, token);
  registerGetChannelMessages(server, token);
  registerGetThreadReplies(server, token);
  registerPostMessage(server, slackToken);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return client;
}

describe("list_channels", () => {
  it("formats channel list correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        C001: { id: "C001", name: "general", topic: { value: "General chat" } },
        C002: { id: "C002", name: "random" },
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({ name: "list_channels", arguments: {} });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("#general (C001): General chat");
    expect(text).toContain("#random (C002)");
  });

  it("returns error message on upstream 403 without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const client = await createTestClient("super-secret");
    const result = await client.callTool({ name: "list_channels", arguments: {} });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("403");
    expect(text).not.toContain("super-secret");
  });

  it("returns error message on upstream 401 without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    const client = await createTestClient("my-token");
    const result = await client.callTool({ name: "list_channels", arguments: {} });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).not.toContain("my-token");
  });
});

describe("get_channel_messages", () => {
  it("fetches messages with channel ID and formats them", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: "1700000100.000000", user: "U001", text: "Hello world" },
          { ts: "1700000000.000000", user: "U002", text: "First message", reply_count: 3, thread_ts: "1700000000.000000" },
        ],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("<U001>: Hello world");
    expect(text).toContain("3 replies");
    expect(text).toContain("thread_ts=1700000000.000000");
  });

  it("resolves channel name to ID via channels.json", async () => {
    // First call: channels.json for name resolution
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        C001: { id: "C001", name: "general" },
      }),
    } as unknown as Response);
    // Second call: conversations.history
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messages: [{ ts: "1700000000.000000", user: "U001", text: "hi" }], has_more: false }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "general", limit: 10 },
    });

    expect(result.isError).toBeFalsy();
    const [, postCall] = mockFetch.mock.calls as [string, RequestInit][];
    expect(postCall[1].body as string).toContain("channel=C001");
  });

  it("includes pagination cursor hint when has more messages", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000000", user: "U001", text: "msg" }],
        has_more: true,
        response_metadata: { next_cursor: "cursor-abc" },
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001", limit: 1 },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain('cursor="cursor-abc"');
  });

  it("returns error on upstream 500 without stack trace", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001", limit: 10 },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("500");
    expect(text).not.toContain("at ");  // no stack trace lines
  });
});

describe("get_thread_replies", () => {
  it("formats thread replies with parent label", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: "1700000000.000000", user: "U001", text: "Parent message" },
          { ts: "1700000001.000000", user: "U002", text: "Reply one" },
          { ts: "1700000002.000000", user: "U003", text: "Reply two" },
        ],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_thread_replies",
      arguments: { channel: "C001", thread_ts: "1700000000.000000", limit: 50 },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("[parent]");
    expect(text).toContain("[reply]");
    expect(text).toContain("Parent message");
    expect(text).toContain("Reply one");
  });

  it("returns error on upstream 403 without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const client = await createTestClient("secret-upstream-token");
    const result = await client.callTool({
      name: "get_thread_replies",
      arguments: { channel: "C001", thread_ts: "1700000000.000000" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("403");
    expect(text).not.toContain("secret-upstream-token");
  });
});

describe("post_message", () => {
  const SANDBOX_ID = "C7AAX50QY";

  it("posts to #sandbox and returns ts on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000001.000000" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    const result = await client.callTool({
      name: "post_message",
      arguments: { message: "Hello" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("1700000001.000000");
    expect(text).toContain("#sandbox");
  });

  it("always posts to the sandbox channel ID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000002.000000" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    await client.callTool({ name: "post_message", arguments: { message: "test" } });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("chat.postMessage");
    expect(init.body as string).toContain(`channel=${SANDBOX_ID}`);
  });

  it("appends attribution context block to the message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000003.000000" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    await client.callTool({ name: "post_message", arguments: { message: "Hello" } });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.get("text")).toBe("Hello");
    const blocks = JSON.parse(params.get("blocks") ?? "[]");
    expect(blocks[blocks.length - 1]).toMatchObject({
      type: "context",
      elements: [{ type: "plain_text", text: "このメッセージはClaudeによって投稿されました" }],
    });
  });

  it("sends as_user=true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000004.000000" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    await client.callTool({ name: "post_message", arguments: { message: "test" } });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain("as_user=true");
  });

  it("returns error when Slack API responds with ok=false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: "channel_not_found" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    const result = await client.callTool({
      name: "post_message",
      arguments: { message: "test" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("channel_not_found");
  });

  it("returns error on HTTP 403 without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const client = await createTestClient("tok", "xoxp-super-secret");
    const result = await client.callTool({
      name: "post_message",
      arguments: { message: "test" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("403");
    expect(text).not.toContain("xoxp-super-secret");
  });
});
