import { pointsToCellIndexes, cellFromIndex } from "../lib/h3";
import type { Cell } from "../lib/types";

// A small, obviously-fictional sample so a brand-new map isn't just black.
// Shown only until the user imports real data or drops their first pin, and
// never written to the database.
function buildSamplePoints(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];

  // A "home city" blob around central Paris.
  const home: [number, number] = [48.8566, 2.3522];
  for (let i = 0; i < 500; i++) {
    const r = Math.sqrt(Math.random()) * 0.06;
    const a = Math.random() * Math.PI * 2;
    pts.push([home[0] + Math.sin(a) * r, home[1] + Math.cos(a) * r * 1.4]);
  }

  // A journey south-east toward Dijon/Lyon.
  const wps: Array<[number, number]> = [
    [48.85, 2.35],
    [48.6, 2.9],
    [48.3, 3.6],
    [47.9, 4.2],
    [47.32, 5.04], // Dijon
    [46.6, 4.9],
    [45.76, 4.83], // Lyon
  ];
  for (let i = 0; i < wps.length - 1; i++) {
    const [a, b] = [wps[i], wps[i + 1]];
    // Dense enough (~300 m spacing) that consecutive cells touch and the route
    // reads as one continuous lit corridor rather than a dotted line.
    const steps = 400;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      pts.push([
        a[0] + (b[0] - a[0]) * f + (Math.random() - 0.5) * 0.01,
        a[1] + (b[1] - a[1]) * f + (Math.random() - 0.5) * 0.01,
      ]);
    }
  }

  // A far-flung weekend — a small cluster in Lisbon.
  const far: [number, number] = [38.7223, -9.1393];
  for (let i = 0; i < 120; i++) {
    const r = Math.sqrt(Math.random()) * 0.04;
    const a = Math.random() * Math.PI * 2;
    pts.push([far[0] + Math.sin(a) * r, far[1] + Math.cos(a) * r]);
  }

  return pts;
}

let cache: Cell[] | null = null;

export function sampleCells(): Cell[] {
  if (!cache) {
    const indexes = pointsToCellIndexes(buildSamplePoints());
    cache = Array.from(indexes, cellFromIndex);
  }
  return cache;
}
