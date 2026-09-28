# Fog of War 🗺️

A personal, RPG-style **fog-of-war map of your real life**. The whole world starts
darkened; the places you've actually been glow like candlelight in the gloom and
fade softly back into the dark at their edges. A little gamification for your
travels.

Built as an installable **PWA** (phone + desktop), with a hand-styled **parchment**
map and a **candlelight** fog model:

- **Explored is binary.** Ten GPS points in one neighbourhood or one — the area is
  simply *explored*. No dots, no per-point markers; overlapping visits merge into a
  single lit region.
- **The world is darkened, not erased.** Unexplored land is dimmed but still faintly
  visible, so it reads as mystery rather than a black void.
- **Soft candle edges.** Each explored place is fully clear at its core and fades
  gradually to the ambient dark — the border is always a gradient, never a line.

Both the darkness and the candle reach are tunable in-app.

## Data sources

- **Google Timeline import** — upload a Google location export (the newer on-device
  Timeline JSON *or* an older Takeout download; the importer reads whatever you have).
- **Manual pins** — search a city and drop an adjustable candlelight around it.

Planned next: photo geodata (iOS / Google Photos exports), live GPS logging, and
gamification stats (% of the world lit, countries unlocked).

## Tech

- **React + Vite + TypeScript**, PWA via `vite-plugin-pwa`
- **MapLibre GL** with a custom parchment style over **OpenFreeMap** vector tiles
  (free, keyless OpenStreetMap tiles — no API key, no signup)
- Place search via **Nominatim** (keyless)
- Candlelight fog as a 2D-canvas overlay synced to the map (`src/map/FogLayer.ts`)
- **H3** hexagon grid for the binary explored set (`src/lib/h3.ts`)
- **Supabase** (Postgres + row-level security + magic-link auth) for storage and
  cross-device sync

## Setup

The map and place search are keyless. The only thing to configure is Supabase,
which stores your data and syncs it between devices. Both Supabase values are
*public* client keys (they ship to the browser) — never put a Supabase
`service_role` key in the frontend.

1. **Install**
   ```bash
   npm install
   cp .env.example .env
   ```

2. **Supabase** — create a project at <https://supabase.com/dashboard>, then
   Settings → API. Put the Project URL in `VITE_SUPABASE_URL` and the `anon public`
   key in `VITE_SUPABASE_ANON_KEY`. Finally, open the SQL editor and run
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) once to
   create the tables (they're locked to your account via row-level security).

3. **Run**
   ```bash
   npm run dev      # http://localhost:5173
   npm run build    # production build + service worker
   ```

Sign in with your email (magic link), then import your Timeline or drop a pin to
start lifting the fog.

## How to export your Google location data

- **Phone (newest):** Google Maps app → your profile photo → *Your Timeline* →
  Settings → *Location & privacy* → **Export Timeline data** → save the JSON.
- **Takeout:** <https://takeout.google.com> → Deselect all → tick
  *Location History (Timeline)* → export → unzip → upload the JSON file(s).

The in-app import screen has these steps too.
