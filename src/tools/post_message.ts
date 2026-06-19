import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { slackPost, UpstreamError } from "../upstream.js";

const SANDBOX_CHANNEL_ID = "C7AAX50QY";

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
        "Post a message to the #sandbox Slack channel. The message will be sent as the authenticated user. An attribution suffix is automatically appended.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      try {
        const data = (await slackPost("chat.postMessage", token, {
          channel: SANDBOX_CHANNEL_ID,
          text: args.message,
          blocks: buildBlocks(args.message),
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
