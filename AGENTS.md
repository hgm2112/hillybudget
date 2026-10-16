# hillybudget

Household expense tracker. Next.js 16 App Router (TypeScript), Tailwind v4, shadcn/ui, Supabase (Auth/Postgres/Realtime/RLS). Hosting on Vercel.

Commands: `npm install`; `npm run dev`; `npm run build`; `npm run lint`. Place Supabase keys in `.env.local` from `.env.local.example`.

Rules:
- All tables are household-scoped. Never bypass RLS with the service role in client code.
- Money uses `numeric(12,2)` and is formatted with currency + tabular numerals.
- Horizontal style: no comments unless asked.
- Enable Realtime only for `entries`, `income`, and `account_balances`.
- Migrations live in `supabase/migrations`.
