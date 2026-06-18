import { upstreamGet, upstreamPost, UpstreamError } from "../src/upstream";

const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

beforeEach(() => {
  mockFetch.mockReset();
  process.env.SLACK_PATRON_BASE_URL = "https://test.example.com";
});

describe("upstreamGet", () => {
  it("passes Authorization header and returns parsed JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ C1234: { id: "C1234", name: "general" } }),
    } as unknown as Response);

    const result = await upstreamGet("/channels.json", "tok123");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.example.com/channels.json",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer tok123" }),
      })
    );
    expect(result).toEqual({ C1234: { id: "C1234", name: "general" } });
  });

  it("throws UpstreamError with status on 403", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    await expect(upstreamGet("/channels.json", "bad-tok")).rejects.toMatchObject({
      name: "UpstreamError",
      status: 403,
    });
  });

  it("throws UpstreamError with status on 401", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await expect(upstreamGet("/channels.json", "bad-tok")).rejects.toMatchObject({
      name: "UpstreamError",
      status: 401,
    });
  });

  it("throws UpstreamError with status on 500", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    await expect(upstreamGet("/channels.json", "tok")).rejects.toMatchObject({
      name: "UpstreamError",
      status: 500,
    });
  });
});

describe("upstreamPost", () => {
  it("sends form-encoded body with Authorization and correct Content-Type", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messages: [] }),
    } as unknown as Response);

    await upstreamPost("/api/conversations.history", "tok123", {
      channel: "C001",
      limit: "50",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.example.com/api/conversations.history",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tok123",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
        body: expect.stringContaining("channel=C001"),
      })
    );
  });

  it("includes all provided body params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messages: [] }),
    } as unknown as Response);

    await upstreamPost("/api/conversations.history", "tok", {
      channel: "C001",
      limit: "100",
      oldest: "1700000000.000000",
      cursor: "abc123",
    });

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = options.body as string;
    expect(body).toContain("channel=C001");
    expect(body).toContain("limit=100");
    expect(body).toContain("oldest=1700000000.000000");
    expect(body).toContain("cursor=abc123");
  });

  it("throws UpstreamError on 401", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response);

    await expect(
      upstreamPost("/api/conversations.history", "bad", { channel: "C001", limit: "50" })
    ).rejects.toMatchObject({ name: "UpstreamError", status: 401 });
  });

  it("error message does not expose the token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    try {
      await upstreamPost("/api/conversations.history", "super-secret-token", {
        channel: "C001",
        limit: "50",
      });
      fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UpstreamError);
      expect((err as Error).message).not.toContain("super-secret-token");
    }
  });
});
