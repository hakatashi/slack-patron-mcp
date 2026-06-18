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
