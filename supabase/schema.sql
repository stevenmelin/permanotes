-- PermaNotes sync database. Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Safe to run more than once.

create table if not exists public.folders (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid,
  name text not null default '',
  sort double precision not null default 0,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid,
  title text not null default '',
  html text not null default '',
  tags text[] not null default '{}',
  sort double precision not null default 0,
  pinned double precision,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id uuid,
  name text not null default '',
  mime text not null default '',
  size bigint not null default 0,
  storage_path text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default now()
);

-- Upgrades for databases created with PermaNotes 1.0.0 / 1.0.1
alter table public.notes add column if not exists pinned double precision;
alter table public.notes alter column sort type double precision;
alter table public.folders alter column sort type double precision;

create index if not exists folders_sync on public.folders (user_id, server_updated_at);
create index if not exists notes_sync on public.notes (user_id, server_updated_at);
create index if not exists attachments_sync on public.attachments (user_id, server_updated_at);

-- Every write gets a server timestamp, so devices never miss a change because of a wrong clock.
create or replace function public.pn_touch() returns trigger language plpgsql set search_path = '' as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists folders_touch on public.folders;
create trigger folders_touch before insert or update on public.folders for each row execute function public.pn_touch();
drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before insert or update on public.notes for each row execute function public.pn_touch();
drop trigger if exists attachments_touch on public.attachments;
create trigger attachments_touch before insert or update on public.attachments for each row execute function public.pn_touch();

-- Each signed-in user only ever sees their own notes.
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;

drop policy if exists "own folders" on public.folders;
create policy "own folders" on public.folders for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own attachments" on public.attachments;
create policy "own attachments" on public.attachments for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live updates between devices
do $$
begin
  begin alter publication supabase_realtime add table public.folders; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.attachments; exception when duplicate_object then null; end;
end $$;

-- Private file storage for images, attachments and audio (one folder per user)
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
on conflict (id) do nothing;

drop policy if exists "pn own files read" on storage.objects;
create policy "pn own files read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "pn own files write" on storage.objects;
create policy "pn own files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "pn own files update" on storage.objects;
create policy "pn own files update" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "pn own files delete" on storage.objects;
create policy "pn own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
