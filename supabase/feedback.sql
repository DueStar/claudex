-- spawn — feedback from the app and the site, written only.
-- Run once in Supabase: SQL Editor → New query → paste → Run (safe to run again).
--
-- Anyone may add a row (the app and the site send with the public key, no sign-in needed);
-- nobody can read, change or delete rows through the API: there is no select, update or
-- delete policy. Read them in the dashboard (Table Editor → feedback).
-- Limits: the text 1–2000 characters, the details small, at most 20 rows a minute from
-- everyone together (a flood stops there), pictures 1 MB, JPEG or PNG, in a private bucket.

create table if not exists public.feedback (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  source       text not null check (source in ('app', 'website')),
  body         text not null check (char_length(body) between 1 and 2000),
  lang         text check (lang in ('ko', 'en', 'ja')),
  context      jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 4096),
  app_version  text check (char_length(app_version) <= 32),
  system       text check (char_length(system) <= 120),
  image_path   text check (char_length(image_path) <= 200),
  user_id      uuid default auth.uid()
);

alter table public.feedback enable row level security;

-- only these columns can be written; id, created_at and user_id are filled in here
revoke all on public.feedback from anon, authenticated;
grant insert (source, body, lang, context, app_version, system, image_path) on public.feedback to anon, authenticated;

drop policy if exists "feedback: anyone can send" on public.feedback;
create policy "feedback: anyone can send" on public.feedback
  for insert to anon, authenticated with check (true);

-- a flood stops at 20 a minute
create or replace function public.feedback_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.feedback where created_at > now() - interval '1 minute') >= 20 then
    raise exception 'feedback: too many right now, try again in a minute';
  end if;
  return new;
end $$;

drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit before insert on public.feedback
  for each row execute function public.feedback_rate_limit();

-- pictures of the spot (the app's pin): a private bucket, added to but never listed or read
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 1048576, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png'];

drop policy if exists "feedback pictures: anyone can add" on storage.objects;
create policy "feedback pictures: anyone can add" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'feedback');
