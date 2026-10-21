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
- `no_ideal` is now honored on `/expenses`: `page.tsx` selects it and forces the ideal to 0 (RPC override null), so categories marked "no ideal" on `/categories` hide the ideal block. Category rows use fixed-width columns (`w-36` ideal, right-aligned, placeholder when absent; `w-24` right-aligned total) so ideal and totals align down the list with consistent padding from the total.
- **By-card is read-only**: entry rows render without the Edit/Delete dropdown (`renderEntryRow` gained an `editable` flag) and the per-card quick-add row was removed — By-card is now a view-only recap per card; all editing stays in category view and the Income section.
- **Clear expenses** button in the action row: `clearMonth(month)` server action deletes all expense-`ledger_entries` for the viewed month (income untouched), behind a local `ConfirmDialog` (same pattern as `/accounts`). Useful for re-testing `Add recurring items` on a month. It is pushed to the right edge of the action row (`ml-auto`) and sits alone there; the left controls are grouped (search, card filter, `By card` between `All cards` and `Add recurring items`) so they wrap independently and never drag `By card` to the right side.
- **Ideal numbers faded 50%** site-wide (`opacity-50`): the /expenses ideal column (ideal + over/under chip together), the /categories table Ideal cell, and the /categories panel Ideal/Difference stats. Editable controls and the ideal-window setting stay full strength. `npm run lint` + `npm run build` pass. No runtime smoke test.
- /categories list-card header renamed from "Regular categories" to **"Groups + Categories"**.

## Data & Backups (2026-10-21)

- **JSON backup feature** (no schema change, no new dependency; restore deferred pending design review):
  - `src/lib/backup.ts`: format version (`hillybudget`/v1), the 12 backup tables in dependency order (households, household_members, household_settings, category_groups, categories, cards, accounts, recurring_items, skipped_months, account_archive_periods, ledger_entries, account_balances), numeric-column normalization (`numeric(12,2)` arrives as strings), filename helper `hillybudget-backup-YYYY-MM-DD.json`, localStorage key helpers.
  - `GET /api/backup`: server route; runs as the authenticated user so RLS scopes every query; available to **both members**; streams JSON with `Content-Disposition: attachment`.
  - Excluded (deliberately): `import_batches` (no member insert policy), `profiles` (self-RLS), `invite_code`, `auth.users`/secrets; `created_by`/`import_batch_id` would be stripped at restore time.
  - Settings: `backup-client.tsx` adds a **Data & Backups** card (both members) with Back Up Now, last-backup timestamp, success (record counts) / failure messages, and notes that the plain-JSON file needs a private location and that a download is not a verified off-site backup. Page h1 changed to "Settings"; import section stays owner-gated under its own heading.
  - **31-day reminder**: `src/components/backup-reminder.tsx` shows a muted line on `/expenses` when the localStorage-recorded backup is >31 days old; never claims a backup exists. `src/lib/use-last-backup.ts` shares the value via `useSyncExternalStore` (the React hooks lint rule forbids setState-in-effect localStorage reads).
- Restore design (approved as a *design only*): future single-transaction `security definer` RPC `restore_backup(p_payload)` with in-DB validation; restore only into the caller's household; refuses non-empty households without explicit overwrite confirmation; requires a migration and explicit approval before building.
- Post-inspection fixes (backup validated against the real export): `invite_code` stripped from exported `households` rows; wording made download-accurate ("Last downloaded:" in Settings, "Last backup download: X days ago" banner); `hillybudget-backup-*.json*` ignored in `.gitignore` (covers the Windows `Zone.Identifier` artifact, which was deleted). Real export verified: 12 tables, household-consistent, no orphans/duplicate IDs/no secrets, 593 entries spanning 2025-01→2026-10; only 1 member row exported (re-export after the husband joins). Restored file lives outside the repo.

## Restore — Phase A (2026-10-21)

