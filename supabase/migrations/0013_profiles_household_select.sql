-- Lets co-members read each other's display name so the Settings "Household"
-- card can show who is in the family. Previously the only policy on
-- public.profiles was self-only, so a member could see their own row but not
-- anybody else's.
--
-- Row-level SELECT policy only: no tables, columns, grants, or Realtime change.
-- The existing self-only policy (profiles_select) stays; policies are OR'ed
-- together, so a profile is visible when it is your own or when you share a
-- household with its owner. public.is_household_member is security definer
-- with an empty search_path, so the subquery cannot recurse into this policy.

create policy profiles_household_select on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.household_members m
      where m.user_id = public.profiles.user_id
        and public.is_household_member(m.household_id)
    )
  );
