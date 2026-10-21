# SESSION.md

Working state for hillybudget. Keep current at the end of each substantial work session. No secrets or credentials belong in this file.

## Project state and stack

- Next.js 16 App Router (TypeScript), Tailwind v4, shadcn/ui, Supabase (Auth / Postgres / Realtime / RLS), hosted on Vercel.
- Git: `github.com:hgm2112/hillybudget`, branch `main`. Migrations live in `supabase/migrations`.
- Supabase project (correct): `geajkzgdqflrpefhltwm.supabase.co`. Do not run destructive SQL against other projects.
- Commands: `npm run dev`, `npm run build`, `npm run lint`.

## Rebuild (approved; app rebuilt on the live schema)

A clean application rebuild on a from-scratch, `ledger_entries`-based schema. The database reset has been applied to the correct project; the new schema, RLS policies, and auth are live. The app was rebuilt server-first (RSC + Server Actions) page by page; the cleaned `Expenses.xlsx` has been imported (see below). Migrations through `0010` are applied (see Database in `AGENTS.md`).

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
- New **`/dashboard`** (`src/app/dashboard/{page,dashboard-client}.tsx`): eyebrow-free `PageHeader` with a 3M/6M/12M/YTD/LIFETIME selector, four range-based summary cards (income, expenses, net cash flow, net worth), and a 2×2 Recharts grid (spending trend area, income-vs-expenses bars, spending-by-category horizontal bars, net worth line). Data: `categories`, `monthly_category_totals`, `accounts`, `account_balances`. Net worth = each account's latest balance at or before the month (assets = liquid+retirement, liabilities = loan), forward-filled across months with no snapshot. No Realtime. No migration needed.
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

- `/categories` is now a master–detail page. Left column: the grouped **Regular categories** card with `Spending` / `Ideal` column labels; each row is a selectable button (highlighted when selected) with a compact **Repeat** toggle (orange = on, muted = off; `onToggleRecurring`). Group headers show `spent / budget`.
- Right column: **Spending trend** bar chart with a `3M/6M/12M/YTD` selector (reuses the dashboard `PERIODS` pattern), **Key metrics**, and a **category detail panel** for the selected category — header (icon, name, group name, group-color circle), `Spending | Ideal | Difference` stats, **Details** (name, group, type, color, icon), **Excluded from budget** switch, **Recurring expense** switch (monthly amount + card picker), **Monthly budget (optional)** switch (sets/clears `ideal_override` = trailing-average budget), and footer **View all transactions** + **Archive** + **Delete**.
- `CategoryDetail` uses uncontrolled inputs keyed by value (no setState-in-effect), committing on blur via `setCategoryRecurring` / `updateCategory`; the inline **Type** select and **Icon** picker commit on change.
- Removed the top-left donut/summary card and the "All regular categories" card (per the approved mockup); kept the Excluded categories card and the Manage dialog.
- Header is a 3-zone grid (title + month / `MonthNav` centered / New category · New group · Manage). `page.tsx` defaults the selected month to the **latest recorded month** (max `monthly_category_totals` month) and builds `months` with `monthRange`.
- New action `setCategoryRecurring(categoryId, { enabled?, amount?, card_id? })` in `categories/actions.ts`: reuses/inserts the category's active `recurring_items` row (`start_month` = current real month, `note`/`end_month` null), soft-off via `active=false`, validates amount ≥ 0 and card ownership. No schema/RLS change.
- Removed the standalone `/recurring` page (`src/app/recurring/*`) and its sidebar nav item; recurring is managed on `/categories`.
- `/expenses` now accepts `?category=<id>` (`page.tsx` → `focusCategory`) which pre-expands and scrolls that category into view; used by "View all transactions".
- New `src/components/ui/switch.tsx` (base-ui Switch). `npm run lint` + `npm run build` pass. No runtime smoke test.

### Categories row menu removed → inline detail + drag reorder (implemented)

