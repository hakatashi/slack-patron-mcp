import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { upstreamGet, UpstreamError } from "../upstream.js";

interface UserEntry {
  id: string;
  name: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_admin?: boolean;
  tz?: string;
  profile?: {
    display_name?: string;
    title?: string;
    email?: string;
  };
}

const USER_ID_PATTERN = /^[UW][A-Z0-9]+$/;

const inputSchema = z.object({
  user: z.string().describe(
    "Slack user ID (e.g. U01234567) or username/display name (e.g. taro or @taro)"
  ),
});

function findUser(data: Record<string, UserEntry>, user: string): UserEntry | undefined {
  if (USER_ID_PATTERN.test(user)) {
    return data[user] ?? Object.values(data).find((u) => u.id === user);
  }
  const name = user.replace(/^@/, "").toLowerCase();
  return Object.values(data).find(
    (u) =>
      u.name?.toLowerCase() === name ||
      u.real_name?.toLowerCase() === name ||
      u.profile?.display_name?.toLowerCase() === name
  );
}

export function registerGetUserInfo(server: McpServer, token: string): void {
  server.registerTool(
    "get_user_info",
    {
      description:
        "Get detailed information about a specific Slack user, looked up by user ID or by username/display name.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      const { user } = args;
      try {
        const data = (await upstreamGet("/users.json", token)) as Record<string, UserEntry>;
        const found = findUser(data, user);

        if (!found) {
          return {
            content: [{ type: "text" as const, text: `User not found: ${user}` }],
            isError: true,
          };
        }

        const lines = [
          `ID: ${found.id}`,
          `Username: ${found.name}`,
          `Real name: ${found.real_name ?? "(unknown)"}`,
        ];
        if (found.profile?.display_name) lines.push(`Display name: ${found.profile.display_name}`);
        if (found.profile?.title) lines.push(`Title: ${found.profile.title}`);
        if (found.profile?.email) lines.push(`Email: ${found.profile.email}`);
        if (found.tz) lines.push(`Timezone: ${found.tz}`);
        if (found.is_bot) lines.push("Bot: yes");
        if (found.is_admin) lines.push("Admin: yes");
        if (found.deleted) lines.push("Deactivated: yes");

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to fetch user info (upstream returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : "unexpected error";
        return {
          content: [{ type: "text" as const, text: `Failed to fetch user info: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
