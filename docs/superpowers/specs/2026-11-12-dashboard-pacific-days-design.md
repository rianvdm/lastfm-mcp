# Dashboard Days in Pacific Time

**Date:** 2026-11-12
**Status:** Approved

## Problem

The usage dashboard at `stats.lastfm-mcp.com` counts days in UTC. At 4pm Pacific on Nov 12 the "Active users today" tile already said Nov 13, because the hourly cron labels active-user markers with the UTC date. The one person who reads this dashboard thinks in Pacific days, so every daily figure and timestamp is off by 7 or 8 hours.

## Goals

- "Today", the 7-day and 30-day active-user windows, and the daily charts run midnight to midnight `America/Los_Angeles`, including across DST changes.
- Timestamps on the page read in Pacific time with the zone named (`2026-11-12 15:30 PST`).
- Labels, captions, the README and ABOUTME lines say "Pacific day" where they said "UTC day".

## Non-goals

- Rolling windows stay as they are: "Requests, last 24 hours", "Sign-ins, last 7 days", and the 24-hour and 7-day tool stats.
- No configurable time zone. One reader, one zone, one constant.
- No migration of existing `au:` markers. They keep their UTC dates and expire within 31 days.

## Approaches

1. **Display only.** Show timestamps in PT and leave day buckets in UTC. Rejected: "today" would still roll over at 4pm or 5pm Pacific, which is the bug Rian saw.
2. **Pacific days everywhere (chosen).** Bucket every daily series by Pacific date and show timestamps in PT.
3. **Group by Pacific day in SQL.** Rejected because the Analytics SQL API refuses `toDate(timestamp, 'America/Los_Angeles')` ("toDate() does not accept 2 arguments"). It accepts `toStartOfHour(timestamp)`, and Pacific offsets are whole hours, so hourly rows grouped by Pacific date in code give exact daily totals. A 30-day hour × status query returned 1,456 rows in about 4 s on 2026-11-12, and the traffic result is already cached for 5 minutes.

## Design

- **`dashboard/src/pacific.ts`** (new): the `America/Los_Angeles` constant, the Pacific `YYYY-MM-DD` date for an instant (via `Intl.DateTimeFormat`), calendar arithmetic on `YYYY-MM-DD` strings, and the last N Pacific dates ending on today's. Calendar arithmetic makes 23- and 25-hour DST days need no special case.
- **Active users (`activeUsers.ts`):** markers are written as `au:<Pacific date>:<hash>`, and the DAU, WAU, MAU and `activeByDay` windows are Pacific dates ending today.
- **Sign-ins (`grants.ts`):** `signInsByDay` puts each grant on the Pacific date of its `createdAt`.
- **Traffic (`traffic.ts`):** the daily query groups by `toStartOfHour(timestamp), status`. Its lower bound is UTC midnight of the first Pacific date, which is always before Pacific midnight, and code drops hours whose Pacific date is outside the 30-day window.
- **Page (`page.ts`):** `formatTime` renders Pacific time with the short zone name, `summaryDay` uses the Pacific date, and the "UTC day" wording becomes "Pacific day".

## Changeover

Markers written before the deploy keep their UTC dates. For up to 31 days, each of those older days in the active-user chart is shifted by up to 8 hours. A marker dated after today's Pacific date can only be a UTC-dated one written that evening, so each run moves it onto today; otherwise it would count as tomorrow's activity at Pacific midnight. (Added after the final review.)

## Left to the builder

Test layout, helper names, and how each test pins `now` across a DST change.
