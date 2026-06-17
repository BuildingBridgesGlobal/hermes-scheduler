import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/run/[agent]/route";

const validEnv = {
  HUVIA_CORE_API_URL: "https://huvia-core.example.com",
  HUVIA_API_KEY: "core-key",
  CRON_SECRET: "cron-secret",
};

describe("POST /api/run/[agent]", () => {
  beforeEach(() => {
    vi.stubEnv("HUVIA_CORE_API_URL", validEnv.HUVIA_CORE_API_URL);
    vi.stubEnv("HUVIA_API_KEY", validEnv.HUVIA_API_KEY);
    vi.stubEnv("CRON_SECRET", validEnv.CRON_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function makeRequest(
    agent: string,
    opts: { auth?: string; body?: Record<string, unknown> } = {}
  ): NextRequest {
    return new NextRequest(`http://localhost:3000/api/run/${agent}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.auth !== undefined && { authorization: opts.auth }),
      },
      body: JSON.stringify(opts.body ?? {}),
    });
  }

  it("returns 401 when authorization header is missing", async () => {
    const res = await POST(makeRequest("vigil", { auth: undefined }), {
      params: Promise.resolve({ agent: "vigil" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 401 when authorization header is invalid", async () => {
    const res = await POST(makeRequest("vigil", { auth: "Bearer wrong" }), {
      params: Promise.resolve({ agent: "vigil" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 503 when required environment variables are missing", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_SECRET", validEnv.CRON_SECRET);

    const res = await POST(
      makeRequest("vigil", { auth: `Bearer ${validEnv.CRON_SECRET}` }),
      { params: Promise.resolve({ agent: "vigil" }) }
    );
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain("Missing required environment variables");
    expect(data.error).toContain("HUVIA_CORE_API_URL");
    expect(data.error).toContain("HUVIA_API_KEY");
  });

  it("returns 400 for an unknown agent", async () => {
    const res = await POST(
      makeRequest("unknown", { auth: `Bearer ${validEnv.CRON_SECRET}` }),
      { params: Promise.resolve({ agent: "unknown" }) }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Unknown agent");
  });

  it("proxies the cron call to huvia-core and returns the result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          agent: "vigil",
          task: "health check",
          output: "ok",
          confidence: 1,
          escalated: false,
          escalation_reason: null,
          tokens_used: {},
          budget_summary: null,
          trace_id: "trace-123",
          run_id: "run-123",
          status: "success",
          error: null,
        }),
      }))
    );

    const res = await POST(
      makeRequest("vigil", { auth: `Bearer ${validEnv.CRON_SECRET}` }),
      { params: Promise.resolve({ agent: "vigil" }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.trace_id).toBeDefined();
    expect(data.run_id).toBeDefined();
    expect(data.result.agent).toBe("vigil");

    const fetchCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(fetchCalls.length).toBe(1);
    const [, init] = fetchCalls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-HUVIA-API-KEY"]).toBe(validEnv.HUVIA_API_KEY);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 502 when huvia-core fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "internal server error",
      }))
    );

    const res = await POST(
      makeRequest("vigil", { auth: `Bearer ${validEnv.CRON_SECRET}` }),
      { params: Promise.resolve({ agent: "vigil" }) }
    );

    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toContain("huvia-core returned 500");
  });

  it("retries transient huvia-core failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => "temporarily unavailable",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            agent: "vigil",
            task: "health check",
            output: "ok",
            confidence: 1,
            escalated: false,
            escalation_reason: null,
            tokens_used: {},
            budget_summary: null,
            trace_id: "trace-123",
            run_id: "run-123",
            status: "success",
            error: null,
          }),
        })
    );

    const res = await POST(
      makeRequest("vigil", { auth: `Bearer ${validEnv.CRON_SECRET}` }),
      { params: Promise.resolve({ agent: "vigil" }) }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});
