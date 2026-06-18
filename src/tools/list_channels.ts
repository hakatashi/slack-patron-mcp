import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { upstreamGet, UpstreamError } from "../upstream.js";

interface ChannelEntry {
  id: string;
  name: string;
  topic?: { value?: string };
}

export function registerListChannels(server: McpServer, token: string): void {
  server.registerTool(
    "list_channels",
    {
      description:
        "List all Slack channels available in the workspace with their IDs and names.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = (await upstreamGet("/channels.json", token)) as Record<
          string,
          ChannelEntry
        >;
        const channels = Object.values(data);
        if (channels.length === 0) {
          return { content: [{ type: "text" as const, text: "No channels found." }] };
        }
        const text = channels
          .map((c) => {
            const topic = c.topic?.value ? `: ${c.topic.value}` : "";
            return `#${c.name} (${c.id})${topic}`;
          })
          .join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to fetch channels (upstream returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to fetch channels due to an unexpected error.",
            },
          ],
          isError: true,
        };
      }
    }
  );
}
