import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListChannels } from "../src/tools/list_channels";
import { registerListUsers } from "../src/tools/list_users";
import { registerGetUserInfo } from "../src/tools/get_user_info";
import { registerGetChannelMessages } from "../src/tools/get_channel_messages";
import { registerGetChannelMessagesRaw } from "../src/tools/get_channel_messages_raw";
import { registerGetThreadReplies } from "../src/tools/get_thread_replies";
import { registerGetThreadRepliesRaw } from "../src/tools/get_thread_replies_raw";
import { registerPostMessage } from "../src/tools/post_message";
import { registerSearchMessages } from "../src/tools/search_messages";
import { registerDownloadFile } from "../src/tools/download_file";
import { _resetUsersCache } from "../src/users";

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  mockFetch.mockReset();
  process.env.SLACK_PATRON_BASE_URL = "https://test.example.com";
  delete process.env.USERS_JSON_PATH;
  _resetUsersCache();
});

async function createTestClient(token: string, slackToken = "slack-tok"): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  registerListChannels(server, token);
  registerListUsers(server, token);
  registerGetUserInfo(server, token);
  registerGetChannelMessages(server, token);
  registerGetChannelMessagesRaw(server, token);
  registerGetThreadReplies(server, token);
  registerGetThreadRepliesRaw(server, token);
  registerPostMessage(server, slackToken);
  registerSearchMessages(server, token);
  registerDownloadFile(server, slackToken);

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

describe("list_users", () => {
  it("formats user list correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        U001: { id: "U001", name: "taro", real_name: "Taro Yamada", profile: { display_name: "taro.y" } },
        U002: { id: "U002", name: "bot", real_name: "Some Bot", is_bot: true },
        U003: { id: "U003", name: "hanako", real_name: "Hanako Suzuki", deleted: true },
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({ name: "list_users", arguments: {} });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("@taro (U001): taro.y");
    expect(text).toContain("@bot (U002): Some Bot [bot]");
    expect(text).toContain("@hanako (U003): Hanako Suzuki [deactivated]");
  });

  it("returns error message on upstream 403 without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const client = await createTestClient("super-secret");
    const result = await client.callTool({ name: "list_users", arguments: {} });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("403");
    expect(text).not.toContain("super-secret");
  });
});

