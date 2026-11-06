-- Claudex — cloud copy of each trainer's game.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
--
-- One row per signed-in user. Row-level security: everyone reads and writes
-- only their own row (auth.uid() = user_id). The app never uses the secret key.

create table if not exists public.trainers (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  caught_count integer not null default 0,
  seen_count   integer not null default 0,
  state        jsonb not null,
  updated_at   timestamptz not null default now()
);

alter table public.trainers enable row level security;

drop policy if exists "trainers: read own row" on public.trainers;
create policy "trainers: read own row" on public.trainers
  for select using (auth.uid() = user_id);

drop policy if exists "trainers: insert own row" on public.trainers;
create policy "trainers: insert own row" on public.trainers
  for insert with check (auth.uid() = user_id);

drop policy if exists "trainers: update own row" on public.trainers;
create policy "trainers: update own row" on public.trainers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "trainers: delete own row" on public.trainers;
create policy "trainers: delete own row" on public.trainers
  for delete using (auth.uid() = user_id);

-- A leaderboard later can read caught_count / display_name through a view
-- or a security-definer function; nothing public is exposed for now.
