-- Fog of War — initial schema
-- Run this in the Supabase SQL editor (Dashboard -> SQL -> New query) once.
-- Everything is locked to the signed-in user via row-level security.

-- ---------------------------------------------------------------------------
-- explored_cells: the binary "explored" grid. One row per H3 cell ever seen.
-- ---------------------------------------------------------------------------
create table if not exists public.explored_cells (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  h3         text        not null,
  source     text        not null default 'timeline',
  first_seen timestamptz not null default now(),
  primary key (user_id, h3)
);

alter table public.explored_cells enable row level security;

create policy "own cells" on public.explored_cells
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- pins: manually marked places with an adjustable candlelight radius.
-- ---------------------------------------------------------------------------
create table if not exists public.pins (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  name       text        not null,
  lat        double precision not null,
  lng        double precision not null,
  radius_m   double precision not null default 3000,
  created_at timestamptz not null default now()
);

alter table public.pins enable row level security;

create policy "own pins" on public.pins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- settings: per-user fog tuning (one row per user).
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  user_id    uuid        primary key default auth.uid() references auth.users on delete cascade,
  darkness   double precision not null default 0.72,
  reach_m    double precision not null default 450,
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;

create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
