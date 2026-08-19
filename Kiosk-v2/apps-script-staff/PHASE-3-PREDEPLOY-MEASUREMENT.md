# Phase 3 compact presence path — pre-deployment measurement

Measured 2026-08-19. Nothing in this checkpoint was deployed to the production Staff Desk or written to the production database.

## Recovery points

- Production source before Phase 3: Git commit `5e51c5642da093620e0c882cd506e4ffb02be223`, also present on `origin/agent/preserve-production-2026-08-13`.
- Production spreadsheet backup: [Scripps Sandbox Database v2 — Production — Pre Phase 3 Backup 2026-08-19](https://docs.google.com/spreadsheets/d/1ZVchHEf3KPsoRS3VzdoR-antrWQUO_yTjD3GDznxTDQ/edit).
- The production workbook remained at 18 tabs and did not receive a `Current Presence` tab. The backup has 19 tabs and contains the prototype feed.

## Correctness check on backup data

- Full source: 3,422 visit records.
- Compact feed: 28 visit events from the current day.
- Both paths derived 9 people with activity today: 3 currently present and 6 left.
- Final-state mismatches: **0**.

## Read-size reduction

The previous cold dashboard path read 53,305 cells across People, Tool Certifications, Visits, Tool Training, Registrations, Identifiers, FabMan Links, FabMan Provisioning, and Staff Notes.

The compact presence path read 232 cells for the same current-day presence result.

- Cells removed from the frequent presence refresh: **99.56%**.
- Frequent read-size reduction: **229.8×**.
- Google connector measurement: 3.825 seconds for the nine old source reads issued in parallel, versus 0.438 seconds for the compact feed. This is indicative rather than a promise of Apps Script web-app latency.

## Local state-processing benchmark

Synthetic workload matching the current sheet sizes, 300 iterations after warm-up:

| Path | Median | p95 |
| --- | ---: | ---: |
| Full history: 626 people and 3,422 visits | 5.697 ms | 6.255 ms |
| Compact feed: 28 current-day events | 0.164 ms | 0.215 ms |

The main production gain should come from avoiding repeated Google Sheets reads, not from JavaScript processing alone.

## Implementation behavior

- Presence refreshes every 6 seconds from `Current Presence` and Staff Notes.
- The larger people/search/profile index loads separately and caches for 10 minutes.
- Profile, training, and FabMan writes invalidate the larger index immediately.
- A 15-second client-side override prevents **Mark left** or **Undo** from briefly reversing while Sheets recalculates.
- The prior `staffDashboard()` entry point remains as a compatibility wrapper, but the new Staff Desk UI no longer calls it.

## Verification completed

- Staff Apps Script tests: 20 passed.
- Registration and Staff Apps Script tests together: 43 passed.
- Kiosk web application build and tests: 35 passed.
- Apps Script source syntax and whitespace checks passed.

## Deployment gate

Before deployment, run `setupStaffApp()` once so production receives the formula-backed `Current Presence` tab. Then publish a numbered Apps Script version onto the existing Staff Desk web-app deployment and smoke-test initial load, known-card presence, manual check-in, **Mark left**, **Undo**, notes, search, and a person card.

## Production deployment result

Deployed 2026-08-19 as Staff Desk version 36, `Production v36 — compact presence path`, on the existing web-app deployment ID. The Staff Desk URL, execution account, and access policy did not change.

- Production now contains the formula-backed `Current Presence` tab with a frozen, styled header and readable timestamps.
- Deployment record verified at version 36.
- First post-deployment load was a cold start and completed in approximately 18 seconds.
- A fresh warm load completed in **4.7 seconds** and displayed 3 people currently present, matching the compact feed.
- The next automatic refresh completed normally and advanced the on-screen update time.
- Browser console warnings/errors: **0** after deployment propagation completed.
- Attendance records were not mutated during the production smoke test.

One serving instance briefly paired the new HTML with the prior server version immediately after publication, causing the UI's automatic retry state. This cleared after normal Apps Script deployment propagation; a cache-busted reload and the subsequent automatic refresh both succeeded.
