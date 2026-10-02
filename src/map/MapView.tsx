import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildParchmentStyle } from "./parchmentStyle";
import { DEFAULT_CENTER, DEFAULT_ZOOM } from "../lib/constants";

interface Props {
  onReady: (map: MlMap) => void;
  onClick?: (lngLat: { lng: number; lat: number }) => void;
}

export function MapView({ onReady, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  const onClickRef = useRef(onClick);
  onReadyRef.current = onReady;
  onClickRef.current = onClick;

  useEffect(() => {
    if (!ref.current) return;
    let map: MlMap | null = null;
    let cancelled = false;

    buildParchmentStyle().then((style) => {
      if (cancelled || !ref.current) return;
      map = new maplibregl.Map({
        container: ref.current,
        style,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
        maxZoom: 18,
        // Keep the map flat and north-up: a 2D exploration map has no use for
        // rotation or tilt, and it lets the fog overlay place cells with a fast
        // affine transform instead of a projection per vertex.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true, customAttribution: "© OpenFreeMap © OpenStreetMap" }),
        "bottom-left",
      );
      map.on("click", (e) => onClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));

      // Don't let the user zoom out past the point where the world stops filling
      // the viewport — beyond that it wraps and the fog shows a seam / empty
      // margins. Must satisfy BOTH dimensions: on a wide screen the binding
      // constraint is width, or the world is narrower than the viewport and a
      // vertical seam appears at the world edge.
      const applyMinZoom = () => {
        const el = map!.getContainer();
        const w = el.clientWidth, h = el.clientHeight;
        if (w > 0 && h > 0) {
          map!.setMinZoom(Math.max(0, Math.log2(w / 512), Math.log2(h / 512)) + 0.05);
        }
      };
      map.on("resize", applyMinZoom);
      map.on("load", () => {
        applyMinZoom();
        onReadyRef.current(map!);
      });
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return <div ref={ref} className="map-root" />;
}
