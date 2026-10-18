# hillybudget

Household expense tracker. Next.js 16 App Router (TypeScript), Tailwind v4, shadcn/ui, Supabase (Auth/Postgres/Realtime/RLS). Hosting on Vercel.

Commands: `npm install`; `npm run dev`; `npm run build`; `npm run lint`. Place Supabase keys in `.env.local` from `.env.local.example`.

Rules:
- All tables are household-scoped. Never bypass RLS with the service role in client code.
- Money uses `numeric(12,2)` and is formatted with currency + tabular numerals. Render amounts with `money` / `moneyWhole` from `src/lib/money.ts`.
- Horizontal style: no comments unless asked.
- Enable Realtime only for `ledger_entries` and `account_balances`.
- Migrations live in `supabase/migrations`. The DB URL is `$SUPABASE_DB_URL` in `.env.local`.
- Fonts: `--font-body` (Louis George Café) and `--font-display` (Comfortaa) ship only 400 and 700 faces. There is no 500/600 face, so `font-medium`/`font-semibold` do not render a distinct weight — use `font-bold` for emphasis.
- Category icons: use `categoryIcon({ name, icon })` from `src/lib/category-icons.ts`. Per-category overrides are stored in `categories.icon`; add any new icon to the `CATEGORY_ICONS` registry so it is selectable and passes server-side validation.
- Group-header tint: `.group-tint` in `globals.css` derives from a per-element `--group-color` CSS variable (via inline `style`) and `color-mix`; keep the light/dark percentages distinct for contrast.

Process:
- Make small, focused changes. Avoid unrelated refactors and drive-by edits.
- Inspect existing code before changing it. Follow the conventions already in the file.
- Run the appropriate checks (`npm run lint`, `npm run build`) and report exactly what was tested and what was not. Never claim coverage for checks that were not run.
- Preserve existing Supabase data, RLS policies, authentication, and household access unless I explicitly approve a change. No schema, policy, or auth change without approval.
- Never expose secrets. Never use the service-role key in client-side code, and keep `.env.local` untracked.
- A clean application rebuild on the new from-scratch schema (`ledger_entries`-based) is approved and complete. The database reset has been applied; preserve the new schema, RLS policies, and auth unless I explicitly approve a change.
- Keep `SESSION.md` current at the end of substantial work sessions.

Git workflow:
- Use feature branches (`feat/`, `fix/`, `chore/`, etc.).
- Use Conventional Commits.
- Open PRs for changes (even solo) for review and clean history. Vercel auto-deploys only from `main` (preview deployments are disabled in `vercel.json`). Run local checks before merging.
- Prefer squash merging to `main` for clean main history.
- Commit early and often. Commit each self-contained change as soon as it works (and type-checks) instead of batching. Don't let many features stack up in one working tree for a single giant commit; if a batch does accumulate, split it into logical commits before pushing.
- Agents: make a commit as part of finishing a piece of work, and ask before leaving large uncommitted changes.

Database:
- Migrations `0001`–`0008` are applied to the live project (`supabase migration list` shows local = remote). Head is `0008_category_icons.sql`.
- Apply pending migrations with `npx supabase db push --db-url "$SUPABASE_DB_URL" --yes`; verify with `npx supabase migration list --db-url "$SUPABASE_DB_URL"`.
- Schema/column/policy/auth changes still require explicit approval; data migrations (e.g. `0007` card colors, `0006` brand colors) were approved individually.
