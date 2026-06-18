import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { upstreamPost, UpstreamError } from "../upstream.js";

interface SlackMessage {
  ts: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
}

const inputSchema = z.object({
  channel: z.string().describe("Channel ID containing the thread (e.g. C01234567)"),
  thread_ts: z.string().describe(
    "Timestamp of the parent message (e.g. 1234567890.123456). Shown after 'use get_thread_replies with thread_ts=...' in get_channel_messages output."
  ),
  limit: z.number().optional().describe(
    "Number of messages to return including the parent (1-200, default 50)"
  ),
  cursor: z.string().optional().describe("Pagination cursor from a previous response."),
});

export function registerGetThreadReplies(server: McpServer, token: string): void {
  server.registerTool(
    "get_thread_replies",
    {
      description:
        "Retrieve all replies in a Slack message thread. The first message in the response is the parent message, followed by replies.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const { channel, thread_ts, cursor } = args;
      const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
      try {
        const body: Record<string, string> = {
          channel,
          ts: thread_ts,
          limit: String(limit),
        };
        if (cursor) body.cursor = cursor;

        const data = (await upstreamPost("/api/conversations.replies", token, body)) as {
          ok?: boolean;
          messages?: SlackMessage[];
          has_more?: boolean;
          response_metadata?: { next_cursor?: string };
        };

        const messages = data.messages ?? [];
        const nextCursor = data.response_metadata?.next_cursor;

        if (messages.length === 0) {
          return { content: [{ type: "text" as const, text: "No replies found." }] };
        }

        const lines = messages.map((m, i) => {
          const ts = new Date(parseFloat(m.ts) * 1000).toISOString();
          const author = m.username ?? m.user ?? m.bot_id ?? "unknown";
          const text = (m.text ?? "").replace(/\n/g, " ");
          const label = i === 0 ? "[parent]" : "[reply]";
          return `${label} [${ts}] <${author}>: ${text}`;
        });

        if (nextCursor) {
          lines.push(`\n(More replies available. Use cursor="${nextCursor}" to get the next page.)`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to fetch thread replies (upstream returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to fetch thread replies due to an unexpected error.",
            },
          ],
          isError: true,
        };
      }
    }
  );
}