- **Approved plan**: restore in two phases. Phase A (this): TS validation + preview UI, no writes. Phase B (needs approval): migration `0011_restore_backup.sql` with a `security definer` `restore_into_new_household(p_payload jsonb)` RPC (single transaction, advisory lock, dependency-order inserts with preserved IDs and remapped household_id), confirm route, and scratch-DB end-to-end tests. Decisions locked: owner-only restore, new-household mode only (destructive repair mode deferred), vitest dev dependency approved.
- `src/lib/restore.ts`: TS validator for the v1 backup format — app/schema-version/exported-at/household checks, per-table row shapes (uuid/date/month/enum/number/bool specs mirroring the DB constraints), per-table duplicate IDs, in-file FK integrity (`category_id`/`card_id`/`recurring_item_id`/`account_id`/`group_id`), single-household consistency, numeric-string normalization, `import_batch_id` stripped, optional `created_by`; warnings (never failures) for kind-vs-category mismatch, households-row mismatch, and duplicate category names; error lists capped at 20 for display.
- `src/app/api/restore/preview/route.ts` (new): owner-gated POST route; 25MB cap (`RESTORE_MAX_BYTES`); returns preview {household name from the file, exported date, per-table counts, warnings} plus current household name — **no writes**.
- `src/app/settings/restore-client.tsx` (new): file pick → validate → preview card (counts grid, warnings, "creates a brand-new household owned by you" explainer); Phase A shows "Restore execution requires the restore migration (next phase) — no data has been changed." Mounted owner-only in settings between the backup and import cards.
- `vitest.config.ts` + `tests/restore.test.ts` (12 fixture tests: valid payload, invalid JSON, wrong schema version, missing tables block, duplicate IDs, orphan ledger category, cross-household row, missing required field, bad month format, negative recurring amount, import_batch_id stripping, kind-mismatch warning). `package.json` gains `npm test = vitest run`; dependency added: **vitest@3 (dev-only)** — vitest 5 needs @types/node ≥22, project pins 20.
- Checks: `npm run lint`, `npm run test` (12/12), `npm run build` all pass. Real-backup spot check skipped — the user's downloaded JSON was moved out of the workspace. Route registered at `/api/restore/preview`. Not verified: live route against the deployed DB (needs an authenticated session); execution path does not exist yet (Phase B).
- The user's real home household has 1 member row in the (moved) backup; re-export after the husband joins for membership completeness.

## Restore — Phase B (2026-10-21)

