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
}

export interface HuviaClientConfig {
  baseUrl: string;
  apiKey: string;
}

export function createHuviaClient(config: HuviaClientConfig) {
  async function runAgent(req: HuviaRunRequest): Promise<HuviaRunResponse> {
    const res = await fetch(`${config.baseUrl}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HUVIA-API-KEY": config.apiKey,
      },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`huvia-core returned ${res.status}: ${text}`);
    }

    return (await res.json()) as HuviaRunResponse;
  }

  return { runAgent };
}
