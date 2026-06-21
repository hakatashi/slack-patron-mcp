import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { upstreamGet, upstreamPost, UpstreamError } from "../upstream.js";

interface ChannelEntry {
  id: string;
  name: string;
}

const CHANNEL_ID_PATTERN = /^[CDGW][A-Z0-9]+$/;

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

export function registerGetChannelMessagesRaw(server: McpServer, token: string): void {
  server.registerTool(
    "get_channel_messages_raw",
    {
      description:
        "Retrieve raw structured JSON for messages in a Slack channel. Returns the full Slack API response including blocks, attachments, reactions, files, and all metadata. Use this when you need detailed message structure beyond the formatted text summary.",
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

        const data = await upstreamPost("/api/conversations.history", token, body);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
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
