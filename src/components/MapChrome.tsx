// Decorative, non-interactive overlay that turns the live web map into a drawn
// artifact: a faint paper grain and edge vignette across the whole map, a thin
// framed border, and a compass rose. Everything here is pointer-events: none, so
// map gestures and the zoom/attribution controls beneath it still work.

// A low-frequency fractal-noise tile, inlined as an SVG data URI, multiplied over
// the map at low opacity to read as paper fibre.
const GRAIN =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>
       <filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
       <feColorMatrix type='saturate' values='0'/></filter>
       <rect width='100%' height='100%' filter='url(#n)'/>
     </svg>`,
  );

// A larger, soft low-frequency blotch — the uneven light/dark of aged parchment.
const MOTTLE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420'>
       <filter id='m'><feTurbulence type='fractalNoise' baseFrequency='0.016' numOctaves='4' seed='7' stitchTiles='stitch'/>
       <feColorMatrix type='saturate' values='0'/></filter>
       <rect width='100%' height='100%' filter='url(#m)'/>
     </svg>`,
  );

export function MapChrome() {
  return (
    <div className="chrome" aria-hidden="true">
      <div className="chrome-paper" />
      <div className="chrome-mottle" style={{ backgroundImage: `url("${MOTTLE}")` }} />
      <div className="chrome-grain" style={{ backgroundImage: `url("${GRAIN}")` }} />
      <div className="chrome-vignette" />
      <div className="chrome-frame" />
      <svg className="chrome-compass" viewBox="0 0 100 100">
        {/* parchment backing so the rose reads over any terrain */}
        <circle cx="50" cy="50" r="47" fill="rgba(219,199,156,0.55)" stroke="#6f5230" strokeWidth="2" />
        <circle cx="50" cy="50" r="41" fill="none" stroke="#6f5230" strokeWidth="0.6" opacity="0.6" />
        {/* four-point star */}
        <polygon points="50,9 56,50 50,44 44,50" fill="#7a2b1c" />
        <polygon points="50,91 44,50 50,56 56,50" fill="#43301b" />
        <polygon points="9,50 50,44 44,50 50,56" fill="#43301b" />
        <polygon points="91,50 56,50 50,50 50,50 50,44" fill="#8a6a3c" />
        <polygon points="91,50 50,56 56,50 50,44" fill="#8a6a3c" />
        {/* diagonal rays */}
        <polygon points="24,24 50,47 47,50" fill="#a98a4a" opacity="0.75" />
        <polygon points="76,76 50,53 53,50" fill="#a98a4a" opacity="0.75" />
        <polygon points="76,24 53,50 50,47" fill="#a98a4a" opacity="0.75" />
        <polygon points="24,76 50,53 47,50" fill="#a98a4a" opacity="0.75" />
        <circle cx="50" cy="50" r="3.4" fill="#43301b" />
        <text x="50" y="21" textAnchor="middle" fontSize="11" fontFamily="var(--serif)" fill="#43301b" fontWeight="700">N</text>
      </svg>
    </div>
  );
}
