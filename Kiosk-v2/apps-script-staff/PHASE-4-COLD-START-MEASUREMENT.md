# Phase 4: Staff Desk startup measurement

Date: 2026-08-19

## Goal

Reduce the delay before the Staff Desk shows the current-presence list without weakening access controls, adding paid hosting, or using quota-consuming keep-warm triggers.

## Production baseline (version 37)

Five fresh authenticated loads were measured from navigation until the page displayed its updated presence state:

| Run | Time |
| --- | ---: |
| 1 | 2,302 ms |
| 2 | 3,728 ms |
| 3 | 1,940 ms |
| 4 | 2,051 ms |
| 5 | 2,123 ms |

- Median: **2,123 ms**
- Range: **1,940–3,728 ms**
- A prior first load immediately after deployment took about 18 seconds, consistent with an Apps Script cold start rather than the normal warm path.

## Finding

The page launched two server requests at startup:

1. the compact current-presence request needed for the first useful screen; and
2. the much larger people/profile index used for later search and person-card interactions.

Those requests competed during the critical first render even though the people index is not needed to show who is currently present.

## Production change (version 38)

- Await the compact presence request and render it first.
- Begin loading the people/profile index only after presence is ready.
- Expose a privacy-safe `window.STAFF_DESK_PERFORMANCE` record containing only function names, client/server durations, cache status, and timestamps.
- Keep the existing access check, cache rules, database structure, polling intervals, and write behavior unchanged.

No keep-warm trigger was added. It would consume Apps Script quota continuously and would not eliminate all platform cold starts.

## Verification

- Apps Script tests: **44 passed**
- Kiosk/database tests: **35 passed**
- Production deployment: **version 38**, existing URL and deployment ID preserved
- Google deployment metadata confirms version 38 is active.

Post-deployment comparison should use five fresh loads after Google has propagated the new page. Record visible time to the updated presence list plus `window.STAFF_DESK_PERFORMANCE` so server execution can be separated from browser/network overhead.
