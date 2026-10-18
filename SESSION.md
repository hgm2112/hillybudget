# SESSION.md

Working state for hillybudget. Keep current at the end of each substantial work session. No secrets or credentials belong in this file.

## Project state and stack

- Next.js 16 App Router (TypeScript), Tailwind v4, shadcn/ui, Supabase (Auth / Postgres / Realtime / RLS), hosted on Vercel.
- Git: `github.com:hgm2112/hillybudget`, branch `main`. Migrations live in `supabase/migrations`.
- Supabase project (correct): `geajkzgdqflrpefhltwm.supabase.co`. Do not run destructive SQL against other projects.
- Commands: `npm run dev`, `npm run build`, `npm run lint`.

## Rebuild (approved; app rebuilt on the live schema)

A clean application rebuild on a from-scratch, `ledger_entries`-based schema. The database reset has been applied to the correct project; the new schema, RLS policies, and auth are live. The app was rebuilt server-first (RSC + Server Actions) page by page; the cleaned `Expenses.xlsx` has been imported (see below). Migrations through `0008` are applied (see Database in `AGENTS.md`).

### Schema (applied via `supabase/reset_and_init.sql`)

- Tables: `profiles`, `households`, `household_members`, `household_settings`, `categories`, `cards`, `accounts`, `import_batches`, `recurring_items`, `ledger_entries`, `account_balances`; view `monthly_category_totals`.
- Enums: `member_role`, `category_kind`, `account_kind`, `import_status`, `theme_pref`.
- Unified income + expense into `ledger_entries` (no separate `income` table); `categories.kind` and `accounts.kind` replace the old `type` columns.
- RPCs: `create_household(name)`, `join_household(invite)`, `ideal_category_amount(...)`, `import_expenses_batch(...)`.
- RLS on all tables via `is_household_member` / `is_household_owner`; `anon` has no table privileges.

### Progress

- Phases 0–8 complete. Rebuilt: `lib/session.ts`, `lib/supabase/{client,server,middleware}.ts`, `proxy.ts`, root layout, login, household, categories, recurring, dashboard/ledger, accounts, stats, settings/import.
- Phase 9 (cleanup) done: `/api/keepalive` enforces `CRON_SECRET` when set; removed unused `src/lib/constants.ts` and `scripts/import-expenses.py` (and the `import:expenses` npm script).

### Layout redesign (implemented)

- `supabase/migrations/0003_category_groups.sql` **is applied** to the project (`category_groups` + `categories.group_id`/`excluded` exist). Migration history was baselined via `supabase migration repair --status applied 0001 0002 0003`; future migrations apply with `npx supabase db push --db-url "$SUPABASE_DB_URL"`.
- App shell replaced the top nav: `src/components/{app-shell,app-sidebar,sidebar,page-header}.tsx`; `app-nav.tsx` / `nav-actions.tsx` deleted. Left sidebar (brand, search, nav, account lists, theme toggle, sign-out) with a mobile drawer; hidden on `/login` and `/household`.
- Categories page redesigned (`src/app/categories/{page.tsx,categories-client.tsx}`) into the two-pane budget view (donut, grouped categories, budget vs spent bars, monthly chart, key metrics) with inline add/edit/manage dialogs. Budget column = the ideal (trailing-average) amount; `ideal_override` edits the budget. Category icons via `src/lib/category-icons.ts`.
- New categories actions: `addGroup`/`updateGroup`/`moveGroup`/`deleteGroup`/`setCategoryGroup`/`setExcluded`; `updateCategory` now also accepts `excluded`, `group_id`, `ideal_override`.

### Dashboard split (implemented)

