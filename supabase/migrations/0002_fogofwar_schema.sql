-- Fog of War: move tables out of `public` into their own schema.
-- The Supabase project is shared by all txmnzia apps, one schema per app.
-- Run once in the SQL editor, after 0001. Safe to re-run: `if exists` makes
-- each move a no-op once done. Data, RLS policies and grants move with the
-- tables.
--
-- Then: Settings -> Data API -> Exposed schemas -> add `fogofwar` -> Save.

create schema if not exists fogofwar;
grant usage on schema fogofwar to anon, authenticated, service_role;
alter default privileges in schema fogofwar
  grant select, insert, update, delete on tables to authenticated;

alter table if exists public.explored_cells set schema fogofwar;
alter table if exists public.pins           set schema fogofwar;
alter table if exists public.settings       set schema fogofwar;

grant select, insert, update, delete on all tables in schema fogofwar to authenticated;
grant all on all tables in schema fogofwar to service_role;
