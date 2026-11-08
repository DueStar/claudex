-- Claudex — the leaderboard (run once after schema.sql).
-- Supabase: SQL Editor → New query → paste this whole file → Run. Safe to run again.
--
-- What it does
--   * leaderboard: one row per trainer who signed in. The numbers are worked
--     out HERE, by a trigger, from the game copy the app uploads to trainers
--     (the app never sends them itself, so they cannot simply be typed in).
--   * Nobody reads or writes the table directly (RLS on, no policies). Three
--     functions are the only way in:
--       leaderboard_board(board)        the top 100 and the caller's own place (anyone, signed in or not)
--       leaderboard_profile()           the caller's nickname / public flag / partner
--       leaderboard_set_profile(...)    join, leave, rename (signed in)
--   * Only trainers who chose to be public appear, under their nickname; the
--     Google name and email in trainers.display_name are never shown.
--   * The week runs Monday 00:00 to Sunday 24:00, Korean time.

create table if not exists public.leaderboard (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  nickname     text,
  is_public    boolean not null default false,
  partner      integer,                      -- the dex number shown beside the nickname
  caught       integer not null default 0,   -- species in the dex
  shiny        integer not null default 0,   -- shiny Pokémon owned
  legends      integer not null default 0,   -- legendary and mythical species in the dex
  week_start   date,                         -- the Monday (KST) week_catches belongs to
  week_catches integer not null default 0,   -- wild catches since that Monday
  flagged      boolean not null default false, -- numbers the game cannot make: kept off the board
  updated_at   timestamptz not null default now()
);
create unique index if not exists leaderboard_nickname_key on public.leaderboard (lower(nickname)) where nickname is not null;
alter table public.leaderboard enable row level security;
revoke all on public.leaderboard from anon, authenticated;

-- This week's Monday in Korean time
create or replace function public.leaderboard_week() returns date
language sql stable as $$ select date_trunc('week', now() at time zone 'Asia/Seoul')::date $$;

-- The numbers from a game copy (trainers.state)
create or replace function public.leaderboard_stats() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  legend_ids int[] := array[150,151,249,250,251,382,383,384,385,386,483,484,487,489,490,491,492,493,494,643,644,646,647,648,649,716,717,718,719,720,721,791,792,800,801,802,807,808,809,888,889,890,893,898,1007,1008,1024,1025];
  wk date := public.leaderboard_week();
  wk_ms bigint := (extract(epoch from (wk::timestamp at time zone 'Asia/Seoul')) * 1000)::bigint;
  n_caught int; n_shiny int; n_legends int; n_week int; n_mons int;
begin
  select count(*) into n_caught from jsonb_object_keys(coalesce(new.state->'caught', '{}'::jsonb));
  select count(*) filter (where k::int = any(legend_ids)) into n_legends
    from jsonb_object_keys(coalesce(new.state->'caught', '{}'::jsonb)) k where k ~ '^\d+$';
  select count(*),
         count(*) filter (where (m->>'shiny')::boolean is true),
         count(*) filter (where m->>'how' in ('wild', 'pity', 'attendance') and (m->>'at') ~ '^\d+$' and (m->>'at')::bigint >= wk_ms)
    into n_mons, n_shiny, n_week
    from jsonb_each(coalesce(new.state->'mons', '{}'::jsonb)) as e(k, m);
  insert into public.leaderboard as l (user_id, caught, shiny, legends, week_start, week_catches, flagged, updated_at)
  values (new.user_id, n_caught, n_shiny, n_legends, wk, n_week,
          -- what the game cannot make: more species than exist, more shinies than Pokémon, an impossible week
          n_caught > 1025 or n_shiny > n_mons or n_week > 1500,
          now())
  on conflict (user_id) do update set
    caught = excluded.caught, shiny = excluded.shiny, legends = excluded.legends,
    week_start = excluded.week_start, week_catches = excluded.week_catches,
    flagged = excluded.flagged, updated_at = now();
  return new;
