# hillybudget

Household expense tracker. Next.js 16 App Router (TypeScript), Tailwind v4, shadcn/ui, Supabase (Auth/Postgres/Realtime/RLS). Hosting on Vercel.

Commands: `npm install`; `npm run dev`; `npm run build`; `npm run lint`. Place Supabase keys in `.env.local` from `.env.local.example`.

Rules:
- All tables are household-scoped. Never bypass RLS with the service role in client code.
- Money uses `numeric(12,2)` and is formatted with currency + tabular numerals.
- Horizontal style: no comments unless asked.
- Enable Realtime only for `entries`, `income`, and `account_balances`.
- Migrations live in `supabase/migrations`.

Process:
- Plan first. Wait for explicit approval before editing files or performing any database operation.
- Make small, focused changes. Avoid unrelated refactors and drive-by edits.
- Inspect existing code before changing it. Follow the conventions already in the file.
- Run the appropriate checks (`npm run lint`, `npm run build`) and report exactly what was tested and what was not. Never claim coverage for checks that were not run.
- Preserve existing Supabase data, RLS policies, authentication, and household access unless I explicitly approve a change. No schema, policy, or auth change without approval.
- Never expose secrets. Never use the service-role key in client-side code, and keep `.env.local` untracked.
- Intended direction is a clean application rebuild, but no rebuild and no database reset is authorized yet. Do not start a rebuild without approval.
- Keep `SESSION.md` current at the end of substantial work sessions.