- **State: `0011` and `0012` are both applied to the live project** (pushed 2026-10-21 with explicit authorization; `migration list` shows local = remote for 0001–0012). The deployed function was verified read-only: `security definer`, `search_path=""`, EXECUTE for `authenticated` only (`anon`/`service_role` denied), body contains the ID remap + the `(restored <date>)` name suffix and no longer inserts source row IDs. Existing data confirmed unchanged after the push: 1 household ("WHill"), 1 membership, 44 categories, 593 ledger entries, 179 account balances.
- `supabase/migrations/0011_restore_backup.sql` — **frozen as applied** (do not edit; byte-identical to the body deployed on 2026-10-21). Original version inserted the backup's row IDs.
- `supabase/migrations/0012_restore_backup_remap.sql` — **applied**; supersedes the function body with (1) **ID remapping** and (2) **household naming**. Same guarantees as `0011`: single transaction, owner-only, new household only, never touches existing households/memberships/profiles/auth users.
- **ID remap:** every data table's PK is a *global* `id uuid primary key`, so `0011`'s behavior collided with rows that still exist in the source household (871 such IDs in the user's real backup) and with any earlier restore from the same backup, aborting the whole restore. `0012` keeps five `old → new` maps in `jsonb` variables (`category_groups`, `categories`, `cards`, `accounts`, `recurring_items` — exactly the tables other rows can reference), assigns `gen_random_uuid()` to every inserted row, and dereferences each dependent FK through its map (`categories.group_id`→groups, `recurring_items.category_id/card_id`, `ledger_entries.category_id/card_id/recurring_item_id`, `account_balances.account_id`, `account_archive_periods.account_id`). Restoring the same backup repeatedly now yields distinct, complete households. Original IDs are not preserved (nothing in the app references them; `import_batches` linkage was already dropped).
- **Household naming (user chose option B):** the restored household is named `<backup name> (restored <export date UTC>)`, e.g. `WHill (restored 2026-10-21)`, so it is distinguishable from the source household. Implemented identically in SQL (`regexp_replace` strips any existing suffix, then appends) and in TS (`restoredHouseholdName` in `src/lib/restore.ts`); the preview route returns `newHouseholdName` so the UI shows the exact name that will be created.
- **Validator bug found via the user's real backup (fixed):** `household_members` (PK `(household_id, user_id)`) and `household_settings` (PK `household_id`) have **no `id` column**, so a real `select *` export has no `id` on those rows — the Phase A validator demanded one and rejected legitimate backups ("household_members: a row has a missing or invalid id"). `src/lib/restore.ts` now exempts exactly those two tables from the id/duplicate-id rule; the strict id rule stays for all 10 id-bearing tables. The shared fixture had invented ids for those two tables, which is why the bug slipped through — the fixture now matches a real export.
- `src/app/api/restore/confirm/route.ts` (new): owner-gated POST route; re-reads the file text and re-runs the full Phase A validator server-side (never trusts the preview or client data), 25MB cap, then calls the RPC with the **server-validated** payload; returns `{restored: {householdId, householdName, inviteCode, counts}}` or a clean error (422).
- `src/app/settings/restore-client.tsx`: confirm step — backup household name, export date, per-table counts, warnings, the exact new household name, **Restore as New Household** button (double submission disabled while in flight); success state shows record total, new household name, invite code, a **Switch to restored household** button, and how-to-switch wording — only after the RPC commits.
- **Cookie-based household switcher** (approved choice): `getHousehold()` in `src/lib/session.ts` honors an httpOnly `hillybudget:household` cookie (uuid-validated, membership re-checked via RLS **on every request**) before falling back to oldest-membership; `switchHousehold(id)` server action in `src/app/settings/actions.ts` verifies membership, sets the cookie (1 year), revalidates the layout; `src/app/settings/switch-household.tsx` adds a **Switch household** card to Settings (shown when the user has >1 household). No schema/RLS/auth changes.
- `tests/fixtures/restore-fixture.json` + `tests/restore-e2e.mjs` (~50 assertions, 14 cases): happy-path restore with content/relationship preservation across all 10 data tables, fresh-id assertions, exactly-one-household-added + current-household-untouched, RLS isolation, non-owner + anon rejection, 9 atomic-rejection cases, repeated restores succeeding. **Never executed** (no Docker; user declined) — `node --check` only proves it parses.
- **Offline dry run against the user's real backup** (`hillybudget-backup-2026-10-21(2).json`, 395KB, git-ignored in the repo root): the old validator reproduced their exact two errors; after the fix → **ok, 0 warnings, 872 rows** (1 settings, 11 groups, 44 categories, 9 cards, 15 accounts, 12 recurring, 3 skipped months, 5 archive periods, 593 entries, 179 balances). A preflight emulating every DB constraint (unique names, hex colors, enums, `numeric(12,2)`/`numeric(8,4)` ranges, first-of-month dates, FK integrity, `unique(account_id, month)`, duplicate ids) found **no violations**. The file itself is clean.
- **Payload contract fix (app-only, Option A):** the first restore attempt failed with `Unsupported backup format` — the confirm route sent the *normalized* validator output `{household, exported_at, tables}` while the deployed RPC expects the *backup envelope* (`app`/`schema_version` markers + all **12** sections). Nothing was written by the failed attempt (verified: 1 household, 44 categories, 593 entries). Fixed in `src/lib/restore.ts`: the validated payload now carries `app`, `schema_version` and all 12 sections (10 validated data tables with their original ids intact + `households`/`household_members` as passthrough the RPC imports neither of), and `RESTORE_RPC_SECTIONS` declares the contract in code, mirrored by the SQL section list in `0012`. New vitest case pins the contract. Known wart: the RPC requires 12 sections but consumes 10 — a future `0013` could narrow it.
- Checks: `npm run lint`, `npm test` (17/17), `npm run build` pass. Not run: local-DB e2e, runtime restore smoke test.

## Restore — first successful restore (2026-10-21)

- The user ran the restore in Settings → Data & Backups and it **succeeded**: a new household `WHill (restored 2026-10-21)` was created (id `bbb2a83d-dc9b-458d-ae25-9f458ed5c755`, invite code `20C41CEC`; the original `WHill` keeps `90EE9B4F`), owned by the same user, with the calling user as its single member.
- **Parity verified read-only against the live DB** — restored vs original: 1 member, 1 settings, 11 category groups, 44 categories, 9 cards, 15 accounts, 12 recurring items, 3 skipped months, 5 archive periods, 593 ledger entries, 179 balances (872 rows); entry total $364,570.99 (income $180,529.87 / expense $184,041.12) identical; 22 months (2025-01 → 2026-10); 34 income / 559 expense rows; category flags identical (32 no-ideal, 0 excluded, 14 with icon, 2 with ideal override); 12 active recurring items; balance sum $9,089,968.34; `ideal_window` trailing12. **0 id collisions** between the households (1,186 ledger rows / 1,186 distinct ids → the remap worked); `import_batch_id` left on 0 rows; `created_by` kept on the 592 entries authored by the user and nulled on the 1 entry with an unknown user. The original household was untouched.
- The user chose to **keep both households and stay in the original `WHill`**; the restored copy stays as a complete duplicate and is reachable via Settings → Switch household. The restored household's invite code `20C41CEC` is the one to give the other member.

## Merge to main (2026-10-21)

- PRs #30, #31, #32 squash-merged to `main` in that order: `1f007a3` (#30 search), `5f4883b` (#31 no_ideal/ideal alignment/clear expenses/header), `cf995e6` (#32 backup + restore Phase A/B + household switcher). 27 files, +5,533/−902 since `0df8472`. `main` now carries migrations `0001`–`0012`.
- Squashing rewrote the earlier commits, so #31 and #32 conflicted with the new `main`; resolved by merging `main` into each branch and keeping the branch side (a superset: it already contained the squashed work) — `SESSION.md` and `src/app/expenses/expenses-client.tsx` for #31, `SESSION.md` for #32. Lint + build (and 17/17 vitest on #32's branch) re-verified before each push; conflict markers checked per AGENTS.md. Merged branches deleted locally and on the remote.
- Vercel deploys only from `main`, so the deployed site now has the backup card, the 31-day reminder, the restore flow (owner-gated) and the household switcher. The live database already carried `0011`+`0012`, so the deployed app could restore immediately.
- PR #21 remains open (base `feat/categories-recurring-controls`); nothing else was touched.

## Deployment to Vercel (2026-10-21)

- The app is now **live on Vercel**: project `riseandshine/hillybudget` (team `riseandshine`, hobby plan, Node 24.x, region `iad1`) at **https://hillybudget.vercel.app** (also `https://hillybudget-riseandshine.vercel.app`).
- Created via the Vercel CLI (device login as `hgm2112`): `vercel link` → new project, `vercel --prod` → deployment `dpl_AfHs6PtNUzuGbxWERdSt7s3FL7uc` (Ready, 60s, built with Turbopack, 21 routes). The repo is linked through `.vercel/` (gitignored).
- **Production env vars** (values piped from `.env.local` via stdin, never printed): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Config), `SUPABASE_SERVICE_ROLE_KEY` (Secret), `CRON_SECRET` (Secret, 32-byte hex generated 2026-10-21). `SUPABASE_DB_URL` is deliberately **not** set on Vercel (migrations only).
- The cron from `vercel.json` (`/api/keepalive`, `0 9 */3 * *`) is **registered and enabled** on the project (`crons.definitions`, `disabledAt: null`).
- **Live smoke test (read-only, unauthenticated):** `/`, `/login`, `/dashboard`, `/expenses` → 200; `/api/keepalive` → 401 without the secret, `{"ok":true,...}` with it. The service-role route works against the live DB. Authenticated page walks are still unverified.
- `vercel env ls` shows only the 4 expected vars; the uploaded build contains no `.env*`, `.xlsx`, or backup files; the working tree is clean (`.env.local` picked up a `VERCEL_OIDC_TOKEN` from the CLI — still untracked).
- **GitHub auto-deploy: DONE.** The Vercel GitHub App was installed for the `hillybudget` repo and `vercel git connect` succeeded. Project `link` = `{type: github, repo: hillybudget, org: hgm2112, productionBranch: main}`; `previewDeploymentsDisabled = true` (set via `PATCH /v9/projects/{id}` — it is a project setting, not a `vercel.json` option), `gitForkProtection` on.
- **Auto-deploy verified end-to-end:** merging PR #34 to `main` (commit `af727bf`) produced a new Production deployment (`hillybudget-n3c81b57e-riseandshine.vercel.app`, Ready in 22s) with the aliases `hillybudget.vercel.app`, `hillybudget-riseandshine.vercel.app` and `hillybudget-git-main-riseandshine.vercel.app`; the commit SHA on the production target matches the merge commit. `main` is the only branch that deploys.
- `AGENTS.md` updated: corrected the "preview deployments are disabled in `vercel.json`" claim (it is a project setting), added a Deployment section, and fixed the migration head (`0001`–`0012`, not `0001`–`0010`).