describe("get_user_info", () => {
  const USERS_RESPONSE = {
    U001: {
      id: "U001",
      name: "taro",
      real_name: "Taro Yamada",
      tz: "Asia/Tokyo",
      profile: { display_name: "taro.y", title: "Engineer", email: "taro@example.com" },
    },
  };

  it("finds a user by ID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => USERS_RESPONSE,
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({ name: "get_user_info", arguments: { user: "U001" } });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("ID: U001");
    expect(text).toContain("Display name: taro.y");
    expect(text).toContain("Email: taro@example.com");
  });

  it("finds a user by username", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => USERS_RESPONSE,
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({ name: "get_user_info", arguments: { user: "@taro" } });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("ID: U001");
  });

  it("returns an error when the user is not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => USERS_RESPONSE,
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({ name: "get_user_info", arguments: { user: "nonexistent" } });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("not found");
  });

  it("returns error message on upstream 500 without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const client = await createTestClient("super-secret");
    const result = await client.callTool({ name: "get_user_info", arguments: { user: "U001" } });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("500");
    expect(text).not.toContain("super-secret");
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
    expect(text).toContain("[スレッドに返信があります / ts:1700000000.000000]");
  });

  it("adds a broadcasted-reply thread note when thread_ts differs from the message's own ts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            ts: "1700000300.000000",
            user: "U003",
            text: "broadcasted reply",
            thread_ts: "1700000000.000000",
          },
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
    expect(text).toContain(
      "[スレッドから公開されたメッセージです / thread_ts:1700000000.000000]"
    );
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

  it("lists messages oldest-first by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        // Upstream returns newest-first
        messages: [
          { ts: "1700000200.000000", user: "U001", text: "third" },
          { ts: "1700000100.000000", user: "U001", text: "second" },
          { ts: "1700000000.000000", user: "U001", text: "first" },
        ],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text.split("\n").map((l) => l.split(": ")[1])).toEqual(["first", "second", "third"]);
  });

  it("keeps upstream newest-first order when order=desc", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          { ts: "1700000200.000000", user: "U001", text: "third" },
          { ts: "1700000100.000000", user: "U001", text: "second" },
          { ts: "1700000000.000000", user: "U001", text: "first" },
        ],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001", order: "desc" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text.split("\n").map((l) => l.split(": ")[1])).toEqual(["third", "second", "first"]);
  });

  it("places the cursor hint above the messages in ascending order", async () => {
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
    expect(text.indexOf("Older messages available")).toBeLessThan(text.indexOf("msg"));
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

  it("appends an image attachment note to the message line", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            ts: "1700000000.000000",
            user: "U001",
            text: "look at this",
            files: [
              { id: "F01234567", mimetype: "image/jpeg", url_private: "https://example.com/example.jpg" },
              { id: "F09876543", mimetype: "image/png", url_private: "https://example.com/example2.png" },
            ],
          },
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
    expect(text).toContain(
      "[添付画像あり(2件): https://example.com/example.jpg / fileId:F01234567, https://example.com/example2.png / fileId:F09876543]"
    );
  });

  it("appends a generic attachment note for non-image files", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            ts: "1700000000.000000",
            user: "U001",
            text: "see attached",
            files: [{ id: "F01234567", mimetype: "application/pdf", url_private: "https://example.com/doc.pdf" }],
          },
        ],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("[添付ファイルあり(1件): https://example.com/doc.pdf / fileId:F01234567]");
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

  it("appends an attachment note to thread reply lines", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [
          {
            ts: "1700000000.000000",
            user: "U001",
            text: "Parent message",
            files: [{ id: "F01234567", mimetype: "image/jpeg", url_private: "https://example.com/example.jpg" }],
          },
        ],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_thread_replies",
      arguments: { channel: "C001", thread_ts: "1700000000.000000" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("[添付画像あり(1件): https://example.com/example.jpg / fileId:F01234567]");
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

  it("escapes Slack markup so mentions are not interpreted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000005.000000" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    await client.callTool({
      name: "post_message",
      arguments: { message: "hey <!channel> and <@U01234567> check <#C01234567|general>" },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.get("text")).toBe(
      "hey &lt;!channel&gt; and &lt;@U01234567&gt; check &lt;#C01234567|general&gt;"
    );
    const blocks = JSON.parse(params.get("blocks") ?? "[]");
    expect(blocks[0].text.text).toBe(
      "hey &lt;!channel&gt; and &lt;@U01234567&gt; check &lt;#C01234567|general&gt;"
    );
  });

  it("passes through Slack link syntax while escaping everything else", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000006.000000" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    await client.callTool({
      name: "post_message",
      arguments: {
        message:
          "see <https://example.com/docs> and <https://example.com|label> but not <@U01234567> or 1 < 2",
      },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.get("text")).toBe(
      "see <https://example.com/docs> and <https://example.com|label> but not &lt;@U01234567&gt; or 1 &lt; 2"
    );
  });

  it("does not let a fake label smuggle markup through the link syntax", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, ts: "1700000007.000000" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-secret");
    await client.callTool({
      name: "post_message",
      arguments: { message: "<https://example.com|<!channel>>" },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(init.body as string);
    expect(params.get("text")).not.toContain("<!channel>");
  });
});

