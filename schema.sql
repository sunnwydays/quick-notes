-- Quick Notes sync tables. Applied to the Supabase project "job-tracker"
-- (the qn_ prefix keeps them apart from that app's tables).

create table public.qn_entries (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  category text not null,
  text text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  -- Set by the server on every write; clients pull rows with synced_at past their cursor.
  synced_at timestamptz not null default clock_timestamp()
);

create table public.qn_categories (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp(),
  primary key (user_id, name)
);

create index qn_entries_user_synced on public.qn_entries (user_id, synced_at);
create index qn_categories_user_synced on public.qn_categories (user_id, synced_at);

alter table public.qn_entries enable row level security;
alter table public.qn_categories enable row level security;

create policy "own entries" on public.qn_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own categories" on public.qn_categories for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Notes never change after saving, except to be deleted, and a delete is final.
create function public.qn_entries_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.deleted_at := coalesce(old.deleted_at, new.deleted_at);
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

-- Categories can be removed and re-added, so the newer change wins.
create function public.qn_categories_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

create trigger qn_entries_touch before insert or update on public.qn_entries
  for each row execute function public.qn_entries_touch();
create trigger qn_categories_touch before insert or update on public.qn_categories
  for each row execute function public.qn_categories_touch();
