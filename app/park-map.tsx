"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { bboxAreaKm2, MAX_BBOX_AREA_KM2, type Bbox } from "@/lib/bbox";

export type MapViewportState = {
  bbox: Bbox;
  areaKm2: number;
  unmappedCount: number;
  mappedInView: number;
  loading: boolean;
  error?: string;
};

type MapParkFeature = { geometry?: { coordinates?: [number, number] }; properties?: { pota_ref?: string; name?: string } };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function ParkMap({ onViewportState }: { onViewportState: (state: MapViewportState) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onViewportState);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const [mapState, setMapState] = useState<MapViewportState | null>(null);

  useEffect(() => { callbackRef.current = onViewportState; }, [onViewportState]);

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((leaflet) => {
      if (cancelled || !containerRef.current) return;
      const map = leaflet.map(containerRef.current, { zoomControl: true }).setView([40.35, -3.7], 10);
      leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
      const markers = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      markersRef.current = markers;

      const loadViewport = async (bbox: Bbox, areaKm2: number) => {
        const requestId = ++requestIdRef.current;
        if (areaKm2 > MAX_BBOX_AREA_KM2) {
          markers.clearLayers();
          const nextState = { bbox, areaKm2, unmappedCount: 0, mappedInView: 0, loading: false, error: `Zoom in until the visible map covers no more than ${MAX_BBOX_AREA_KM2.toLocaleString()} km².` };
          setMapState(nextState); callbackRef.current(nextState); return;
        }
        const loadingState = { bbox, areaKm2, unmappedCount: 0, mappedInView: 0, loading: true };
        setMapState((current) => ({ ...(current ?? loadingState), ...loadingState })); callbackRef.current(loadingState);
        try {
          const params = new URLSearchParams({ south: String(bbox.south), west: String(bbox.west), north: String(bbox.north), east: String(bbox.east) });
          const response = await fetch("/api/map/parks?" + params.toString(), { cache: "no-store" });
          const payload = await response.json() as { error?: string; features?: MapParkFeature[]; stats?: { mappedInView?: number } };
          if (cancelled || requestId !== requestIdRef.current) return;
          if (!response.ok) throw new Error(payload.error ?? "The unmapped park layer could not be loaded.");
          markers.clearLayers();
          for (const feature of payload.features ?? []) {
            const coordinates = feature.geometry?.coordinates;
            if (!coordinates || coordinates.length < 2) continue;
            const reference = String(feature.properties?.pota_ref ?? "");
            const name = String(feature.properties?.name ?? reference);
            leaflet.circleMarker([coordinates[1], coordinates[0]], { radius: 7, color: "#8b0000", weight: 2, fillColor: "#ef6b6b", fillOpacity: 0.75 })
              .bindPopup(`<strong>${escapeHtml(name)}</strong><br><span>POTA ID: <code>${escapeHtml(reference)}</code></span><br><span>This active park is not linked to an OSM object with a POTA tag.</span>`)
              .addTo(markers);
          }
          const nextState = { bbox, areaKm2, unmappedCount: payload.features?.length ?? 0, mappedInView: payload.stats?.mappedInView ?? 0, loading: false };
          setMapState(nextState); callbackRef.current(nextState);
        } catch (error) {
          if (cancelled || requestId !== requestIdRef.current) return;
          markers.clearLayers();
          const nextState = { bbox, areaKm2, unmappedCount: 0, mappedInView: 0, loading: false, error: error instanceof Error ? error.message : "The unmapped park layer could not be loaded." };
          setMapState(nextState); callbackRef.current(nextState);
        }
      };

      const reportViewport = () => {
        const bounds = map.getBounds();
        const bbox = { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
        const areaKm2 = bboxAreaKm2(bbox);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { void loadViewport(bbox, areaKm2); }, 450);
      };
      map.on("moveend", reportViewport);
      reportViewport();
    });
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      mapRef.current?.remove(); mapRef.current = null; markersRef.current = null;
    };
  }, []);

  return <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100"><div ref={containerRef} className="h-[560px] w-full" />{mapState?.loading && <div className="absolute left-3 top-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">Loading active unmapped parks…</div>}</div>;
}
