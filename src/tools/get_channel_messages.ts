import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { upstreamGet, upstreamPost, UpstreamError } from "../upstream.js";
import { resolveUsername } from "../users.js";

interface ChannelEntry {
  id: string;
  name: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
}

const CHANNEL_ID_PATTERN = /^[CDGW][A-Z0-9]+$/;

const inputSchema = z.object({
  channel: z.string().describe(
    "Channel ID (e.g. C01234567) or channel name (e.g. general or #general)"
  ),
  limit: z.number().optional().describe("Number of messages to return (1-200, default 50)"),
  oldest: z.string().optional().describe(
    "Start Unix timestamp with microseconds (e.g. 1700000000.000000). Only messages after this time are returned."
  ),
  latest: z.string().optional().describe(
    "End Unix timestamp with microseconds (e.g. 1700000000.000000). Only messages before this time are returned."
  ),
  cursor: z.string().optional().describe(
    "Pagination cursor from a previous response to get the next page."
  ),
});

async function resolveChannelId(channel: string, token: string): Promise<string> {
  if (CHANNEL_ID_PATTERN.test(channel)) {
    return channel;
  }
  const name = channel.replace(/^#/, "");
  const data = (await upstreamGet("/channels.json", token)) as Record<string, ChannelEntry>;
  const found = Object.values(data).find((c) => c.name === name);
  if (!found) {
    throw new Error(`Channel not found: ${channel}`);
  }
  return found.id;
}

export function registerGetChannelMessages(server: McpServer, token: string): void {
  server.registerTool(
    "get_channel_messages",
    {
      description:
        "Retrieve messages from a Slack channel. Returns formatted message history with author, content, and timestamp. Messages are returned newest-first.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const { channel, oldest, latest, cursor } = args;
      const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
      try {
        const channelId = await resolveChannelId(channel, token);
        const body: Record<string, string> = {
          channel: channelId,
          limit: String(limit),
        };
        if (oldest) body.oldest = oldest;
        if (latest) body.latest = latest;
        if (cursor) body.cursor = cursor;

        const data = (await upstreamPost("/api/conversations.history", token, body)) as {
          ok?: boolean;
          messages?: SlackMessage[];
          has_more?: boolean;
          response_metadata?: { next_cursor?: string };
        };

        const messages = data.messages ?? [];
        const nextCursor = data.response_metadata?.next_cursor;

        if (messages.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No messages found in the specified range." }],
          };
        }

        const lines = messages.map((m) => {
          const ts = new Date(parseFloat(m.ts) * 1000).toISOString();
          const author = m.username ?? (m.user ? resolveUsername(m.user) : null) ?? m.bot_id ?? "unknown";
          const text = (m.text ?? "").replace(/\n/g, " ");
          const threadNote =
            m.reply_count && m.reply_count > 0
              ? ` [${m.reply_count} ${m.reply_count === 1 ? "reply" : "replies"} — use get_thread_replies with channel=${channelId} thread_ts=${m.ts}]`
              : "";
          return `[${ts}] <${author}>${threadNote}: ${text}`;
        });

        if (nextCursor) {
          lines.push(`\n(More messages available. Use cursor="${nextCursor}" to get the next page.)`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to fetch messages (upstream returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : "unexpected error";
        return {
          content: [{ type: "text" as const, text: `Failed to fetch messages: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
