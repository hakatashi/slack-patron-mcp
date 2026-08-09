import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { upstreamGet, upstreamPost, UpstreamError } from "../upstream.js";
import { resolveUsername } from "../users.js";

interface ChannelEntry {
  id: string;
  name: string;
}

interface SlackFile {
  id: string;
  mimetype?: string;
  url_private?: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  files?: SlackFile[];
}

function formatAttachmentNote(files?: SlackFile[]): string {
  if (!files || files.length === 0) return "";
  const allImages = files.every((f) => (f.mimetype ?? "").startsWith("image/"));
  const label = allImages ? "添付画像あり" : "添付ファイルあり";
  const parts = files.map((f) => `${f.url_private ?? "(URL不明)"} / fileId:${f.id}`);
  return ` [${label}(${files.length}件): ${parts.join(", ")}]`;
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
    "Pagination cursor from a previous response to fetch the preceding (older) page."
  ),
  order: z.enum(["asc", "desc"]).optional().describe(
    'Display order of the returned messages. "asc" (default) lists oldest first so the ' +
      'conversation reads top to bottom in chronological order. "desc" lists newest first. ' +
      "Note that this only affects the display order within a page; regardless of this setting, " +
      "the messages fetched are always the latest ones in the requested range, and the pagination " +
      "cursor always moves further back in time."
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
        "Retrieve messages from a Slack channel. Returns formatted message history with author, content, and timestamp. " +
        "Messages are listed oldest-first by default (chronological order), so the conversation reads top to bottom; pass order=\"desc\" for newest-first. " +
        "The messages fetched are always the latest ones in the requested range, and the pagination cursor moves further back in time. " +
        "If a message has attachments, a note is appended to the end of the line (e.g. [添付画像あり(2件): https://.../a.jpg / fileId:F01234567, ...]).",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const { channel, oldest, latest, cursor } = args;
      const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
      const order = args.order ?? "asc";
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

        // Upstream returns messages newest-first; flip to chronological order unless asked otherwise.
        const fetched = data.messages ?? [];
        const messages = order === "asc" ? [...fetched].reverse() : fetched;
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
          const attachmentNote = formatAttachmentNote(m.files);
          return `[${ts}] <${author}>${threadNote}: ${text}${attachmentNote}`;
        });

        if (nextCursor) {
          // The cursor always walks backwards in time, so in ascending order the next page
          // belongs above these lines rather than below them.
          const hint = `(Older messages available. Use cursor="${nextCursor}" to fetch the preceding (older) page.)`;
          if (order === "asc") {
            lines.unshift(`${hint}\n`);
          } else {
            lines.push(`\n${hint}`);
          }
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
