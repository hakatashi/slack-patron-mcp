import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { upstreamGet, UpstreamError } from "../upstream.js";

interface UserEntry {
  id: string;
  name: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_admin?: boolean;
  profile?: { display_name?: string };
}

function formatUser(u: UserEntry): string {
  const displayName = u.profile?.display_name || u.real_name || u.name;
  const tags: string[] = [];
  if (u.is_bot) tags.push("bot");
  if (u.is_admin) tags.push("admin");
  if (u.deleted) tags.push("deactivated");
  const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
  return `@${u.name} (${u.id}): ${displayName}${tagStr}`;
}

export function registerListUsers(server: McpServer, token: string): void {
  server.registerTool(
    "list_users",
    {
      description:
        "List all Slack users in the workspace with their IDs, usernames, and display names.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = (await upstreamGet("/users.json", token)) as Record<string, UserEntry>;
        const users = Object.values(data);
        if (users.length === 0) {
          return { content: [{ type: "text" as const, text: "No users found." }] };
        }
        const text = users.map(formatUser).join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to fetch users (upstream returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: "Failed to fetch users due to an unexpected error.",
            },
          ],
          isError: true,
        };
      }
    }
  );
}
