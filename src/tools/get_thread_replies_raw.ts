import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { upstreamPost, UpstreamError } from "../upstream.js";

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

export function registerGetThreadRepliesRaw(server: McpServer, token: string): void {
  server.registerTool(
    "get_thread_replies_raw",
    {
      description:
        "Retrieve raw structured JSON for all replies in a Slack message thread. Returns the full Slack API response including blocks, attachments, reactions, files, and all metadata. Use this when you need detailed message structure beyond the formatted text summary.",
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

        const data = await upstreamPost("/api/conversations.replies", token, body);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
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