- The old root ledger moved to **`/expenses`** (`src/app/expenses/{page,expenses-client,actions}.tsx`; component `ExpensesClient`; `revalidatePath("/expenses")`; month nav `?month=`). Root `/` now redirects to `/dashboard`.
- New **`/dashboard`** (`src/app/dashboard/{page,dashboard-client}.tsx`): eyebrow-free `PageHeader` with a 3M/6M/12M/YTD selector, four range-based summary cards (income, expenses, net cash flow, net worth), and a 2×2 Recharts grid (spending trend area, income-vs-expenses bars, spending-by-category horizontal bars, net worth line). Data: `categories`, `monthly_category_totals`, `accounts`, `account_balances`. Net worth = latest snapshot per account (assets = liquid+retirement, liabilities = loan); the net-worth line plots **recorded months only** (no forward-fill). No Realtime. No migration needed.
- Sidebar nav order: Dashboard `/dashboard`, Expenses `/expenses`, Accounts, Categories, Stats, Settings; brand links to `/dashboard`. Login/household redirects and the import "View expenses" link updated.

### Excel import (done)

- `Expenses.xlsx` has been imported into the live project (via the settings import preview/confirm flow). The earlier "no re-import" note no longer applies.

### Skip-month for account balances (implemented, migration applied)

- `supabase/migrations/0004_skipped_months.sql` **is applied** (verified with `supabase migration list`: `0004` local = remote). Adds `skipped_months(id, household_id, month, created_at)`, `unique(household_id, month)`, index, RLS via `is_household_member`, grants to `authenticated, service_role`.
- Scope is **account balances only** — `ledger_entries` and `monthly_category_totals` (expenses/dashboard/stats) are untouched, so a month may be skipped for balances while still holding expense data.
- `accounts/page.tsx` fetches `skipped_months.month` and passes `skipped: string[]`. Actions: `skipMonth` (rejects if `account_balances` exist for that month), `unskipMonth`, and `saveBalances` auto-clears a skip row after a successful upsert.
- `accounts-client.tsx`: header gains **Skip this month** (when not skipped); **Save balances** is disabled while skipped. For a skipped month, the summary/loan/add-account sections are dimmed (`inert` + `opacity-40`) while the **Balances** card stays full-opacity: its account rows render **blank** (empty inputs, no placeholders, blank change) and a **"No data this month"** message with an **Undo skip** button is centered inside that card box. Prev/Next stay plain month-by-month. "change" figures compare against the most recent prior month that has balances (`previousRecordedMonth`), and that basis is shown as a caption.
- `clearBalances(month)` action + an inline-confirm **Clear balances** button (only when the month has balances) let a month's balances be removed in-app, so "balances exist" is no longer a dead end for skipping.
- **Balance input parsing**: `parseBalance` strips `$`, commas, and spaces before `Number()`. `saveBalance`/`saveAllBalances` surface "Enter a valid number." instead of silently no-op'ing, and `saveBalances` returns that error when the cleaned list is empty. This fixes values like `6,537` / `$226,216` that previously failed to persist (they parsed to `NaN`, so the row Save did nothing and the field reverted to the stored value).
- **Accounts editor fix**: drafts are seeded once per month (via a `seededMonth` ref) and preserved across `router.refresh()` saves, so unsaved edits are no longer clobbered. Previous-month figures are shown only as input **placeholders**, never as values. Per-row **Save** is disabled on an empty field and `saveBalance` no-ops on empty (previously an empty field wrote `0`). Summary cards and the loan "remaining" now use **saved** balances (`savedFor`/`currentValueFor`); an empty month shows `$0.00` and "no saved data" instead of a bogus change. Row "change" is blank when the row has no value.
- Data note: the first import stored **August 2026** balances as `$0` (the workbook had the wrong month removed at import time); every other month matched. The editor bug above is why manual re-entry of Chase/401k did not stick. Fix: Clear August, then re-import `Expenses.xlsx` with **Overwrite from workbook**. **September 2026** has no balances and is skipped for accounts.

### Month-scoped account archiving (implemented, migration applied)

