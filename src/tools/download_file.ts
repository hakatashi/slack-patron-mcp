import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { slackGet, slackDownload, UpstreamError } from "../upstream.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const inputSchema = z.object({
  file_id: z.string().describe("Slack file ID (e.g. F1234567890)"),
});

interface SlackFileInfo {
  ok: boolean;
  error?: string;
  file?: {
    id: string;
    name: string;
    title: string;
    mimetype: string;
    filetype: string;
    size: number;
    url_private_download: string;
    permalink: string;
  };
}

export function registerDownloadFile(server: McpServer, token: string): void {
  server.registerTool(
    "download_file",
    {
      description:
        "Download a file uploaded to Slack via the Slack API. Provide a Slack file ID (e.g. F1234567890) " +
        "to retrieve the file content. Text files (text/*, application/json) are returned as plain text; " +
        "binary files are returned as base64-encoded data. Files larger than 5 MB are not downloaded " +
        "(only metadata is returned).",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: inputSchema as any,
    },
    async (args: z.infer<typeof inputSchema>) => {
      try {
        const info = (await slackGet("files.info", token, { file: args.file_id })) as SlackFileInfo;

        if (!info.ok || !info.file) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to get file info: ${info.error ?? "unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        const file = info.file;
        const metaSummary =
          `File: ${file.name} (${file.title})\n` +
          `Type: ${file.mimetype}\n` +
          `Size: ${file.size} bytes\n` +
          `Permalink: ${file.permalink}`;

        if (file.size > MAX_FILE_SIZE) {
          return {
            content: [
              {
                type: "text" as const,
                text: `${metaSummary}\n\n(File is too large to download: ${file.size} bytes exceeds the 5 MB limit.)`,
              },
            ],
          };
        }

        const { buffer, contentType } = await slackDownload(file.url_private_download, token);
        const mimeBase = contentType.split(";")[0].trim();

        if (
          mimeBase.startsWith("text/") ||
          mimeBase === "application/json" ||
          mimeBase === "application/xml"
        ) {
          const text = Buffer.from(buffer).toString("utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `${metaSummary}\n\n--- Content ---\n${text}`,
              },
            ],
          };
        }

        const b64 = Buffer.from(buffer).toString("base64");
        return {
          content: [
            {
              type: "text" as const,
              text: `${metaSummary}\nContent-Type: ${contentType}\n\n--- Content (base64) ---\n${b64}`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof UpstreamError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to download file (Slack API returned ${err.status}).`,
              },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : "unexpected error";
        return {
          content: [{ type: "text" as const, text: `Failed to download file: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
