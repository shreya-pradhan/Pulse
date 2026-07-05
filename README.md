# Pulse

Pulse tracks competitors' web pages (pricing, features, changelogs, etc.) on a schedule, uses an LLM to summarize only the *meaningful* changes, and emails a digest to the user.

## Stack

- **Next.js 14** (App Router) — UI, API routes, middleware
- **Supabase** — Postgres database, Auth (Google OAuth), row-level security
- **Google Gemini** (`gemini-2.0-flash-lite`) — summarizes diffs into plain-language bullets
- **Resend** — sends the digest email
- **cheerio** — strips HTML down to visible text for scraping/diffing
- **Vercel Cron** — triggers the scheduled scrape job

## How it works

### 1. Auth

Google OAuth via Supabase (`src/app/login/page.tsx`). The browser client calls `supabase.auth.signInWithOAuth`, redirects through Google, and lands on `src/app/auth/callback/route.ts`, which exchanges the auth code for a session and sets cookies. `src/middleware.ts` protects `/dashboard/*`, redirecting unauthenticated requests to `/login`. A row is upserted into `public.users` on first login/visit.

Because Supabase validates the callback URL against an allow-list per project, every environment you run this in (`localhost:3000`, your Vercel domain) needs its own `.../auth/callback` entry in Supabase's **Authentication → URL Configuration → Redirect URLs**.

### 2. Data model (`supabase/migrations/`)

- `users` — mirrors `auth.users`, one row per signed-in user
- `tracked_urls` — a URL a user wants monitored, plus its schedule (`schedule_type`: daily/weekly, `schedule_time`, `schedule_day`, `timezone`) and `next_run_at`
- `snapshots` — every scraped text snapshot of a tracked URL, newest first
- `changes` — a detected meaningful change: the raw diff + the AI summary

All tables have RLS policies scoping rows to `auth.uid()`, either directly (`tracked_urls.user_id`) or via a join back to it (`snapshots`, `changes`).

### 3. Scheduling

Each `tracked_urls` row owns its own cadence. A Postgres function, `compute_next_run_at(schedule_type, schedule_time, schedule_day, timezone, from)`, converts that cadence into the next absolute UTC timestamp, correctly accounting for the user's timezone. A trigger (`set_next_run_at`) recomputes `next_run_at` automatically whenever a row is inserted or its schedule fields change.

Vercel's cron ([vercel.json](vercel.json)) hits `GET /api/cron/scrape` once a day (`0 6 * * *` — Vercel's Hobby plan doesn't allow finer-grained crons). That route is just a dispatcher: it queries every `tracked_urls` row where `next_run_at <= now()`, processes those, and reschedules each one by calling `compute_next_run_at` again — so a URL naturally lands on its own daily/weekly slot regardless of how often the outer cron fires. Precision beyond "once a day" (e.g. an exact hourly check) would require a paid cron tier or an external scheduler hitting the same authenticated endpoint more frequently.

### 4. Scrape → diff → summarize pipeline

For each due URL, `src/app/api/cron/scrape/route.ts` runs:

1. **Scrape** (`POST /api/scrape` → `src/lib/scrape.ts`): fetches the page, strips `nav/footer/header/script/style/noscript` with cheerio, collapses whitespace, and returns plain text.
2. **Snapshot** (`src/lib/snapshots.ts`): stores that text in `snapshots`, returning the previous snapshot's content (if any) for comparison.
3. **Diff** (`POST /api/diff` → `src/lib/diff.ts`): if the text changed, builds a unified diff (`diff` package) and asks Gemini to summarize only pricing/feature/messaging changes in 2–3 bullets, replying `NO_CHANGE` if nothing meaningful moved (nav/layout tweaks are explicitly ignored by the prompt).
4. **Persist + notify**: a real change is inserted into `changes`; all changes across a user's tracked URLs from that run are batched into one HTML digest email (`src/lib/emails/competitor-digest.ts`) and sent via Resend.

The cron route reschedules a URL (`advanceNextRunAt`) after every outcome — success, no-op, or error — so a single failure never leaves a URL permanently stuck.

Both `/api/scrape` and the cron route are also reachable directly; they accept a `Bearer <CRON_SECRET>` header for trusted/admin access (using the Supabase service-role client) or fall back to the logged-in user's session (RLS-scoped client) when called from the dashboard.

### 5. Dashboard

`src/app/dashboard/` is a server component that loads a user's tracked URLs, their most recent snapshot/change timestamps, and change history, then hands it to the `DashboardContent` client component for the add/edit/delete UI. `src/app/api/suggest-urls/route.ts` is a helper used when adding a URL: given a domain, it crawls the homepage's internal links, scores them with keyword heuristics (pricing, features, changelog, etc.), validates the top 3 with a `HEAD` request, and returns them as suggestions — no LLM call needed for this part.

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in real values
npm run dev
```

Open http://localhost:3000.

### Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | server-side Supabase clients | |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser Supabase client (login page) | same values as above, just exposed to the client — Next.js only inlines `NEXT_PUBLIC_*` vars into the browser bundle |
| `SUPABASE_SERVICE_ROLE_KEY` | admin client (`src/lib/supabase-admin.ts`), used by cron/scrape jobs to bypass RLS | keep server-side only |
| `GEMINI_API_KEY` | diff summarization | |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | digest email delivery | |
| `CRON_SECRET` | authenticates cron/admin requests to `/api/cron/scrape` and `/api/scrape` | any random string, e.g. `openssl rand -base64 32` |

## Deployment (Vercel)

1. Push to GitHub, import the repo into Vercel.
2. Add all the env vars above under Project Settings → Environment Variables.
3. In Supabase, add `https://<your-vercel-domain>/auth/callback` to **Redirect URLs** (alongside the localhost one, if you still want local dev to work), and set **Site URL** to your production domain.
4. Use your project's stable production domain (Settings → Domains in Vercel), not a per-deployment preview URL with a random hash — the latter changes on every deploy.
5. The cron in `vercel.json` runs daily; Vercel's Hobby plan will reject/cap anything more frequent.
