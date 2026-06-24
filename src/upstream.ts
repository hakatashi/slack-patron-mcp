export class UpstreamError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

function upstreamBase(): string {
  const base = process.env.SLACK_PATRON_BASE_URL;
  if (!base) throw new Error("SLACK_PATRON_BASE_URL is not set");
  return base.replace(/\/$/, "");
}

export async function upstreamGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${upstreamBase()}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new UpstreamError(res.status, `Upstream ${path} returned ${res.status}`);
  }
  return res.json();
}

export async function upstreamPost(
  path: string,
  token: string,
  body: Record<string, string>
): Promise<unknown> {
  const res = await fetch(`${upstreamBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new UpstreamError(res.status, `Upstream ${path} returned ${res.status}`);
  }
  return res.json();
}

const SLACK_API_BASE = "https://slack.com/api";

export async function slackPost(
  method: string,
  token: string,
  body: Record<string, string>
): Promise<unknown> {
  const res = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new UpstreamError(res.status, `Slack API ${method} returned ${res.status}`);
  }
  return res.json();
}

export async function slackGet(
  method: string,
  token: string,
  params: Record<string, string> = {}
): Promise<unknown> {
  const url = new URL(`${SLACK_API_BASE}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new UpstreamError(res.status, `Slack API ${method} returned ${res.status}`);
  }
  return res.json();
}

export async function slackDownload(
  url: string,
  token: string
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new UpstreamError(res.status, `File download returned ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = await res.arrayBuffer();
  return { buffer, contentType };
}