describe("nickname resolution in get_channel_messages", () => {
  it("resolves user ID to nickname from USERS_JSON_PATH", async () => {
    const { writeFileSync, unlinkSync } = await import("fs");
    const tmpPath = "/tmp/test-users.json";
    writeFileSync(tmpPath, JSON.stringify({ U001: "はかたし" }));
    process.env.USERS_JSON_PATH = tmpPath;
    _resetUsersCache();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000000", user: "U001", text: "Hello" }],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("<はかたし>: Hello");
    unlinkSync(tmpPath);
  });

  it("falls back to user ID when not found in users.json", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000000", user: "UUNKNOWN", text: "Hi" }],
        has_more: false,
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages",
      arguments: { channel: "C001" },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("<UUNKNOWN>: Hi");
  });
});

describe("get_channel_messages_raw", () => {
  it("returns raw JSON response from upstream", async () => {
    const rawResponse = {
      ok: true,
      messages: [
        {
          ts: "1700000000.000000",
          user: "U001",
          text: "Hello",
          blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
        },
      ],
      has_more: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => rawResponse,
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages_raw",
      arguments: { channel: "C001" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.messages[0].blocks).toBeDefined();
  });

  it("resolves channel name to ID before fetching raw data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ C001: { id: "C001", name: "general" } }),
    } as unknown as Response);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messages: [], has_more: false }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    await client.callTool({
      name: "get_channel_messages_raw",
      arguments: { channel: "general" },
    });

    const [, postCall] = mockFetch.mock.calls as [string, RequestInit][];
    expect(postCall[1].body as string).toContain("channel=C001");
  });

  it("returns error on upstream failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_channel_messages_raw",
      arguments: { channel: "C001" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("500");
  });
});

