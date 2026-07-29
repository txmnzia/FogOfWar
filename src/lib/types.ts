export type CellSource = "timeline" | "gps" | "pin" | "manual";

/** A place the user explicitly marked. Radius is adjustable and removable. */
export interface Pin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  createdAt?: string;
}

/** An explored cell, resolved to its centre for rendering. */
export interface Cell {
  h3: string;
  lat: number;
  lng: number;
}
