// Procedural realm heraldry. A crest is generated deterministically from the
// realm's name, so a given realm always gets the same shield. Baked to the style
// chosen in the Crest Studio: Aged palette, a per-realm mix of shield shapes,
// high complexity, charges on.

const PALETTE = {
  colors: ["#3f6b63", "#9a4b34", "#4a5568", "#6b7040", "#6d3550", "#3c4a63", "#7a5a2e"],
  metals: ["#e7d9b6", "#c9ad6a"],
};

const SHAPES = [
  "M18,15 H82 V54 Q82,92 50,112 Q18,92 18,54 Z", // heater
  "M18,14 H82 V90 Q82,107 50,116 Q18,107 18,90 Z", // french
  "M50,10 Q82,10 82,44 V72 Q82,108 50,114 Q18,108 18,72 V44 Q18,10 50,10 Z", // rounded
];

const OUTLINE = "#2a1e12";

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}

function starPts(cx: number, cy: number, spikes: number, outer: number, inner: number): string {
  const pts: string[] = [];
  let rot = -Math.PI / 2;
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    pts.push(`${(cx + Math.cos(rot) * rad).toFixed(1)},${(cy + Math.sin(rot) * rad).toFixed(1)}`);
    rot += step;
  }
  return pts.join(" ");
}

const CHARGES: Array<(f: string) => string> = [
  (f) => `<polygon points="${starPts(50, 60, 5, 22, 9)}" fill="${f}" stroke="${OUTLINE}" stroke-width="1.2"/>`,
  (f) =>
    `<g fill="${f}" stroke="${OUTLINE}" stroke-width="1.2"><rect x="37" y="54" width="26" height="30"/><rect x="35" y="49" width="7" height="8"/><rect x="46.5" y="49" width="7" height="8"/><rect x="58" y="49" width="7" height="8"/></g><rect x="45" y="68" width="10" height="16" fill="${OUTLINE}"/>`,
  (f) =>
    `<rect x="47" y="70" width="6" height="15" fill="#5a3d24" stroke="${OUTLINE}" stroke-width="0.8"/><polygon points="50,42 67,73 33,73" fill="${f}" stroke="${OUTLINE}" stroke-width="1.1"/><polygon points="50,52 62,74 38,74" fill="${f}" stroke="${OUTLINE}" stroke-width="1.1"/>`,
  (f) =>
    `<polygon points="28,84 44,54 54,70 60,60 72,84" fill="${f}" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>`,
  (f) => {
    let rays = "";
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      rays += `<line x1="${(50 + Math.cos(a) * 15).toFixed(1)}" y1="${(60 + Math.sin(a) * 15).toFixed(1)}" x2="${(50 + Math.cos(a) * 23).toFixed(1)}" y2="${(60 + Math.sin(a) * 23).toFixed(1)}" stroke="${f}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
    return `${rays}<circle cx="50" cy="60" r="13" fill="${f}" stroke="${OUTLINE}" stroke-width="1.2"/>`;
  },
  (f) => `<path d="M60,44 A20,20 0 1 0 60,80 A15,15 0 1 1 60,44 Z" fill="${f}" stroke="${OUTLINE}" stroke-width="1.2"/>`,
  (f) => `<circle cx="50" cy="61" r="19" fill="${f}" stroke="${OUTLINE}" stroke-width="1.3"/>`,
  (f) => `<polygon points="50,40 70,61 50,82 30,61" fill="${f}" stroke="${OUTLINE}" stroke-width="1.3"/>`,
];

function fieldRects(div: number, c1: string, c2: string): string {
  switch (div) {
    case 1:
      return `<rect x="0" y="0" width="50" height="120" fill="${c1}"/><rect x="50" y="0" width="50" height="120" fill="${c2}"/>`;
    case 2:
      return `<rect x="0" y="0" width="100" height="60" fill="${c1}"/><rect x="0" y="60" width="100" height="60" fill="${c2}"/>`;
    case 3:
      return `<rect width="100" height="120" fill="${c1}"/><rect x="50" y="0" width="50" height="60" fill="${c2}"/><rect x="0" y="60" width="50" height="60" fill="${c2}"/>`;
    case 4:
      return `<rect width="100" height="120" fill="${c1}"/><polygon points="0,0 0,120 100,120" fill="${c2}"/>`;
    case 5:
      return `<rect width="100" height="120" fill="${c1}"/><rect x="0" y="0" width="100" height="34" fill="${c2}"/>`;
    default:
      return `<rect width="100" height="120" fill="${c1}"/>`;
  }
}

/** A full <svg> string for the realm's crest. Deterministic from `name`. */
export function crestSvg(name: string): string {
  const r = mulberry32(hashStr(name));
  const d = pick(SHAPES, r);
  // High complexity: full division set + likely border.
  const div = pick([0, 1, 2, 3, 4, 5], r);
  const c1 = pick(PALETTE.colors, r);
  let c2 = pick(PALETTE.colors, r);
  if (c2 === c1) c2 = PALETTE.colors[(PALETTE.colors.indexOf(c1) + 2) % PALETTE.colors.length];
  const metal = pick(PALETTE.metals, r);
  const charge = CHARGES[Math.floor(r() * CHARGES.length)];
  const border = r() > 0.45;
  const uid = "c" + hashStr(name + d).toString(36);

  let svg = '<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">';
  svg += `<defs><clipPath id="${uid}"><path d="${d}"/></clipPath></defs>`;
  svg += `<g clip-path="url(#${uid})">`;
  svg += fieldRects(div, c1, c2);
  if (border) svg += `<path d="${d}" fill="none" stroke="${metal}" stroke-width="8"/>`;
  svg += "</g>";
  svg += charge(metal);
  svg += `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="3"/>`;
  svg += "</svg>";
  return svg;
}
