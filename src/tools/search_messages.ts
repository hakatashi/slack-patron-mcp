import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { upstreamPost, UpstreamError } from "../upstream.js";
import { resolveUsername } from "../users.js";

interface SearchMatch {
  ts: string;
  user?: string;
  username?: string;
  bot_id?: string;
  text?: string;
  channel?: { id: string; name: string };
}

const inputSchema = z.object({
  query: z.string().describe(
    "ElasticSearch query string query to search messages. Supports AND, OR, NOT operators, " +
    "field-specific searches, and range queries.\n" +
    "Examples:\n" +
    "  - `プログラム AND (channel:C7AAX50QY) AND (user:U04G7TL4P) AND (ts:[* TO 1780239600])`\n" +
    "  - `error OR exception`\n" +
    "  - `hello world AND (channel:general)`"
  ),
  limit: z.number().optional().describe("Number of results to return (1-100, default 20)"),
  cursor: z.string().optional().describe("Pagination cursor from a previous response"),
});

export function registerSearchMessages(server: McpServer, token: string): void {
  server.registerTool(
    "search_messages",
    {
      description:
        "Search Slack messages using ElasticSearch query string query syntax via the slack-patron API. " +
        "Supports AND, OR, NOT operators, field-specific searches (channel:, user:, ts:), and range queries. " +
        "Example: `プログラム AND (channel:C7AAX50QY) AND (user:U04G7TL4P) AND (ts:[* TO 1780239600])`",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const { query, cursor } = args;
      const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 100);
      try {
        const body: Record<string, string> = {
          query,
          limit: String(limit),
        };
        if (cursor) body.cursor = cursor;

        const data = (await upstreamPost("/api/search.messages", token, body)) as {
          ok?: boolean;
          messages?: {
            matches?: SearchMatch[];
            pagination?: { next_cursor?: string };
          };
          error?: string;
        };

        if (!data.ok) {
          return {
            content: [{ type: "text" as const, text: `Search failed: ${data.error ?? "unknown error"}` }],
            isError: true,
          };
        }

        const matches = data.messages?.matches ?? [];
        const nextCursor = data.messages?.pagination?.next_cursor;

        if (matches.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No messages found matching the query." }],
          };
        }

        const lines = matches.map((m) => {
          const ts = new Date(parseFloat(m.ts) * 1000).toISOString();
          const author = m.username ?? (m.user ? resolveUsername(m.user) : null) ?? m.bot_id ?? "unknown";
          const channelInfo = m.channel ? `#${m.channel.name} (${m.channel.id})` : "unknown channel";
          const text = (m.text ?? "").replace(/\n/g, " ");
          return `[${ts}] [${channelInfo}] <${author}>: ${text}`;
        });

        if (nextCursor) {
          lines.push(`\n(More results available. Use cursor="${nextCursor}" to get the next page.)`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to search messages (upstream returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : "unexpected error";
        return {
          content: [{ type: "text" as const, text: `Failed to search messages: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