end $$;

drop trigger if exists trainers_leaderboard on public.trainers;
create trigger trainers_leaderboard after insert or update of state on public.trainers
  for each row execute function public.leaderboard_stats();

-- Trainers who signed in before this file ran: work out their numbers once
update public.trainers set state = state;

-- The top 100 of a board, plus the caller's place and neighbours (±5) when they are public
-- (place: ties share it; rn: the row's order, so the app can tell where a gap is)
drop function if exists public.leaderboard_board(text);
create or replace function public.leaderboard_board(board text)
returns table (place bigint, rn bigint, nickname text, partner integer, value integer, is_me boolean)
language sql stable security definer set search_path = public as $$
  with scored as (
    select l.user_id, l.nickname, l.partner,
           case board
             when 'caught' then l.caught
             when 'shiny' then l.shiny
             when 'legends' then l.legends
             when 'week' then case when l.week_start = public.leaderboard_week() then l.week_catches else 0 end
           end as value,
           l.updated_at
    from public.leaderboard l
    where l.is_public and not l.flagged and l.nickname is not null
  ),
  ranked as (
    select *, rank() over (order by value desc) as place, row_number() over (order by value desc, updated_at asc) as rn
    from scored where value is not null
  ),
  me as (select rn from ranked where user_id = auth.uid())
  select r.place, r.rn, r.nickname, r.partner, r.value, coalesce(r.user_id = auth.uid(), false)
  from ranked r
  where r.rn <= 100 or exists (select 1 from me where abs(r.rn - me.rn) <= 5)
  order by r.rn
$$;

-- The caller's own settings and numbers (also when not public)
create or replace function public.leaderboard_profile()
returns table (nickname text, is_public boolean, partner integer, caught integer, shiny integer, legends integer, week_catches integer, flagged boolean)
language sql stable security definer set search_path = public as $$
  select l.nickname, l.is_public, l.partner, l.caught, l.shiny, l.legends,
         case when l.week_start = public.leaderboard_week() then l.week_catches else 0 end, l.flagged
  from public.leaderboard l where l.user_id = auth.uid()
$$;

-- Join, leave or rename. Nicknames: 2–12 letters (Korean, Japanese kana/kanji, English, digits, _), not taken.
-- Answers 'ok', 'signed-out', 'no-game' (sync first), 'bad-nickname' or 'taken'.
create or replace function public.leaderboard_set_profile(p_nickname text, p_public boolean, p_partner integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  nick text := nullif(btrim(p_nickname), '');
begin
  if auth.uid() is null then return 'signed-out'; end if;
  if not exists (select 1 from public.leaderboard where user_id = auth.uid()) then return 'no-game'; end if;
  if nick is not null and nick !~ '^[가-힣ぁ-ゖァ-ヺー一-龯A-Za-z0-9_]{2,12}$' then return 'bad-nickname'; end if;
  if p_public and nick is null then return 'bad-nickname'; end if;
  if nick is not null and exists (select 1 from public.leaderboard where lower(nickname) = lower(nick) and user_id <> auth.uid()) then return 'taken'; end if;
  update public.leaderboard
     set nickname = nick, is_public = coalesce(p_public, false),
         partner = case when p_partner between 1 and 1025 then p_partner else null end
   where user_id = auth.uid();
  return 'ok';
end $$;

-- Supabase grants new functions to anon and authenticated by default: take that back, then give out only these
revoke all on function public.leaderboard_board(text), public.leaderboard_profile(), public.leaderboard_set_profile(text, boolean, integer), public.leaderboard_stats(), public.leaderboard_week() from public, anon, authenticated;
grant execute on function public.leaderboard_board(text) to anon, authenticated;
grant execute on function public.leaderboard_week() to anon, authenticated;
grant execute on function public.leaderboard_profile() to authenticated;
grant execute on function public.leaderboard_set_profile(text, boolean, integer) to authenticated;
