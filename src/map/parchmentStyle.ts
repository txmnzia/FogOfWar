import type { StyleSpecification } from "maplibre-gl";

// A hand-tuned OpenMapTiles style that turns MapTiler's vector world into aged
// parchment: warm paper land, sage water, faded ink linework and labels.
// The candlelight fog is drawn on top of this by FogLayer.
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

export function parchmentStyle(key: string): StyleSpecification {
  const style = {
    version: 8,
    name: "Parchment",
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
    sources: {
      openmaptiles: {
        type: "vector",
        url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${key}`,
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": paper } },
      {
        id: "landcover-wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["==", "class", "wood"],
        paint: { "fill-color": forest, "fill-opacity": 0.45 },
      },
      {
        id: "landcover-grass",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["in", "class", "grass", "meadow", "scrub"],
        paint: { "fill-color": grass, "fill-opacity": 0.4 },
      },
      {
        id: "landuse-park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": forest, "fill-opacity": 0.4 },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        paint: { "fill-color": water },
      },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        paint: { "line-color": waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 2] },
      },
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        paint: { "fill-color": building, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 0.5] },
      },
      {
        id: "road-casing",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", "class", "motorway", "trunk", "primary", "secondary"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": roadCasing,
          "line-opacity": 0.55,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 12, 4, 16, 10],
        },
      },
      {
        id: "road-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 12,
        filter: ["in", "class", "minor", "service", "tertiary", "residential"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": roadMinor,
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.4, 16, 3],
        },
      },
      {
        id: "road",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", "class", "motorway", "trunk", "primary", "secondary"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": road,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.3, 12, 2, 16, 6],
        },
      },
      {
        id: "boundary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["<=", "admin_level", 2],
        paint: {
          "line-color": boundary,
          "line-opacity": 0.6,
          "line-dasharray": [3, 2],
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 8, 1.6],
        },
      },
      {
        id: "boundary-state",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        minzoom: 4,
        filter: ["==", "admin_level", 4],
        paint: { "line-color": boundary, "line-opacity": 0.3, "line-dasharray": [2, 3], "line-width": 0.8 },
      },
      {
        id: "place-water",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Italic"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 14],
          "text-letter-spacing": 0.1,
        },
        paint: { "text-color": waterLine, "text-halo-color": halo, "text-halo-width": 1 },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", "class", "city", "town", "village", "country", "state"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": [
            "interpolate", ["linear"], ["zoom"],
            3, ["match", ["get", "class"], "country", 12, 9],
            10, ["match", ["get", "class"], "country", 20, ["match", ["get", "class"], "city", 17, 13]],
          ],
          "text-transform": ["match", ["get", "class"], "country", "uppercase", "none"],
          "text-letter-spacing": ["match", ["get", "class"], "country", 0.2, 0.02],
          "text-max-width": 7,
        },
        paint: { "text-color": ink, "text-halo-color": halo, "text-halo-width": 1.4 },
      },
    ],
  };
  return style as unknown as StyleSpecification;
}
