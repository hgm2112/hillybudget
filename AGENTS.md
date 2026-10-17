# hillybudget

Household expense tracker. Next.js 16 App Router (TypeScript), Tailwind v4, shadcn/ui, Supabase (Auth/Postgres/Realtime/RLS). Hosting on Vercel.

Commands: `npm install`; `npm run dev`; `npm run build`; `npm run lint`. Place Supabase keys in `.env.local` from `.env.local.example`.

Rules:
- All tables are household-scoped. Never bypass RLS with the service role in client code.
- Money uses `numeric(12,2)` and is formatted with currency + tabular numerals.
- Horizontal style: no comments unless asked.
- Enable Realtime only for `ledger_entries` and `account_balances`.
- Migrations live in `supabase/migrations`.

Process:
- Make small, focused changes. Avoid unrelated refactors and drive-by edits.
- Inspect existing code before changing it. Follow the conventions already in the file.
- Run the appropriate checks (`npm run lint`, `npm run build`) and report exactly what was tested and what was not. Never claim coverage for checks that were not run.
- Preserve existing Supabase data, RLS policies, authentication, and household access unless I explicitly approve a change. No schema, policy, or auth change without approval.
- Never expose secrets. Never use the service-role key in client-side code, and keep `.env.local` untracked.
- A clean application rebuild on the new from-scratch schema (`ledger_entries`-based) is approved and underway. The database reset has been applied; preserve the new schema, RLS policies, and auth unless I explicitly approve a change.
- Keep `SESSION.md` current at the end of substantial work sessions.

Git workflow:
- Use feature branches (`feat/`, `fix/`, `chore/`, etc.).
- Use Conventional Commits.
- Open PRs for changes (even solo) for review and clean history. Vercel auto-deploys only from `main` (preview deployments are disabled in `vercel.json`). Run local checks before merging.
- Prefer squash merging to `main` for clean main history.
- Commit early and often. Commit each self-contained change as soon as it works (and type-checks) instead of batching. Don't let many features stack up in one working tree for a single giant commit; if a batch does accumulate, split it into logical commits before pushing.
- Agents: make a commit as part of finishing a piece of work, and ask before leaving large uncommitted changes.
