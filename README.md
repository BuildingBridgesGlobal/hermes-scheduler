# Hermes Scheduler

Vercel-hosted cron scheduler for the HuVia Core workforce runtime.

## What it does

- Receives Vercel Cron invocations on `/api/run/<agent>`.
- Verifies the request with `CRON_SECRET`.
- Proxies the call to the HuVia Core HTTP API (`/run`) using `HUVIA_API_KEY`.
- Uses the documented daily task shortcut for each agent unless overridden.

## Agent cadence

| Agent | Schedule | Default task |
|---|---|---|
| `vigil` | Every 15 minutes | `health check` |
| `operator` | Every 30 minutes | `cycle` |
| `rook` | Every 30 minutes | `financial review` |
| `ceu_steward` | Daily at 09:00 | `daily check` |

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `HUVIA_CORE_API_URL` — base URL of the running huvia-core FastAPI service
- `HUVIA_API_KEY` — shared API key configured on huvia-core (`HUVIA_API_KEY`)
- `CRON_SECRET` — secret token Vercel cron sends in the `Authorization: Bearer ...` header

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Trigger a run manually (with the correct `CRON_SECRET`):

```bash
curl -X POST http://localhost:3000/api/run/vigil \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"task":"health check"}'
```

## Deployment

Connect the repo to Vercel. The `vercel.json` cron entries are deployed automatically. Make sure all three environment variables are set in the Vercel project settings.

## Why no central orchestration framework

Per Huvia `OPERATING_RULES.md`, LangGraph, LangChain, CrewAI, AutoGen, and n8n are not used as the central runtime. This scheduler is intentionally a thin HTTP trigger layer.
