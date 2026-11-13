# Dashboard Traffic Days From the Cron: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Take the 7-second 30-day traffic query off the page's request path by computing it in the hourly cron.

**Spec:** `docs/superpowers/specs/2026-11-13-dashboard-traffic-days-cron-design.md`

**Tech Stack:** TypeScript on workerd, vitest 4 with `@cloudflare/vitest-pool-workers`, Node 22.

## Review Focus

- A cron or warm-up traffic failure must not hide the other refreshes, and must log the status only.
- The page must render every combination: daily summary missing (warming up), failed, present; 24-hour totals failed or present.
- Scheduled tests in `activeUsers.test.ts` and `grants.test.ts` must not reach the real Analytics SQL API now that the cron calls it.

### Task 1: Split traffic.ts

- [ ] Tests: `refreshTrafficDays` stores `{ computedAt, days }` at `summary:traffic-days` and `readTrafficDays` returns it; a failed query leaves the previous summary; `fetchTrafficLast24h` sends only the 24-hour query. Existing bucketing tests move to `refreshTrafficDays`.
- [ ] Implement `TrafficDays`, `TrafficLast24h`, `refreshTrafficDays`, `readTrafficDays`, `fetchTrafficLast24h`; drop `fetchTraffic` and `TrafficSummary`.

### Task 2: Cron, warm-up and model

- [ ] Tests: scheduled run stores the traffic summary; a failed traffic refresh logs `[STATS] traffic refresh failed (status N)` and the other summaries still refresh; a page load with no traffic summary starts the warm-up; the model reads `trafficDays` from KV every load and caches `traffic24h` for 5 minutes.
- [ ] Implement in `index.ts` and `model.ts`.

### Task 3: Page and docs

- [ ] Tests: tiles read `traffic24h`; the chart shows "warming up" when `trafficDays` is null, the load error when failed, and "Daily counts computed 2026-11-12 07:17 PST; they refresh hourly." when present; the footer note reads "Traffic comes from the Analytics SQL API (beta). Daily traffic refreshes hourly; the 24-hour traffic and tool numbers are cached for up to 5 minutes."
- [ ] Implement in `page.ts`; update `dashboard/README.md` (DASH_KV keys, warm-up sentence).
- [ ] `npm run test:dashboard`, `npm test`, `npm run lint`, `npm run typecheck` if present, `npm run format:check`.

### Task 4: Ship

- [ ] Whole-branch review (Sol, xhigh), PR, CI, merge, `npm run dashboard:deploy`, verify the summary key and a fast cold load.
