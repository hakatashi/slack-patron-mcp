import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { slackPost, UpstreamError } from "../upstream.js";

const SANDBOX_CHANNEL_ID = "C7AAX50QY";

// Slack interprets unescaped `<...>` sequences as markup (e.g. `<!channel>`,
// `<@UXXXXXXXX>`, `<#CXXXXXXXX>`, links). We allow only Slack's link syntax
// (`<https://...>` or `<https://...|label>`) through verbatim; everything
// else is escaped per Slack's own recommendation (&, <, > -> entities) so no
// other markup (mentions, channel refs, special mentions) can be triggered.
// The label/url character classes exclude `<`/`>`, so markup cannot be
// smuggled in through a fake label either.
const SLACK_LINK_PATTERN = /<(https?:\/\/[^\s<>|]+)(\|[^<>]*)?>/g;

function escapePlainText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeSlackText(text: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(SLACK_LINK_PATTERN)) {
    const start = match.index ?? 0;
    result += escapePlainText(text.slice(lastIndex, start));
    result += match[0];
    lastIndex = start + match[0].length;
  }
  result += escapePlainText(text.slice(lastIndex));
  return result;
}

function buildBlocks(message: string): string {
  return JSON.stringify([
    { type: "section", text: { type: "mrkdwn", text: message } },
    {
      type: "context",
      elements: [
        { type: "plain_text", text: "このメッセージはClaudeによって投稿されました", emoji: true },
      ],
    },
  ]);
}

const inputSchema = z.object({
  message: z.string().describe("投稿するメッセージのテキスト"),
});

export function registerPostMessage(server: McpServer, token: string): void {
  server.registerTool(
    "post_message",
    {
      description:
        "Post a message to the #sandbox Slack channel. The message will be sent as the authenticated user. An attribution suffix is automatically appended. " +
        "Only Slack's link syntax (<https://example.com> or <https://example.com|label>) is passed through as markup; everything else is escaped, " +
        "so mentions such as <!channel>, <!here>, <@USER_ID>, or <#CHANNEL_ID> are always posted as literal text and never trigger notifications.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      try {
        const safeMessage = sanitizeSlackText(args.message);
        const data = (await slackPost("chat.postMessage", token, {
          channel: SANDBOX_CHANNEL_ID,
          text: safeMessage,
          blocks: buildBlocks(safeMessage),
          as_user: "true",
          unfurl_links: "false",
          unfurl_media: "false",
        })) as { ok: boolean; error?: string; ts?: string };

        if (!data.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to post message: ${data.error ?? "unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Message posted to #sandbox (ts: ${data.ts ?? "unknown"}).`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to post message (Slack API returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to post message due to an unexpected error.",
            },
          ],
          isError: true,
        };
      }
    }
  );
}
