# Failed /expenses redesign — what was requested (this session)

Requested (before revert to 2cb7dd5):
1. Change 1 — replace `md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_10rem_auto]` with fixed `..._10rem_13rem` (line 629 parent grid).
2. Change 2 — center group header total (Liquid/Retirement/Loans) over bar column in subgrid.
3. Change 3 — progress bars: relative 62% mx-auto wrapper + absolute left-full label so text doesn’t push bar; also left-aligned bars.

Issues encountered:
- Build failed on /expenses/page.tsx because `groups` fetch inserted at wrong destructured array position (captured settings instead of groups), causing TS error.
- Recurring/ files also missing from merged feat/categories-recurring-controls (restored from origin/main).
- Subgrid + relative wrapper transition caused layout shift and needed verification.

Resolution: full revert of /expenses edits to pre-redesign state (2cb7dd5). Only accounts page (feat/accounts-redesign) kept.
