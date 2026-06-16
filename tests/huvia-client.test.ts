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
});