## Orange favicon (2026-10-21)

- The favicon/PWA icon is now the brand orange instead of gray. PR #36 (squash-merged to `main` as `c62dc6d`) → auto-deployed.
- `src/app/icon.svg` and `public/icons/icon.svg` (kept byte-identical): the disc fill changed `#C6C6C6` → `#D85700` (the logo orange) and the `#D85700` accent dot was **removed** — it would be invisible against an orange disc. The `#101214` tile and the carved dark wave are unchanged.
- `src/app/favicon.ico` was **regenerated**: it still held the stock `create-next-app` Next.js "N" logo, which is what `/favicon.ico` served to Safari/older browsers. It is now a real 32-bit ICO built from the new SVG at 48/32/16 (BMP DIB + AND mask, transparent rounded corners).
- Verified on the live deployment: `/icon.svg` and `/icons/icon.svg` serve `#D85700`; `/favicon.ico` decodes to 3 sizes whose dominant colors are `16,18,20,255` (tile) and `216,87,0,255` (disc) with no Next.js green. The `<link rel="icon">` hashes changed, so browsers re-fetch.
- The in-app brand icon (`public/brand/icon-{light,dark}.svg`, used by `BrandIcon` in the sidebar/top bar) was deliberately **left gray**; the wordmark logos are untouched.
- Generator script used (one-off, not committed): renders the SVG to 48/32/16 with `sharp` and packs a 32-bit ICO. Re-run it if the icon artwork changes again.
- `npm run lint` + `npm run build` pass. No app, schema, RLS, or auth changes.

