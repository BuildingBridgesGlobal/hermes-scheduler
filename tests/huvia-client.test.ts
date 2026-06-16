import { describe, it, expect, vi } from "vitest";
import { createHuviaClient } from "../src/lib/huvia-client";

describe("createHuviaClient", () => {
  it("throws when huvia-core returns a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "internal server error",
      }))
    );

    const client = createHuviaClient({
      baseUrl: "https://huvia-core.example.com",
      apiKey: "test",
    });

    await expect(
      client.runAgent({ agent: "vigil", task: "health check" })
    ).rejects.toThrow(/huvia-core returned 500/);

    vi.unstubAllGlobals();
  });

  it("propagates trace_id via header and request body", async () => {
    const captured: { url?: string; headers?: HeadersInit; body?: string } = {};

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        captured.url = String(_url);
        captured.headers = init?.headers;
        captured.body = init?.body as string;
        return {
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
            trace_id: "trace-scheduler-123",
            run_id: "run-1",
            status: "success",
            error: null,
          }),
        } as Response;
      })
    );

    const client = createHuviaClient({
      baseUrl: "https://huvia-core.example.com",
      apiKey: "test",
    });

    const result = await client.runAgent({
      agent: "vigil",
      task: "health check",
      trace_id: "trace-scheduler-123",
      run_id: "run-1",
    });

    expect(captured.url).toBe("https://huvia-core.example.com/run");
    expect((captured.headers as Record<string, string>)["X-HUVIA-TRACE-ID"]).toBe(
      "trace-scheduler-123"
    );
    const body = JSON.parse(captured.body ?? "{}");
    expect(body.trace_id).toBe("trace-scheduler-123");
    expect(body.run_id).toBe("run-1");
    expect(result.trace_id).toBe("trace-scheduler-123");

    vi.unstubAllGlobals();
  });
});
