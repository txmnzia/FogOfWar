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
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true, customAttribution: "© OpenFreeMap © OpenStreetMap" }),
        "bottom-left",
      );
      map.on("click", (e) => onClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
      map.on("load", () => onReadyRef.current(map!));
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return <div ref={ref} className="map-root" />;
}