## Settings → Household box (2026-10-21)

- PR #38 (squash-merged to `main` as `c144fc8`) replaces the "Switch household" card with a **Household** box: family code + copy button, **Who's in family**, **Your display name**, **Join family**, **Create family**, and **Your families** (switch + delete).
- `src/app/settings/household-card.tsx` (new client component) replaces `src/app/settings/switch-household.tsx` (deleted). `src/app/settings/actions.ts` gains `joinFamily`, `createFamily`, `setDisplayName`, `deleteFamily`; `src/app/settings/page.tsx` now always renders the box (it carries the family code and member list, not just the switcher).
- **`supabase/migrations/0013_profiles_household_select.sql` is applied** (local = remote). A row-level SELECT policy on `public.profiles` so co-members can read each other's `display_name`; the self-only policy stays (policies OR). No table/column/grant/Realtime change. Approved by the user before applying.
- **Delete family:** owner-only (checked in code *and* enforced by the existing `households_delete` RLS policy); refuses when the user belongs to only one family; the confirm dialog requires typing the family name. Implementation deletes `ledger_entries` + `recurring_items` first (to clear the two `ON DELETE RESTRICT` FKs on `categories`), then the household row, and lets the cascade clear the rest. Runs on the signed-in session — the service role is never used.
- **Pre-flight against the live DB** (throwaway household, self-cleaning): the ordered delete succeeded with **zero leftover rows** across all 12 child tables, and live row counts (2 households / 2 members / 88 categories / 1186 entries / 358 balances / 24 recurring) were identical before and after. A bare `DELETE FROM households` also succeeded (Postgres handles the cascade ordering despite RESTRICT), but the ordered delete is kept as belt-and-braces.
- **RLS policy verified** with three simulated users inside a rolled-back transaction: a co-member's `display_name` is visible, a non-member's is hidden, `anon` still has no access. Rollback confirmed 0 leftover households, 1 profile, 1 auth user.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test` (17/17) pass. The **authenticated** UI was not smoke-tested by an agent — the user is signed in and can walk the flows.

## Checks

- `npm run lint`, `npm test`, and `npm run build` pass after every phase.
- Migrations `0001`–`0012` are applied to the live project (`supabase migration list`: local = remote).

## Known issues and unfinished work

- **No runtime smoke-testing has been done** for the pre-restore phases: those were verified only via lint + build (+ vitest unit tests). Realtime, the `ideal_category_amount` RPC, and the authenticated pages are still untested against the live database — the deployed site has only been checked unauthenticated (`/login` 200, keepalive 401/200).
- **The restore path has now executed once, successfully**, against the live project (2026-10-21) — see "Restore — first successful restore". What is still unverified: the local-DB e2e suite (`tests/restore-e2e.mjs`, ~50 assertions) has never been run (no Docker; the user declined), so the failure/rollback paths have only been reasoned about, not exercised.
- **No "leave/delete household" action exists.** The restored duplicate (`WHill (restored 2026-10-21)`) can only be removed by a manual cascade delete, which needs explicit approval; there is no UI for it.
- Each additional confirmed restore creates **another** household (by design — restore never overwrites). The Settings switcher moves between them; the default (no cookie) is the oldest membership, i.e. `WHill`.
- The RPC still requires all **12** backup sections although it consumes 10 (`households` and `household_members` travel as passthrough); a future `0013` could narrow the list, but the app currently sends all 12 to match the deployed contract.
- `/api/keepalive` (`src/app/api/keepalive/route.ts`) uses the service-role key from a public route; it requires `Authorization: Bearer $CRON_SECRET`, and `CRON_SECRET` **is now set** in Vercel (verified 401 without / 200 with). Rotate it with `vercel env add CRON_SECRET --environment production --force`.
- The duplicate brand SVGs in the repo root (`hillybudget-{light,dark}-{icon,logo}.svg`) are **tracked** in git and duplicate `public/brand/`; they are deployed with the app. Delete them from the repo and keep only `public/brand/`.
- The user's backup file `hillybudget-backup-2026-10-21(2).json` (plus its Windows `Zone.Identifier` artifact) sits in the repo root; both are git-ignored (`.gitignore:49`) and must stay untracked. Consider moving the file out of the repo.

## Next action

- **Log in on https://hillybudget.vercel.app** and walk the live app (dashboard, expenses, categories, accounts, stats, Settings → Data & Backups + Restore preview) — the first real runtime smoke test of the deployed app.
- Invite the other member into `WHill (restored 2026-10-21)` with invite code `20C41CEC` (the original `WHill` code `90EE9B4F` is unchanged) — the user is currently staying in `WHill` and will switch when ready.
- Decide whether to keep the restored duplicate long-term, and if not, scope a household-deletion feature (cascades to that household's rows only) for review before any SQL.
- Optionally run the disposable-stack e2e (`npx supabase start && npx supabase db reset && npm run test:e2e`) at some point to cover the failure/rollback paths that the live run did not exercise.
