# Kiosk release history

The revision shown in the kiosk's **Staff** panel comes from
`lib/kiosk-release.ts`. Update that file and add a row here for every kiosk
deployment that changes the interface or check-in behavior.

Revision format: `YYYY.MM.DD.N`, where `N` starts at `1` and increases when
more than one revision is released on the same day.

| Revision | Date | What changed |
| --- | --- | --- |
| 2026.08.14.3 | August 14, 2026 | Linking a new card now disables the account's previous active card(s), records the replacement, and leaves only the new card active. |
| 2026.08.14.2 | August 14, 2026 | Existing accounts can receive additional active cards without disabling their earlier cards; cards still cannot be shared between accounts. |
| 2026.08.14.1 | August 14, 2026 | Profile questions now appear before the orange confirmation; profile prompts use a high-contrast card and improved field spacing; the Staff panel shows the active revision. |