describe("get_thread_replies_raw", () => {
  it("returns raw JSON response from upstream", async () => {
    const rawResponse = {
      ok: true,
      messages: [
        { ts: "1700000000.000000", user: "U001", text: "Parent", reactions: [{ name: "thumbsup", count: 2 }] },
        { ts: "1700000001.000000", user: "U002", text: "Reply" },
      ],
      has_more: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => rawResponse,
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "get_thread_replies_raw",
      arguments: { channel: "C001", thread_ts: "1700000000.000000" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.messages[0].reactions).toBeDefined();
  });

  it("returns error on upstream 403 without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const client = await createTestClient("secret-token");
    const result = await client.callTool({
      name: "get_thread_replies_raw",
      arguments: { channel: "C001", thread_ts: "1700000000.000000" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("403");
    expect(text).not.toContain("secret-token");
  });
});

describe("search_messages", () => {
  it("formats search results with channel and author", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: {
          matches: [
            {
              ts: "1700000100.000000",
              user: "U001",
              text: "Hello world",
              channel: { id: "C001", name: "general" },
            },
            {
              ts: "1700000200.000000",
              username: "bot-name",
              text: "Bot message",
              channel: { id: "C002", name: "random" },
            },
          ],
          pagination: { next_cursor: "" },
        },
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "search_messages",
      arguments: { query: "Hello", limit: 20 },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("#general (C001)");
    expect(text).toContain("<U001>: Hello world");
    expect(text).toContain("#random (C002)");
    expect(text).toContain("<bot-name>: Bot message");
  });

  it("includes pagination cursor when present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        messages: {
          matches: [
            { ts: "1700000000.000000", user: "U001", text: "msg", channel: { id: "C001", name: "general" } },
          ],
          pagination: { next_cursor: "next-page-cursor" },
        },
      }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "search_messages",
      arguments: { query: "msg", limit: 1 },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain('cursor="next-page-cursor"');
  });

  it("sends query and limit to upstream", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messages: { matches: [], pagination: {} } }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    await client.callTool({
      name: "search_messages",
      arguments: { query: "プログラム AND (channel:C7AAX50QY)", limit: 5 },
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/search.messages");
    const params = new URLSearchParams(init.body as string);
    expect(params.get("query")).toBe("プログラム AND (channel:C7AAX50QY)");
    expect(params.get("limit")).toBe("5");
  });

  it("returns empty message when no matches found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messages: { matches: [], pagination: {} } }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "search_messages",
      arguments: { query: "nonexistent" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("No messages found");
  });

  it("returns error on upstream failure without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    const client = await createTestClient("secret-upstream-token");
    const result = await client.callTool({
      name: "search_messages",
      arguments: { query: "test" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("500");
    expect(text).not.toContain("secret-upstream-token");
  });

  it("returns error when ok=false in response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: "invalid_query" }),
    } as unknown as Response);

    const client = await createTestClient("tok");
    const result = await client.callTool({
      name: "search_messages",
      arguments: { query: "bad syntax (((" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("invalid_query");
  });
});

describe("download_file", () => {
  it("returns text content for text files", async () => {
    // First call: files.info
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        file: {
          id: "F001",
          name: "hello.txt",
          title: "Hello File",
          mimetype: "text/plain",
          filetype: "text",
          size: 11,
          url_private_download: "https://files.slack.com/files-pri/T001-F001/hello.txt",
          permalink: "https://myworkspace.slack.com/files/U001/F001/hello.txt",
        },
      }),
    } as unknown as Response);
    // Second call: file download
    const encoder = new TextEncoder();
    const bodyBytes = encoder.encode("hello world");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => (h === "content-type" ? "text/plain; charset=utf-8" : null) },
      arrayBuffer: async () => bodyBytes.buffer,
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-slack");
    const result = await client.callTool({
      name: "download_file",
      arguments: { file_id: "F001" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("hello.txt");
    expect(text).toContain("text/plain");
    expect(text).toContain("hello world");
  });

  it("returns base64 content for binary files", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        file: {
          id: "F002",
          name: "image.png",
          title: "Image",
          mimetype: "image/png",
          filetype: "png",
          size: 4,
          url_private_download: "https://files.slack.com/files-pri/T001-F002/image.png",
          permalink: "https://myworkspace.slack.com/files/U001/F002/image.png",
        },
      }),
    } as unknown as Response);
    const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => (h === "content-type" ? "image/png" : null) },
      arrayBuffer: async () => binaryData.buffer,
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-slack");
    const result = await client.callTool({
      name: "download_file",
      arguments: { file_id: "F002" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("image.png");
    expect(text).toContain("base64");
    expect(text).toContain(Buffer.from(binaryData).toString("base64"));
  });

  it("returns only metadata for files exceeding 5 MB", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        file: {
          id: "F003",
          name: "large.zip",
          title: "Large File",
          mimetype: "application/zip",
          filetype: "zip",
          size: 10 * 1024 * 1024,
          url_private_download: "https://files.slack.com/files-pri/T001-F003/large.zip",
          permalink: "https://myworkspace.slack.com/files/U001/F003/large.zip",
        },
      }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-slack");
    const result = await client.callTool({
      name: "download_file",
      arguments: { file_id: "F003" },
    });

    expect(result.isError).toBeFalsy();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("large.zip");
    expect(text).toContain("too large");
    expect(mockFetch).toHaveBeenCalledTimes(1); // no download call made
  });

  it("returns error when files.info returns ok=false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: "file_not_found" }),
    } as unknown as Response);

    const client = await createTestClient("tok", "xoxp-slack");
    const result = await client.callTool({
      name: "download_file",
      arguments: { file_id: "FBAD" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("file_not_found");
  });

  it("returns error on HTTP failure without exposing token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    const client = await createTestClient("tok", "xoxp-super-secret");
    const result = await client.callTool({
      name: "download_file",
      arguments: { file_id: "F001" },
    });

    expect(result.isError).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (result as any).content[0].text as string;
    expect(text).toContain("403");
    expect(text).not.toContain("xoxp-super-secret");
  });

  it("uses the Slack token (not upstream token) for files.info", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 200, json: async () => ({ ok: false, error: "err" }) } as unknown as Response);

    const client = await createTestClient("upstream-tok", "xoxp-slack-tok");
    await client.callTool({ name: "download_file", arguments: { file_id: "F001" } });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("files.info");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer xoxp-slack-tok");
  });
});
