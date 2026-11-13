# Dashboard Pacific Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every daily figure and timestamp on `stats.lastfm-mcp.com` use `America/Los_Angeles` instead of UTC.

**Architecture:** One helper module, `dashboard/src/pacific.ts`, owns the zone and date math. Active users, sign-ins and traffic bucket by Pacific date through it. Traffic queries hourly rows because the Analytics SQL API's `toDate()` takes no time zone. The page formats times in Pacific with the short zone name.

**Tech Stack:** TypeScript on workerd, `Intl.DateTimeFormat`, vitest 4 with `@cloudflare/vitest-pool-workers`, Node 22.

**Spec:** `docs/superpowers/specs/2026-11-12-dashboard-pacific-days-design.md`

## Global Constraints

- Zone: `America/Los_Angeles`, one exported constant; no configuration.
- Dates are `YYYY-MM-DD` strings; marker keys stay `au:<date>:<hash>`.
- Rolling windows (last 24 h, sign-ins last 7 d, tool stats) don't change.
- Wording: "Pacific day(s)" replaces "UTC day(s)"; times render as `2026-11-12 07:30 PST` / `PDT`.
- Repo style: tabs, no semicolons, single quotes, two `// ABOUTME:` lines per file.

## Review Focus

- A `now` just after Pacific midnight but before UTC midnight, or just before Pacific midnight but after UTC midnight (the bug Rian saw): today must be the Pacific date. Tested in Tasks 1, 2 and 4.
- The DST changes (2026-03-08 and 2026-11-01): `lastPacificDates` must return 30 distinct consecutive dates, and the hourly traffic rows from the 25-hour day must all land on that date. Tested in Tasks 1 and 3.
- Traffic hours before the window's first Pacific midnight (the query's lower bound is UTC midnight, 7 to 8 hours early) must be dropped, not added to the first day. Tested in Task 3.
- A malformed `hour` value from the SQL API must be skipped, not throw. Tested in Task 3.
- `formatTime` given a non-timestamp still returns the dash. Covered by the existing page tests.

---

### Task 1: Pacific date helper

**Files:**
- Create: `dashboard/src/pacific.ts`
- Test: `dashboard/test/pacific.test.ts`

**Interfaces:**
- Produces: `TIME_ZONE = 'America/Los_Angeles'`; `pacificDate(ms: number): string`; `addDays(date: string, days: number): string`; `lastPacificDates(now: Date, count: number): string[]` (oldest first, ending on `pacificDate(now)`); `formatPacificTime(ms: number): string` (`YYYY-MM-DD HH:mm PST|PDT`, 24-hour).

- [ ] Write tests: `pacificDate(Date.parse('2026-11-13T01:00:00Z')) === '2026-11-12'`; `pacificDate(Date.parse('2026-11-12T08:00:00Z')) === '2026-11-12'` and `07:59:59Z` gives `'2026-11-11'`; summer `pacificDate(Date.parse('2026-07-01T06:59:00Z')) === '2026-06-30'`; `addDays('2026-03-01', 30) === '2026-03-31'`; `lastPacificDates(new Date('2026-11-13T01:00:00Z'), 30)` has 30 distinct consecutive dates from `'2026-10-14'` to `'2026-11-12'`, including `'2026-11-01'`; `formatPacificTime(Date.parse('2026-11-12T15:30:00Z')) === '2026-11-12 07:30 PST'` and `formatPacificTime(Date.parse('2026-07-01T19:05:00Z')) === '2026-07-01 12:05 PDT'`.
- [ ] Run `npm run test:dashboard -- pacific`; expect FAIL (module missing).
- [ ] Implement with `Intl.DateTimeFormat('en-CA', { timeZone, ... })` and `formatToParts`; use `hourCycle: 'h23'` so midnight is `00`. `addDays` is UTC calendar math on the date string.
- [ ] Run again; expect PASS. Commit.

### Task 2: Active users and sign-ins by Pacific day

