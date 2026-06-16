import { NextRequest, NextResponse } from "next/server";
import { createHuviaClient } from "@/lib/huvia-client";

// Generic cron trigger endpoint for any HuVia Core agent.
// Vercel Cron calls these routes on the documented council cadence. The route
// is protected by a shared CRON_SECRET to prevent arbitrary invocation.
// Example cron config (vercel.json):
//   "path": "/api/run/vigil",
//   "schedule": "0,15,30,45 * * * *"

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

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function verifyCronAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${getEnv("CRON_SECRET")}`;
  return authHeader === expected;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agent: string }> }
): Promise<NextResponse> {
  const { agent } = await params;

  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!AGENTS.has(agent)) {
    return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const task = typeof body.task === "string" ? body.task : DAILY_TASK[agent] ?? "cycle";

  try {
    const client = createHuviaClient({
      baseUrl: getEnv("HUVIA_CORE_API_URL"),
      apiKey: getEnv("HUVIA_API_KEY"),
    });

    const result = await client.runAgent({
      agent,
      task,
      action_class: "A2_DRAFT_ONLY",
    });

    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hermes-scheduler] Failed to run ${agent}: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
