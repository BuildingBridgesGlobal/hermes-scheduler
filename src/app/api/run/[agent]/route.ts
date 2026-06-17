import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createHuviaClient } from "@/lib/huvia-client";

// Generic cron trigger endpoint for any HuVia Core agent.
// Vercel Cron calls these routes on the documented council cadence. The route
// is protected by a shared CRON_SECRET to prevent arbitrary invocation.
// Example cron config (vercel.json):
//   "path": "/api/run/vigil",
//   "schedule": "0,15,30,45 * * * *"

const REQUIRED_ENV = [
  "HUVIA_CORE_API_URL",
  "HUVIA_API_KEY",
  "CRON_SECRET",
] as const;

const AGENTS = new Set([
  "atlas",
  "vigil",
  "operator",
  "rook",
  "ceu_steward",
  "compliance",
  "patent",
  "ea",
  "sentinel",
  "cfo",
  "slack",
]);

const DAILY_TASK: Record<string, string> = {
  vigil: "health check",
  operator: "cycle",
  rook: "financial review",
  ceu_steward: "daily check",
  compliance: "daily check",
  ea: "daily triage",
  sentinel: "health check",
  cfo: "financial review",
  slack: "deploy",
};

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function validateEnv(): { ok: true } | { ok: false; missing: string[] } {
  const missing = REQUIRED_ENV.filter((name) => !getEnv(name));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return { ok: true };
}

/**
 * Constant-time comparison of the Authorization header against the expected
 * bearer token to avoid timing side-channels.
 */
function verifyCronAuth(req: NextRequest): boolean {
  const cronSecret = getEnv("CRON_SECRET");
  if (!cronSecret) {
    console.error("[hermes-scheduler] CRON_SECRET is not configured");
    return false;
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;

  if (authHeader.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agent: string }> }
): Promise<NextResponse> {
  const { agent } = await params;

  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const envCheck = validateEnv();
  if (!envCheck.ok) {
    const message = `Missing required environment variables: ${envCheck.missing.join(", ")}`;
    console.error(`[hermes-scheduler] ${message}`);
    return NextResponse.json({ error: message }, { status: 503 });
  }

  if (!AGENTS.has(agent)) {
    return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const task = typeof body.task === "string" ? body.task : DAILY_TASK[agent] ?? "cycle";
  const traceId =
    typeof body.trace_id === "string" ? body.trace_id : crypto.randomUUID();
  const runId =
    typeof body.run_id === "string" ? body.run_id : crypto.randomUUID();

  try {
    const client = createHuviaClient({
      baseUrl: getEnv("HUVIA_CORE_API_URL")!,
      apiKey: getEnv("HUVIA_API_KEY")!,
      timeoutMs: 30_000,
      retries: 2,
    });

    const result = await client.runAgent({
      agent,
      task,
      action_class: "A2_DRAFT_ONLY",
      trace_id: traceId,
      run_id: runId,
      trigger_source: "vercel-cron",
    });

    return NextResponse.json(
      { ok: true, trace_id: traceId, run_id: runId, result },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[hermes-scheduler] Failed to run ${agent}: ${message}`,
      { trace_id: traceId, run_id: runId }
    );
    return NextResponse.json(
      { ok: false, trace_id: traceId, run_id: runId, error: message },
      { status: 502 }
    );
  }
}