**Files:**
- Modify: `dashboard/src/activeUsers.ts` (`today`, `distinctOver`, `summarise`, comments)
- Modify: `dashboard/src/grants.ts` (`signInsByDay`, comments)
- Test: `dashboard/test/activeUsers.test.ts`, `dashboard/test/grants.test.ts`

**Interfaces:** Consumes `pacificDate`, `addDays`, `lastPacificDates` from Task 1.

- [ ] Add tests: `refreshActiveUsers` at `new Date('2026-11-13T01:00:00Z')` writes markers `au:2026-11-12:<hash>`, and `activeByDay.at(-1).date === '2026-11-12'`; a marker dated `2026-11-13` (a future date, as UTC-dated markers will be on the night after deploy) is not counted in today's DAU. `refreshGrantSummary` at the same `now` puts a grant created at `2026-11-13T00:30:00Z` on `2026-11-12`.
- [ ] Run; expect FAIL.
- [ ] Replace day-number math with Pacific date strings: `today = pacificDate(now)`, windows from `lastPacificDates(now, n)`. Update "UTC" wording in ABOUTME and comments.
- [ ] Run the whole dashboard suite; existing noon-UTC fixtures still pass because noon UTC is the same Pacific date. Commit.

### Task 3: Traffic by Pacific day from hourly rows

**Files:**
- Modify: `dashboard/src/traffic.ts`
- Test: `dashboard/test/traffic.test.ts`

**Interfaces:** Consumes `pacificDate`, `lastPacificDates` from Task 1. `DaySqlRow` becomes `{ hour: string; status: string; requests: number | string }`, where `hour` is `YYYY-MM-DD hh:mm:ss` in UTC.

- [ ] Rewrite the row fixtures to `hour` rows and add tests: at `NOW = 2026-11-12T15:30:00Z`, the daily SQL contains `toStartOfHour(timestamp) AS hour`, `GROUP BY toStartOfHour(timestamp), status`, `timestamp >= '2026-10-14T00:00:00Z'`, and an upper bound at or after `NOW`; a row at `'2026-11-13 02:00:00'` lands on `2026-11-12`; a row at `'2026-10-14 03:00:00'` (Oct 13 Pacific) is dropped; two rows at `'2026-11-01 08:00:00'` and `'2026-11-01 09:00:00'` (the repeated 1am hour) both land on `2026-11-01`; a row with `hour: 'garbage'` is skipped.
- [ ] Run; expect FAIL.
- [ ] Implement: lower bound = UTC midnight of the first Pacific date; upper bound = the next whole hour after `now`. Parse `hour` as UTC (`Date.parse(hour.replace(' ', 'T') + 'Z')`), skip NaN, map with `pacificDate`, ignore dates outside the window. Update ABOUTME and comments.
- [ ] Run; expect PASS. Commit.

### Task 4: Page shows Pacific time

**Files:**
- Modify: `dashboard/src/page.ts` (`formatTime`, `summaryDay`, `addDays`, copy at lines 166, 188, 391 and any other "UTC")
- Modify: `dashboard/README.md`, root `AGENTS.md` dashboard section if it says UTC
- Test: `dashboard/test/page.test.ts`

**Interfaces:** Consumes `formatPacificTime`, `pacificDate`, `addDays` from Task 1; drop page.ts's own `addDays`.

- [ ] Update expectations: `'Page generated 2026-11-12 07:30 PST'`, `'Grant summary computed 2026-11-12 07:17 PST'`, `'Oldest retained tool event: 2026-11-10 00:15 PST'`, tiles `'So far on Nov 12 (Pacific)'` and `'Distinct users, last 7 Pacific days'`. Add: a summary with `computedAt: '2026-11-13T01:00:00.000Z'` shows `'So far on Nov 12 (Pacific)'`.
- [ ] Run; expect FAIL.
- [ ] Implement and reword copy and README.
- [ ] Run `npm run test:dashboard`, `npm run lint`, `npm run format:check`; expect all green. Commit.

### Task 5: Ship

- [ ] Whole-branch review, then PR (problem and outcome first), CI green, merge.
- [ ] From `main`: `npm run dashboard:deploy`, then confirm the deployed version and that the live page shows Pacific dates.