- `supabase/migrations/0005_account_archive_periods.sql` **is applied**. Adds `account_archive_periods(id, household_id, account_id, start_month, end_month, created_at)`, `end_month` nullable with `end_month > start_month`, index `(household_id, account_id)`, RLS via `is_household_member`, grants to `authenticated, service_role` (not Realtime). Also sets `accounts.archived = false` (the old global flag is deprecated for accounts; category/card archives are separate).
- An account is archived for month `X` when a period satisfies `start_month <= X and (end_month is null or X < end_month)`, i.e. archived **from its start month onward**. `archiveAccount(id, month)` extends an ongoing period's start back to `month` or inserts `(month, null)`; `unarchiveAccount(id, month)` closes the covering period at `month` (deleting it when empty), so earlier months stay archived and the account becomes active from `month` onward.
- `accounts/page.tsx` computes the archived account ids for the selected month (server-side) and passes `archivedIds`; `accounts-client.tsx` derives `isArchived(id)` for the row filter, badge, and Archive/Unarchive button, and totals/comparisons use `activeAccounts` (archived always excluded, independent of the "Show archived" toggle).
- `app-sidebar.tsx` hides accounts archived as of the current month (replaces the old `.eq("archived", false)` filter). Dashboard is unchanged.

### Month navigation + layout cleanup (implemented)

- New shared client component `src/components/month-nav.tsx` renders `[Previous] [<Month Year> ▾] [Next]`; the middle is a `DropdownMenu` (base-ui) whose content is already `overflow-y-auto`, listing every month and scrolling the current one into view on open. The old `This month` quick-jump is gone (the picker replaces it).
- New helpers in `src/lib/month.ts`: `monthName` (long month only) and `monthRange(from, to)` (inclusive keys, reversed-safe).
- `/expenses`: header is now `[Expenses] [Previous] [<Month Year> ▾] [Next]` with the `Add recurring items` button (renamed from `Fill recurring`; still calls `fillRecurring`) and the unchanged `By card`/`By category` toggle on the right; the month subtitle was removed. `expenses/page.tsx` derives `months` from the earliest/latest `ledger_entries` month through the current (or viewed) month.
- `/accounts`: header is `[Accounts] [Previous] [<Month Year> ▾] [Next]` plus an inline right-side `Changes vs <MonthName>` (name only, shown when `hasBalances && prevMonth`; the old standalone caption was removed). `Save balances`, `Skip this month`, `Clear balances` (with Confirm/Cancel), and `Show archived` moved to a row directly under the 4 widget boxes, in that order. `accounts/page.tsx` derives `months` from balance/skip/archive-period months through the current (or viewed) month.
- `npm run lint` + `npm run build` pass; no DB/schema changes.
- Follow-up: the month nav is centered on both pages (3-zone `lg:grid-cols-[1fr_auto_1fr]` header: title left, nav center, actions right; stacks on mobile). `Previous`/`Next` are now `ArrowLeft`/`ArrowRight` icon buttons with aria-labels. On `/accounts` the Save/Skip/Clear/Show-archived row is centered under the widgets and `Save balances` uses the outline variant like the rest.

### Branding and color system (implemented)