- Removed the per-row `⋯` menu on `/categories`. Its actions now live in the detail panel: **Move to group** = the inline **Group** select; **Edit** (Type/Color/Icon) = inline **Type** select, **Color** swatches + custom picker, and **Icon** search/grid/`Auto` (reusing the `CATEGORY_ICON_NAMES` registry); **Exclude from budget** = an **Excluded from budget** switch; **Archive** = an **Archive** button in the footer; **Delete** unchanged. `CategoryDialog` is now a create-only form (**New category**: name/type/color/icon; the group/budget fields were dropped as they were ignored on create).
- Replaced Move up/down with **drag-to-reorder** (native HTML5 DnD, desktop-only, no new dependency). Category rows reorder **within their own group**; group headers reorder the groups. A `GripVertical` handle appears on row/group hover (`opacity-0 group-hover:opacity-100`); the dragged item dims and the drop target gets a primary ring. Cross-group drops are ignored (move groups via the panel's Group select).
- New actions in `categories/actions.ts`: `reorderCategories(orderedIds)` and `reorderGroups(orderedIds)` — validate household ownership, assign `sort_order = index`, `revalidatePath("/categories")`. Removed the now-unused `moveCategory` and `moveGroup`.
- `ManageDialog` lost its group **Move up/down** arrow buttons (drag on the main list replaces them).
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Per-category "no ideal" (implemented, migration applied)

- `supabase/migrations/0009_category_no_ideal.sql` **is applied** — adds `categories.no_ideal boolean not null default false` (no RLS/grant/Realtime changes).
- **Ideal** = the auto trailing-average from `ideal_category_amount` (window set in Manage → "Ideal spending window"); the previous "Monthly budget (optional)" switch was really a **manual override** of it, so it is now labelled **Custom ideal**.
- The detail panel's controls are a compact equal-thirds segmented control (`grid grid-cols-3 divide-x rounded-lg border`) — `Recurring expense │ Custom ideal │ Ideal` — each expanding its content beneath the row (Recurring → amount + card; Custom ideal → amount input). The three are parallel toggles.
- Groups-section polish: removed the tinted background on the "Regular categories / Spending / Ideal" header; the per-group bands ("House", "Utilities") are now `rounded-lg`; the recurring-off `Repeat` icon is fainter (`text-muted-foreground/20`). Columns are reversed to **Ideal (left) · Spending (right)** in the header, group totals, rows, and the detail panel stats (Ideal · Spending · Difference).
- `Ideal` toggle (default on) is the **no-ideal** control: turning it off sets `no_ideal = true` and clears any custom amount (`ideal_override = null`); turning it on restores the auto/ideal. Turning **Custom ideal** on forces `no_ideal = false`. When no-ideal, the Custom ideal toggle is disabled and the amount input is hidden.
- No-ideal behaviour: the Ideal **column** on the row renders blank; in the panel the **Ideal** and **Difference** stats show `—` (Difference no longer implied); the category still appears in Regular categories and its spending still counts. Group ideal totals are unaffected (forced ideal = 0). `/expenses` already hides the ideal label at 0, so no client change there.
- `categories/page.tsx` and `expenses/page.tsx` select `no_ideal` and force `ideal = 0` (and `p_override = null`) for no-ideal categories; `updateCategory` accepts `no_ideal`.
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Collapsible groups + compact detail section (implemented)

- Group headers in the **Regular categories** card are now collapsible: clicking a header toggles its rows (`collapsedGroups` `Set` in `CategoriesClient`, local component state only — default expanded, resets on reload). A `ChevronDown`/`ChevronRight` precedes the group color dot; the drag grip calls `stopPropagation` so reordering never toggles. Totals/badge stay in the header.
- The detail panel's **Details** section is more compact: Row 1 is a `grid sm:grid-cols-3` (**Category name · Group · Type**); Row 2 is a `grid sm:grid-cols-2` (**Color · Icon**), side by side.
- The **Icon** cell shows a curated preview row (`PREVIEW_ICONS = home, car, utensils, shoppingBag, heartPulse, zap, wifi, wallet`); if the current icon isn't in that set it is prepended so the selection stays visible. The last item is a chevron button (`showAllIcons`) that expands the existing search input, `Auto` button, and full `CATEGORY_ICON_NAMES` grid.
- Only `categories-client.tsx` changed (UI-only, no schema/DB change). `npm run lint` + `npm run build` pass. No runtime smoke test.

### Reporting/display fixes (implemented)

- `/dashboard` charts no longer show an empty current calendar month. `dashboard-client.tsx` splits the window: `flowMonths` (ends at the latest **ledger** month) drives spending-trend, income-vs-expenses, spending-by-category, and the Income/Expenses summaries; `netMonths` (ends at the latest **balance** month) drives the net-worth chart. `accounts/accounts-client.tsx` balance-change color is direction-aware (`improving`): asset increase = green, loan decrease = green.
- Sidebar section label for `loan` is now **Loan** (`app-sidebar.tsx`).
- Sidebar balances and all `/accounts` amounts use `moneyWhole` (whole dollars, no cents); the per-row percent stays at 2 decimals.
- `/stats` now defaults `selectedMonth` to the latest recorded entry month (`stats/page.tsx`) instead of the current month.
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Income corrections + default income (migration applied)

- `supabase/migrations/0010_income_fixes.sql` **is applied** (data-only; no schema/RLS/policy change). It: reclassifies `Sign Up Bonuses` from expense → income and flips its entry to `+400`; flips the 11 negative `Ebay Earnings` entries to positive (`abs`); deletes 3 October-2026 test Groceries entries (by id); creates one active `recurring_items` row for the `Income` category (`7500`, `start_month` 2025-01-01); and sets every `Income` ledger entry to `7500`, linking them to that recurring item so "Add recurring items" dedupes and fills `7500` for new months.
- Result: default income is **$7,500/month** from 2025-01 onward; eBay earnings and sign-up bonuses add on top (e.g. 2026-02 income = 7500 + 8008.75 + 400 = 15,908.75). Change the base by editing the `Income` recurring item.
- `src/lib/import/normalize.ts` now stores income-category amounts as positive (`Math.abs`) so re-imports don't reintroduce negatives.
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Session wrap (2026-10-18)

- Branch `feat/categories-recurring-controls` pushed to origin; **PR #20** open against `main` (https://github.com/hgm2112/hillybudget/pull/20), MERGEABLE, not yet merged. Vercel deploys only from `main`.
- 11 commits this session: `ed14311` recurring controls + master-detail; `16b463c` inline detail + drag reorder + no-ideal; `b9d26d4` equal-thirds toggle row + groups polish; `a48a457` swap Ideal/Spending; `ced6273` collapsible groups + compact detail; `2c43321` loan-decrease green; `7ed567a` sidebar "Loan"; `a011289` whole-dollar sidebar/accounts; `0473980` dashboard/stats last-recorded window; `909301f` income signs + default $7500 (migration 0010); `2a13b06` dashboard flow/net windows.
- Migrations `0001`–`0010` applied (local = remote); head `0010_income_fixes.sql`.
- Working tree clean except the untracked root SVGs.
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Dashboard lifetime + net-worth fixes (2026-10-19)

- **Axis formatting:** added `moneyCompact` to `src/lib/money.ts` (`$15K`, `$1.2M`). The dashboard's three value Y-axes and the category X-axis use it with `width={48}`, fixing clipped tick labels (previously `money` rendered cents wider than `width={56}`). Tooltips still use `money` for exact cents.
- **Spending by category:** still top 10 (`slice(0, 10)`), fixed `h-64` card. Added `interval={0}` to its category `YAxis` so all 10 names render instead of every other one (Recharts' default `preserveEnd` dropped ticks at ~21px band spacing).
- **LIFETIME period:** added to the dashboard `PERIODS` selector (default stays `12M`). `windowMonths(period, anchor, floor)` now takes a floor; `flowFloor`/`netFloor` are the earliest ledger/balance months, so LIFETIME spans `monthRange(floor, anchor)` for the flow charts and the net-worth line independently.
- **Net-worth forward-fill:** `netWorthSeries` now walks months in order and carries each account's most recent balance at or before each month (instead of only summing balances recorded that month). This removes false cliffs when a snapshot is missing. The summary card still uses the latest snapshot per account. This intentionally reverses the earlier "recorded months only, no forward-fill" behavior.
- **Data backfill:** inserted the missing `account_balances` row for `401k - Principal` at `2025-08-01` = **$171,488.50**, the midpoint of July `$168,500` and September `$174,477` (interpolated; no real August statement). One-off service-role upsert on `(account_id, month)`; no migration added. Result: Aug 2025 forward-filled net worth is ~$270,428 between July ~$267,223 and September ~$279,022 (previously a false $72,839 dip).
- Remaining artifact: October 2025 still drops (recorded net ~$205k) because `Mortgage` and the Schwab/HSA accounts are first recorded that month; forward-fill cannot infer earlier balances. Backfill those if the real history is wanted.
- **Chart tooltips:** Recharts' default tooltip hardcodes a white box and no label color, so dark mode showed light-on-white text. Added a `.recharts-default-tooltip` override in `globals.css` (background `#e2e2e2` brand gray in light / `--popover` in dark, `--popover-foreground` text, border, `--radius-md`, shadow); `!important` only for the inline background/border. Fixes `/dashboard`, `/stats`, and `/categories` tooltips in both themes.
- **Spending by category tooltip value:** its `<Bar>` has no `fill` (colors come from per-row `<Cell>`s), so Recharts' `entry.color` was `undefined` and the item fell back to the hardcoded `#000` (black on the dark popover). Added `itemStyle={{ color: "var(--popover-foreground)" }}` to that `<Tooltip>` and `fill="var(--popover-foreground)"` to its `<Bar>` (Cells still color the bars). Other charts keep their series-colored values.
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Accounts page: loan card removed, grouped balances (2026-10-19)

- Removed the `"{name} (loan)"` detail card from `/accounts` (projected payoff, Remaining/Original/Principal paid/Percent paid, and the Original amount / Interest rate / Monthly payment / Start date inputs). The **Debt** and **Net worth** summary tiles stay; net worth still subtracts `monthTotal("loan")`, and loans are still tracked by monthly balance (the loan row keeps its Save/Archive/Delete and change color).
- The **Balances for {month}** list is now grouped **Liquid → Retirement → Loan** (same `sort_order` within each group) with a plain horizontal rule between groups (no section labels).
- Loan metadata is dropped from the UI entirely, including the loan-only fields in the Add-account form. `accounts/page.tsx` no longer selects them and `addAccount`'s four loan fields are now optional. `updateAccount` remains exported but is no longer called from the client.
- The DB columns `accounts.{original_amount,interest_rate,monthly_payment,start_date}` and their existing data are **preserved** (no schema change, no migration); the app simply stops reading/writing them.
- `npm run lint` + `npm run build` pass. No runtime smoke test.
- Superseded by the Accounts page redesign below (which reuses `accounts.original_amount` for the loan paid-off bar).

### Accounts page redesign (implemented)

- Full redesign of `/accounts` (`src/app/accounts/accounts-client.tsx`): header (title · `MonthNav` · "Changes vs `<latest earlier month with balances>`"), four flat summary cards (Liquid / Retirement / Debt / Net worth — compact, colored dot, ~28px tabular value, change chip; **Net worth is intentionally not emphasized/dark**), and a single **Balances for `<Month Year>`** card with helper text, save status, "Carry forward from `<prev>`", and a **⋯** menu (Clear balances for this month w/ confirm · Show archived · Skip/Unskip this month).
- Balances are grouped **Liquid → Retirement → Loans** with a pill header (Liquid `#4A7BA3`, Retirement `#7767A6`, Loans `#D85700`; literal hex, per request), "N accounts", subtotal, and a change chip. Rows are `name | progress | $ input | change chip | ⋯` (stacked on mobile). The dashed **+ Add account** button sits at the bottom.
- **Autosave** replaces all per-row Save/Archive/Delete buttons and the top Save balances: saves on blur and Enter via `saveBalances` (upsert on `(account_id, month)`), shows Saving… / All changes saved / "Couldn't save. Retry", never writes unchanged/invalid values, and Enter/Tab moves focus to the next account's input. Inputs have a `$` prefix, right alignment, thousands separators after blur, an `aria-label`, and evaluate simple arithmetic (`12000+450`) through `parseBalanceInput`.
- **Progress column**: liquid/retirement show a share-of-group bar (hidden when the group has one account) + percent; loans show a paid-off bar + "X% paid off · $Y paid" (clamped 0–100), or an "Add original loan amount" link when `accounts.original_amount` is unset.
- **Realtime**: subscribes to `account_balances` (filtered by `household_id`) and calls `router.refresh()`; the reconcile effect never overwrites a focused or dirty input. Archived accounts keep history, are hidden by default, and are excluded from totals (unchanged `account_archive_periods` behavior). Edit/Delete flow through a new `AccountDialog` (create + edit: name, type, color, and — for loans — Original loan amount) and a `ConfirmDialog` for Delete/Clear.
- New pure helpers in `src/lib/accounts.ts` (`parseBalanceInput`, `formatBalance`, `deltaInfo`, `sharePercent`, `payoffInfo`, `previousRecordedMonth`, `latestBalanceBefore`, `carryForwardItems`, `GROUP_ORDER`). Empty states cover "no accounts" and "no balances yet for `<month>`".
- `accounts/page.tsx` now selects `original_amount` only and passes `householdId`; `addAccount`'s loan fields are optional (reused the existing `accounts.original_amount` — **no migration, no schema/RLS change, no data touched**). Unit tests were skipped (no test runner in the repo).
- `npm run lint` + `npm run build` pass. No runtime smoke test; Realtime and autosave were not exercised against the live DB.
- Merged to `main` as `db7d995` (`Merge feat/accounts-redesign`); the full-width page change is in `4832bf5`.

### Post-account-redesign session update (2026-10-19)

- Accounts redesign completed on `feat/accounts-redesign` (subgrid + relative 62% bars + group-total centering + 13rem fixed column) and merged to `main` (`db7d995`) together with the full-width page change (`4832bf5`).
- The `/expenses` redesign was attempted but failed because the groups fetch captured settings in the wrong order; it was fully reverted to `2cb7dd5` (`a83adcc` records the revert).

### Accounts alignment, header total, and formatted inputs (2026-10-20)

- PR #25 (`fix/accounts-group-alignment`): the group total/chip keeps its position in the balances card; the 62% progress tracks (share-of-group and loan payoff) are now **left-aligned** in their column so they sit under the group totals. An earlier attempt centered the total over the bars was reverted (`e515a80` → `4babe75`).
- PR #26 (`feat/accounts-header-and-input-format`): in the `/accounts` grouped balances, the group total + change chip moved inline right after the account count — `[LIQUID] [6 accounts] $107,684 [+$11,096]`; the group header is a single full-span flex row (dropped the subgrid column split).
- Balance inputs now display **`$` + thousands separators** (`$12,696`): new `formatCurrencyInput` in `src/lib/accounts.ts`, used by the month seed, the Realtime reconcile effect, `onBlur`, "Carry forward", and previous-month placeholders. Saved values are unchanged — `parseBalanceInput` already strips `$`/commas and still supports arithmetic (`12000+450`).
- `npm run lint` + `npm run build` pass. No runtime smoke test.

### Account colors follow their group (2026-10-20)

- `GROUP_COLORS` moved from `accounts-client.tsx` into `src/lib/accounts.ts` (single source). Group colors stay fixed: Liquid `#4A7BA3`, Retirement `#7767A6`, Loan `#D85700`; not user-editable.
- Add/Edit Account no longer has a Color picker. The saved `accounts.color` is always set to the account's group color (`GROUP_COLORS[kind]`), so editing/saving normalizes any old value to the group color. The `/accounts` row dot already renders `GROUP_COLORS[account.kind]`.
- Account "groups" are the hardcoded `account_kind` enum (`liquid`, `retirement`, `loan`) — no group table/UI; a new household starts with no group headers, and `+ Add account` → Type is how an account enters a group.

### `/expenses` grouped view (2026-10-20)

- Restyled `/expenses` to match `/accounts`: the 4 widgets (Income / Expenses / Net / Entries) are now summary cards (`rounded-xl border bg-card`, dot + uppercase label, `text-2xl` `moneyWhole`, change chip vs the previous recorded month). `page.tsx` fetches all `ledger_entries` (`category_id, amount, month`) to derive `previousTotals`.
- Removed the "Track and manage your household expenses…" subtext and the "No entries recorded for…" banner.
- `All cards` / `Add recurring items` / `By card` moved under the widgets.
- One card titled `Expenses for {Month Year}` with helper `Type an amount, then Shift+Enter to continue to another amount.`; the grouped expense rows and the Income section live inside it. By-card view unchanged.
- Header uses the `/accounts` 3-zone grid (title left, `MonthNav` centered, empty right) with `mb-4`; `All cards` / `Add recurring items` / `By card` sit under the widgets.
- Expense categories are grouped by `categories.group_id` using the existing `category_groups`, with an `Ungrouped` fallback — same shape as `/categories`. `page.tsx` now queries `category_groups` and selects `group_id`.
- Group headers use `.group-tint` (group color) with a `size-3.5` dot and `text-base font-bold` name; category row dots are `size-2.5` and colored with the **group** color.
- **Live search bar** (first in the action row): filters by category name (case-insensitive) as you type; hides non-matching categories, auto-expands matches, filters entries in By-card view, and combines with the card filter.
- `no_ideal` is now honored on `/expenses`: `page.tsx` selects it and forces the ideal to 0 (RPC override null), so categories marked "no ideal" on `/categories` hide the ideal block. Category rows use fixed-width columns (`w-36` ideal, right-aligned, placeholder when absent; `w-24` right-aligned total) so ideal and totals align down the list with consistent padding from the total. `npm run lint` + `npm run build` pass. No runtime smoke test.

## Checks

- `npm run lint` and `npm run build` pass after every phase.
- Migrations `0001`–`0010` are applied to the live project (`supabase migration list`: local = remote).

## Known issues and unfinished work

- **No runtime smoke-testing has been done.** All phases were verified only via lint + build. Realtime, the `ideal_category_amount` RPC, and every page remain untested against the live database.
- `/api/keepalive` (`src/app/api/keepalive/route.ts`) uses the service-role key from a public route; it now requires `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set. Set `CRON_SECRET` in Vercel.
- Untracked duplicate SVGs in the repo root (`hillybudget-{light,dark}-{icon,logo}.svg`) duplicate `public/brand/` and are intentionally left uncommitted; delete them or ignore them.

## Next action

- Redo the `/expenses` layout (4 widgets + input card + grouped categories) in `/expenses` files only, fixing the groups/settings fetch order.
- Run an end-to-end runtime smoke test against the live project (create household, add categories/cards, add ledger entries, verify Realtime refresh, accounts balances, skip-month, stats, and import preview/confirm).
- Optionally clean up the untracked root SVG duplicates and add the inline Icon picker to any other surfaces that show category icons.
