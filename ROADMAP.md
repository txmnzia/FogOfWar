# Fog of War — Roadmap & Decisions

_Last updated: 2026-09-29_

A living record of what's shipped, what's decided, and what's parked. Kept so any
session can resume without re-deriving the plan.

## Status

- **Workstream 1 — Map revamp:** ✅ **Shipped & live** (+ engraved labels & warm relief).
- **Workstream 2 — RPG gamification:** 📋 **Spec locked, paused.**
- **Current focus:** further map improvements before starting Workstream 2.

## Project facts

- **Live site:** https://txmnzia.github.io/FogOfWar/
- **Deploy:** pushing to `main` triggers the "Deploy to GitHub Pages" Action.
  Dev happens on branch `claude/rpg-world-exploration-map-mxluut`, then `main` is
  fast-forwarded to deploy.
- **Stack:** Vite + React 18 + TypeScript PWA, MapLibre GL, H3 grid, Supabase,
  base path `/FogOfWar/`.
- **Map is locked north-up** (no rotation/pitch) so the fog overlay can place
  cells with a fast affine transform.

---

## Aesthetic decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Fog metaphor | **Reveal the painted world** — unexplored is hidden; going somewhere paints it in |
| 2 | Map fidelity | Accurate real streets/coasts, painterly skin |
| 3 | Render approach | Restyle MapLibre vectors + texture overlays |
| 4 | Unexplored surface | **Painted clouds**, slow gentle drift |
| 5 | Reveal edge | **Soft feather** (watercolour dissolve) |
| 6 | Basemap | **Grey** fog now; parchment/RPG basemap direction later |

---

## Workstream 1 — Map revamp (DONE)

**Phase 1 — Fog inversion.** Unexplored ground is hidden beneath a drifting
painted-cloud layer (fractal-noise vellum); exploring lifts it to reveal the
full-colour map with a soft feather. Reuses the existing coverage-mask / H3
aggregation pyramid / affine transform / pin-GPS-consistency engine. A
reveal-alpha canvas is precomputed per move so drift frames cost two draws;
drift is throttled (~12fps) and pauses when hidden or reduced-motion.
`darkness` → cloud density, `fade` → feather.
_File: `src/map/FogLayer.ts`._

**Phase 2 — Painterly basemap skin.** Warmer parchment, sage canopy, muted teal
shallows, faint building ink outline, and an **inked coastline** along every
shore/lake edge.
_File: `src/map/parchmentStyle.ts`._

**Phase 3 — Map chrome.** Decorative, non-interactive overlay: paper grain, edge
vignette, framed border, compass rose. All `pointer-events: none`.
_Files: `src/components/MapChrome.tsx`, `src/index.css`._

### Tuned fog constants (baked from the Fog Reveal Studio)

```
DEFAULT_SETTINGS.darkness = 0.90      // src/lib/constants.ts
DEFAULT_SETTINGS.fade     = 0.56
VEIL_PAPER  = [196,190,182]           // src/map/FogLayer.ts (grey cloud set)
VEIL_SHADOW = [150,146,138]
VEIL_WISP   = [232,232,230]
VEIL_CONTRAST      = 0.90
VEIL_WISP_STRENGTH = 0.47
HALO_ALPHA  = 0.35
DRIFT_AMP   = 13
DRIFT_SPEED = 1.4
```

### Tools

- **Fog Reveal Studio** (live tuner): https://claude.ai/artifact/XaudXo8KmhHcthxDGZ1UZg
  — sliders map 1:1 to the constants above; copy values → bake into the app.

### Map polish shipped after WS1

- **Engraved labels** ✅ — place + water names render as a styled overlay in
  Cinzel (places) / IM Fell italic (water), below the fog so they reveal with
  exploration. MapLibre's plain glyph labels removed. Zoom-gated, deduped, capped.
  _File: `src/map/LabelLayer.ts` + `.maplabel` styles in `src/index.css`; fonts in
  `index.html`._ This is also the WS2 realm-label system.
- **Warm shaded relief (hillshade)** ✅ — real mountains/valleys from free
  Terrarium elevation tiles (`terrainDem` raster-dem source), tinted warm to read
  like a hand-shaded map. Map stays flat (no tilt); fog engine unaffected. Tunable
  via the `hillshade` layer paint in `src/map/parchmentStyle.ts`.

### Still parked

- (none from WS1 right now)

---

## Workstream 2 — RPG gamification (SPEC LOCKED, PAUSED)

| Area | Decision |
|---|---|
| Drives | Balance conquest + collection + progression; **light-RPG** tone |
| Realms | Real **countries + regions + cities**; % explored = revealed area ÷ realm area; **procedural crests** |
| POIs | Standardised, **auto-discovered by revealing** their area; **curated** (notable only); no manual placement, no visited/favourite marking |
| POI categories | **Cities & Capitals · Landmarks & History · Nature & Views** |
| Progression | XP → levels → **titles + badges** (no cosmetic unlocks) |
| Scope | **Private only**; map-first, game lives in the ☰ Atlas |
| Build order | **Realms → POIs → Progression** |

### Phase R · Realms & conquest (first) — effort L
- Resolve each explored cell to country/region/city via bundled simplified
  boundary polygons (point-in-polygon, computed once per cell, cached). No
  per-tap network calls.
- % explored per realm = revealed area ÷ realm area. Countries read low, cities
  fill fast — gives both broad reach and deep completion.
- Procedural crest per realm (deterministic heraldic shield: field division,
  tinctures, a charge). One consistent style, always available.
- Atlas **Realms** tab: realms grouped Countries / Regions / Cities, each with
  crest + name + % bar, sorted by progress or recency.

### Phase P · POI discovery (second) — effort M–L
- Pull curated OSM POIs (capitals & major cities; historic
  landmarks/castles/ruins/monuments; peaks/viewpoints/waterfalls/caves/beaches)
  within revealed areas, cached as you go.
- Render as typed teardrop markers with per-category icons, shown only inside
  cleared fog — exploring uncovers the landmarks, not just the ground.
- Discoveries count toward badges; no marking needed.

### Phase X · Progression (third) — effort M
- XP from km² revealed (primary) + reaching new realms + discovering POIs →
  explorer levels + light-RPG titles ladder + achievement badges (first country,
  N regions, N landmarks, coastline reached, …).
- Atlas **Explorer** tab: level, XP bar, title, badge grid, headline stats. No
  unlockables.

### Technical flag
- Countries + regions: solid (clean bundled polygons). **City-level boundaries
  are the heavy part** (many small polygons). v1 defines a city realm pragmatically
  (nearest populated place + local footprint); upgrade to true municipal
  boundaries later.

### Prototype-first step (when WS2 resumes)
- Build a **crest studio** artifact to tune the procedural-heraldry style /
  palette / complexity before baking the generator in.