- Brand colors taken from the provided SVGs: accent orange `#d85700`; dark grays `#101214` / `#e2e2e2` / `#c6c6c6`; light gray `#545454`. Semantic money colors kept: income/positive `#10b981`, expense/negative + errors `#ef4444`.
- `src/app/globals.css`: `--primary`/`--ring`/`--sidebar-primary` = `#d85700`, `--primary-foreground` = `#101214` (dark text on orange for AA contrast), foreground/muted grays aligned to brand, chart tokens → brand set. Dark background intentionally left as the existing slate (not `#101214`).
- Assets: `public/brand/{logo,icon}-{light,dark}.svg` (dark logo's background rect removed so it sits transparently); `src/components/brand.tsx` exports `BrandLogo`/`BrandIcon` (next/image, unoptimized, light/dark swap via `dark:hidden`/`hidden dark:block`).
- Logo placement: sidebar (desktop expanded + mobile drawer) shows the full logo above the search bar, icon only when collapsed; mobile top bar shows the logo; `/login` shows the full logo above the card. The emerald `Leaf` badge was removed; active nav item is now orange (`bg-primary/10 text-primary`).
- Logo sizing follow-up: `BrandLogo` no longer bakes in a size. The sidebar logo fills the panel width proportionally (`h-auto w-full`, ~80px tall on desktop) and pushes content below it down; collapse/close buttons are absolutely positioned top-right over the logo's empty top strip. Mobile top bar logo is centered and capped at `max-w-[14rem]`. Collapsed sidebar keeps the `size-6` icon.
- Recolored hardcoded chart/UI colors: dashboard (income green, expense red, net worth/accent orange; summary card left borders), stats bars (income/expense/net), category/card `PALETTE` → brand set, `Other`/`Ungrouped`/no-card grays → `#6b7280`, expenses no-entries warning → orange tints.
- PWA: `public/icons/icon.svg` and `src/app/icon.svg` = brand icon on a `#101214` rounded square; `manifest.ts` `theme_color: #d85700`, `background_color: #101214`.
- Data: `supabase/migrations/0006_brand_colors.sql` **applied** — remaps stored `categories`/`cards` colors to the brand palette (RLS preserved). Result: 31 categories `#6b7280`, plus `#d85700`×2, `#f2a65a`×3, `#9ca3af`×3, `#4b5563`×2, `#8c3b00`×2, `#b8865a`×2; all 10 cards `#6b7280`. (The card colors were later replaced by the per-card unique colors in `0007`.)
- `npm run lint` + `npm run build` pass.

### Fonts (implemented)

- Font files live in `src/app/fonts/` (loaded with `next/font/local`, so they are fingerprinted/served by the build; not in `public/`): `Comfortaa-Bold.ttf`, `Comfortaa-Light.ttf`, `LouisGeorgeCafe.ttf`, `LouisGeorgeCafe-Bold.ttf`.
- `src/app/layout.tsx`: `louis` (Louis George Cafe, weights 400/700) → `--font-body`; `comfortaa` (Comfortaa, weights 300/700) → `--font-display`; Geist Mono kept for `--font-mono`.
- `src/app/globals.css`: `--font-sans: var(--font-body)` (all regular text), `--font-heading: var(--font-display)` (headers; raw var is `--font-display` to avoid self-reference), and a base rule `h1, h2, h3 { @apply font-heading }`. Card/Dialog titles already use `font-heading`. Comfortaa has no 600 face, so `font-semibold` headings render the 700 face.
- Removed the stray Windows `*:Zone.Identifier` files from the repo root.

### Expenses page: larger body text (implemented)

- `src/app/globals.css`: added a `.text-scale` scope that overrides the text tokens one full step up (`--text-xs` 12→14, `--text-sm` 14→16, `--text-base` 16→18, `--text-lg` 18→20, `--text-xl` 20→24) and forces in-content `select` / `[data-slot="input"]` / `[data-slot="button"]` to `h-10`. Tailwind v4 emits `font-size: var(--text-*)`, so the token override scales every text utility inside the scope at once.
- `src/app/expenses/expenses-client.tsx`: wrapped the content (sticky totals grid through the Income section) in `<div className="text-scale">`; the header (title, month nav, `Add recurring items` / `By card`) and the no-entries/error banners stay outside so they are unchanged. Dropped `size="sm"` from the in-content Add/Delete buttons so their text scales too.
- Reminder sentence now reads: "Reminder: enter expenses around the 5th of every month."
- `npm run lint` + `npm run build` pass.

Note: `/expenses` body text was later enlarged again (`--text-xs` 18, `--text-sm` 20, `--text-base` 22, `--text-lg` 26, `--text-xl` 32; control height `h-11`). Row breakpoints left at `md` for now; revisit if rows overflow between 768–1024px.
- Sidebar: reversed account sections to Cash → Investments → Loans; added orange rounded borders around each section; disabled account links inside sections (plain text); centered bottom label/icons; icons visible/centered when collapsed; moved Settings/Stats to bottom row.
- DB update: `public.accounts` row `House - We Owe` renamed to `Mortgage`.
- `/expenses` `.text-scale` dialed back one notch to `--text-xs` 16, `--text-sm` 18, `--text-base` 20, `--text-lg` 24, `--text-xl` 30 (control height `h-10`).
- Then made global: `@theme { --text-xs: .875rem; --text-sm: 1rem; --text-base: 1.125rem; --text-lg: 1.25rem }`; removed `.text-scale` wrapper from /expenses; reverted 6 in-content buttons to `size="sm"`; kept card padding, row layout, whole-dollar ideal.
- `/expenses` data-card padding reduced to uniform 16px: removed the `CardContent className="p-4"` overrides (By-category, By-card, Income) so the `Card`'s own `py-4` + default content `px-4` apply (was 32px top/bottom + 16px sides from double padding). Summary widgets/sticky bar left at `p-3`; expand/collapse layout unchanged.
- `/expenses` By-category row header restructured: left = dot · name · `X entries`; right (right-justified) = faded `ideal $XXX` (`text-muted-foreground`) + color-coded `(-$XXX)` (`text-red-600`/`text-green-600`) + total badge. Whole row is the toggle button so it stays clickable. By-card view left unchanged.
- Added `moneyWhole` to `src/lib/money.ts` (Intl currency, 0 fraction digits). `/expenses` By-category ideal + parenthetical now show whole dollars: `idealRounded = Math.round(ideal)`, `difference = categoryTotal - idealRounded`, rendered via `moneyWhole`. Total badge still uses `money` (cents). Categories page unchanged.
- Sidebar: reversed account sections to Cash → Investments → Loans; added `rounded-xl border border-orange-500/40 bg-sidebar/40 p-2` around each section; centered bottom label/icons; bottom icons visible/centered when collapsed; kept label hidden when collapsed.

### Expenses page compact redesign (implemented)

- Reworked `src/app/expenses/expenses-client.tsx` for density (mockup-driven). Client-only; no action/schema/RLS changes.
- Category/By-card/Income boxes are now plain `div.rounded-xl.bg-card.ring-1.ring-foreground/10` (no `Card`), `space-y-2` between them, header `px-3 py-2` with `dot · font-heading name` left and `ideal (whole) · (±diff, red/green) · total (bold) · chevron` right. Expand/collapse preserved via `expanded` Set.
- Saved purchases render as one-line `text-xs text-muted-foreground` rows: `w-20 tabular-nums amount · label · ml-auto ⋯ menu` (base-ui `DropdownMenu`, `MoreHorizontal`). Label = card name in category view, category name in card/income views (`—` for none). Edit/Delete live in the `⋯` menu.
- Add row per box: `Input` (h-8, flex-1, placeholder `Amount (e.g. 12.50+8)`, `title` documents Enter/Shift+Enter) + card `select`/category `select` (h-8) + orange `+` `Button size="icon"` (`variant="default"`). **Note field removed** from the default add form; `parseAmountExpression` + Shift+Enter split preserved.
- New local `EntryDialog` (`ui/dialog`, `sm:max-w-sm`): Amount + Note always; Card shown when `cardOptions` set (category/card views), Category shown when `categoryOptions` set (card/income views). Save → `updateEntry`.
- Header gains the subtitle "Track and manage your household expenses, one category at a time."; the card-filter `select` moved into the header right zone (category view only). Summary widgets trimmed to `p-2` / `text-base` values. Income section `mt-4`.
- `QuickDraft` dropped its `note` field; `newIncome` dropped its `note` field.
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Payment-method archive/delete + unique colors (implemented)

- **Root cause of "can't delete a card":** `deleteCard` archived cards that had ledger entries instead of deleting them, and the Manage list never filtered `archived`. The four names in the report are actually the *name of one archived card* (`Citi, Hill Ink Pref., Hyatt, Will Chase Res`) created by an earlier import — visible on the archived card row, not four separate cards.
- `src/app/categories/actions.ts`: `deleteCard` now always hard-deletes. FKs `ledger_entries.card_id` and `recurring_items.card_id` are `on delete set null`, so past entries keep their amount/category/note and just show as **No card**.
- `src/app/categories/categories-client.tsx` + `page.tsx`: `CardItem` carries `archived`; the Manage dialog splits into **Payment methods** (active) and an **Archived payment methods** section. Active rows have inline rename/color plus **Archive** and **Delete**; the archived section has **Restore** and **Delete**. Delete uses an inline two-step confirm (Delete → Delete/Cancel).
- `src/app/expenses/{page,expenses-client}.tsx`: `cards` query now selects `archived`; archived cards are excluded from the quick-add and card-filter selectors but stay in the **By-card** view so history remains grouped. Recurring already filtered archived.
- PR #4 (`fix/card-archive-and-delete`), squash-merged to `main` as `ff4bbff`.
- **Data migration `0007_card_colors.sql` applied** (PR #5, `d2fd004`): gives every card a distinct color per household, ordered by `sort_order`/`name`, drawing on the household's `category_groups.color` values first then a brand fallback list (`#d85700, #f2a65a, #8c3b00, #b8865a, #d1a37a, #6b7280, #9ca3af, #4b5563, #a15c1e`), guaranteeing ≥9 distinct colors. `PALETTE` in `categories-client.tsx` extended with `#a15c1e`.
- Applied with `npx supabase db push --db-url "$SUPABASE_DB_URL" --yes`; `supabase migration list` confirms `0007` local = remote. Verified live: the 9 active cards now carry 9 distinct colors (the first 9 `category_groups` colors, reused as requested) and the archived card carries the 10th.
- `npm run lint` + `npm run build` pass. No runtime smoke test of the new dialog actions.

### Regular categories legibility (implemented)

- The grouped "Regular categories" rows (`categories-client.tsx` `CategoryRow`) truncated names to ~55px because a fixed `w-20` progress bar + two `w-16` amount columns overfilled the `minmax(0,24rem)` left column. Removed the progress bar, added `shrink-0` to the amount columns, and widened the left column to `minmax(0,30rem)`.
- Group header: group name is `min-w-0 truncate`; the count `Badge` and the `$spent / $budget` total are `shrink-0` (total `whitespace-nowrap`), so the total stays on the same line as the group instead of clipping.
- PR #7, squash-merged as `d1e2355`. `npm run lint` + `npm run build` pass.
- Group headers now carry a faded tint of the group color: `.group-tint` in `globals.css` uses `color-mix(in oklab, var(--group-color) 30%, transparent)` (45% under `.dark`), with `--group-color` set inline per group. Full-bleed via `-mx-4` (cancels the card's `p-4`), `rounded-none`, `px-5`. PR #9 & #11; final `f0e2eb7`.
- In the grouped "Regular categories" widget the faded ideal amount now renders left of the actual month amount, in both category rows and the group header. The group header's two `w-16` columns plus a `w-6` spacer match the rows' `⋯` button, so the group numbers align above the category numbers. PR #13, `72d5df0`.
- Group names are `text-base font-bold` and the group actual total is `text-sm font-bold` (the fonts only ship 400/700 faces, so `font-medium`/`font-semibold` were not real weights). PR #15, `407984b`.

### Per-category icons (implemented, migration applied)

- `supabase/migrations/0008_category_icons.sql` **is applied** — adds nullable `categories.icon text`. Null means "Auto" (name-based fallback), so nothing changes until an icon is picked. No RLS/grant changes needed.
- `src/lib/category-icons.ts` now exports a curated `CATEGORY_ICONS` registry (~70 household/budget icons) + `CATEGORY_ICON_NAMES`, and `categoryIcon({ name, icon })` returns the stored icon when set, else the existing regex rules, else `Tag`. The old `categoryIcon(name)` signature is gone; the 3 call sites on `/categories` pass the category object.
- `categories/page.tsx` selects `icon`; `Category` type has `icon: string | null`.
- `CategoryDialog` (used by both New and Edit via `⋯ → Edit`) has an **Icon** section: search box, wrapped icon grid, and an **Auto** button to clear the override. Server actions (`addCategory`/`updateCategory`) validate the icon name against the registry.
- Icons render in the grouped list, the flat "All regular categories" list, and the excluded list. PR #17, `5842fa3`.

### Categories recurring controls (implemented)

- `/categories` is now a master–detail page. Left column: the grouped **Regular categories** card with `Spending` / `Ideal` column labels; each row is a selectable button (highlighted when selected) with a compact **Repeat** toggle (orange = on, muted = off; `onToggleRecurring`), plus the `⋯` menu (edit / move group / move / exclude / archive / delete). Group headers show `spent / budget`.
- Right column: **Spending trend** bar chart with a `3M/6M/12M/YTD` selector (reuses the dashboard `PERIODS` pattern), **Key metrics**, and a **category detail panel** for the selected category — header (icon, name, group name, group-color circle), `Spending | Ideal | Difference` stats, **Details** (name + group), **Recurring expense** switch (monthly amount + card picker), **Monthly budget (optional)** switch (sets/clears `ideal_override` = trailing-average budget), and footer **View all transactions** (+ `Delete`).
- `CategoryDetail` uses uncontrolled inputs keyed by value (no setState-in-effect), committing on blur via `setCategoryRecurring` / `updateCategory`.
- Removed the top-left donut/summary card and the "All regular categories" card (per the approved mockup); kept the Excluded categories card and the Manage dialog.
- Header is a 3-zone grid (title + month / `MonthNav` centered / New category · New group · Manage). `page.tsx` defaults the selected month to the **latest recorded month** (max `monthly_category_totals` month) and builds `months` with `monthRange`.
- New action `setCategoryRecurring(categoryId, { enabled?, amount?, card_id? })` in `categories/actions.ts`: reuses/inserts the category's active `recurring_items` row (`start_month` = current real month, `note`/`end_month` null), soft-off via `active=false`, validates amount ≥ 0 and card ownership. No schema/RLS change.
- Removed the standalone `/recurring` page (`src/app/recurring/*`) and its sidebar nav item; recurring is managed on `/categories`.
- `/expenses` now accepts `?category=<id>` (`page.tsx` → `focusCategory`) which pre-expands and scrolls that category into view; used by "View all transactions".
- New `src/components/ui/switch.tsx` (base-ui Switch). `npm run lint` + `npm run build` pass. No runtime smoke test.

## Checks

- `npm run lint` and `npm run build` pass after every phase.
- Migrations `0001`–`0008` are applied to the live project (`supabase migration list`: local = remote).

## Known issues and unfinished work

- **No runtime smoke-testing has been done.** All phases were verified only via lint + build. Realtime, the `ideal_category_amount` RPC, and every page remain untested against the live database.
- `/api/keepalive` (`src/app/api/keepalive/route.ts`) uses the service-role key from a public route; it now requires `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set. Set `CRON_SECRET` in Vercel.
- Untracked duplicate SVGs in the repo root (`hillybudget-{light,dark}-{icon,logo}.svg`) duplicate `public/brand/` and are intentionally left uncommitted; delete them or ignore them.

## Next action

- Run an end-to-end runtime smoke test against the live project (create household, add categories/cards, add ledger entries, verify Realtime refresh, accounts balances, skip-month, stats, and import preview/confirm).
- Optionally clean up the untracked root SVG duplicates and add the `⋯ → Edit → Icon` picker to any other surfaces that show category icons.
