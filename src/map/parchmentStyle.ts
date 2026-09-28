import type { StyleSpecification } from "maplibre-gl";

// A hand-tuned parchment style over OpenFreeMap's free, keyless OpenStreetMap
// vector tiles (https://openfreemap.org — no API key, no signup).
//
// Rather than hard-code OpenFreeMap's tile/font URLs (which can change), we
// fetch one of their hosted styles at runtime and reuse its `sources`, `glyphs`
// and `sprite` verbatim — then drop in our own parchment layers. This makes the
// map robust to any URL/schema tweaks on their side.

const OFM_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const paper = "#d8c6a0";
const water = "#a9bdb4";
const waterLine = "#8fa79c";
const forest = "#c4cc9c";
const grass = "#cfd2a4";
const roadCasing = "#9c7b46";
const road = "#c7a870";
const roadMinor = "#cdb68a";
const boundary = "#7a5c38";
const building = "#ccb78f";
const ink = "#4a3720";
const halo = "rgba(233,224,205,0.85)";

/** Parchment layers bound to the given vector source (OpenMapTiles schema). */
function parchmentLayers(src: string): unknown[] {
  const v = (extra: object) => ({ source: src, "source-layer": "", ...extra });
  return [
    { id: "bg", type: "background", paint: { "background-color": paper } },
    v({ id: "landcover-wood", type: "fill", "source-layer": "landcover", filter: ["==", "class", "wood"], paint: { "fill-color": forest, "fill-opacity": 0.45 } }),
    v({ id: "landcover-grass", type: "fill", "source-layer": "landcover", filter: ["in", "class", "grass", "meadow", "scrub"], paint: { "fill-color": grass, "fill-opacity": 0.4 } }),
    v({ id: "landuse-park", type: "fill", "source-layer": "park", paint: { "fill-color": forest, "fill-opacity": 0.4 } }),
    v({ id: "water", type: "fill", "source-layer": "water", paint: { "fill-color": water } }),
    v({ id: "waterway", type: "line", "source-layer": "waterway", paint: { "line-color": waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 2] } }),
    v({ id: "building", type: "fill", "source-layer": "building", minzoom: 13, paint: { "fill-color": building, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 0.5] } }),
    v({ id: "road-casing", type: "line", "source-layer": "transportation", filter: ["in", "class", "motorway", "trunk", "primary", "secondary"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": roadCasing, "line-opacity": 0.55, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 4, 16, 10] } }),
    v({ id: "road-minor", type: "line", "source-layer": "transportation", minzoom: 12, filter: ["in", "class", "minor", "service", "tertiary", "residential"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": roadMinor, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 16, 3] } }),
    v({ id: "road", type: "line", "source-layer": "transportation", filter: ["in", "class", "motorway", "trunk", "primary", "secondary"], layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": road, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.3, 12, 2, 16, 6] } }),
    v({ id: "boundary", type: "line", "source-layer": "boundary", filter: ["<=", "admin_level", 2], paint: { "line-color": boundary, "line-opacity": 0.6, "line-dasharray": [3, 2], "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.6] } }),
    v({ id: "boundary-state", type: "line", "source-layer": "boundary", minzoom: 4, filter: ["==", "admin_level", 4], paint: { "line-color": boundary, "line-opacity": 0.3, "line-dasharray": [2, 3], "line-width": 0.8 } }),
    v({ id: "place-water", type: "symbol", "source-layer": "water_name", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 14], "text-letter-spacing": 0.1 }, paint: { "text-color": waterLine, "text-halo-color": halo, "text-halo-width": 1 } }),
    v({
      id: "place-labels", type: "symbol", "source-layer": "place",
      filter: ["in", "class", "city", "town", "village", "country", "state"],
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, ["match", ["get", "class"], "country", 12, 9], 10, ["match", ["get", "class"], "country", 20, ["match", ["get", "class"], "city", 17, 13]]],
        "text-transform": ["match", ["get", "class"], "country", "uppercase", "none"],
        "text-letter-spacing": ["match", ["get", "class"], "country", 0.2, 0.02],
        "text-max-width": 7,
      },
      paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.4 },
    }),
  ];
}

/** Minimal fallback if the hosted style can't be fetched. */
function fallbackStyle(): StyleSpecification {
  const style = {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
    layers: parchmentLayers("openmaptiles"),
  };
  return style as unknown as StyleSpecification;
}

export async function buildParchmentStyle(): Promise<StyleSpecification> {
  try {
    const base = await fetch(OFM_STYLE).then((r) => r.json());
    const srcName =
      Object.keys(base.sources ?? {}).find((k) => base.sources[k]?.type === "vector") ?? "openmaptiles";
    const style = {
      version: 8,
      glyphs: base.glyphs,
      sprite: base.sprite,
      sources: base.sources,
      layers: parchmentLayers(srcName),
    };
    return style as unknown as StyleSpecification;
  } catch {
    return fallbackStyle();
  }
}
