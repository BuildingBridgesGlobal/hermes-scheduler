/**
 * Minimal typed client for the HuVia Core HTTP API.
 *
 * Keeps the scheduler decoupled from huvia-core internals. If the API surface
 * changes, only this file and the route handlers need to change.
 */

export interface HuviaRunRequest {
  agent: string;
  task: string;
  action_class?: string;
  trace_id?: string;
  run_id?: string;
  trigger_source?: string;
}

export interface HuviaRunResponse {
  agent: string;
  task: string;
  output: string;
  confidence: number | null;
  escalated: boolean;
  escalation_reason: string | null;
  tokens_used: Record<string, number>;
  budget_summary: Record<string, unknown> | null;
  trace_id: string;
  run_id: string;
  status: string;
  error: string | null;
}

export interface HuviaClientConfig {
  baseUrl: string;
  apiKey: string;
  /** Request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Number of retries for transient failures. Defaults to 0. */
  retries?: number;
}

function isRetryable(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || status === 429 || status === 408;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHuviaClient(config: HuviaClientConfig) {
  const timeoutMs = config.timeoutMs ?? 30_000;
  const retries = config.retries ?? 0;

  async function runAgent(req: HuviaRunRequest): Promise<HuviaRunResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-HUVIA-API-KEY": config.apiKey,
    };
    if (req.trace_id) {
      headers["X-HUVIA-TRACE-ID"] = req.trace_id;
    }

    let lastError: Error | undefined;
    const maxAttempts = Math.max(1, retries + 1);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(`${config.baseUrl}/run`, {
          method: "POST",
          headers,
          body: JSON.stringify(req),
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          const error = new Error(`huvia-core returned ${res.status}: ${text}`);
          if (isRetryable(res.status) && attempt < maxAttempts - 1) {
            lastError = error;
            await sleep(2 ** attempt * 500);
            continue;
          }
          throw error;
        }

        return (await res.json()) as HuviaRunResponse;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (
          (error.name === "AbortError" || error.message.includes("fetch")) &&
          attempt < maxAttempts - 1
        ) {
          lastError = error;
          await sleep(2 ** attempt * 500);
          continue;
        }
        throw lastError ?? error;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    throw lastError ?? new Error("huvia-core request failed");
  }

  return { runAgent };
}
