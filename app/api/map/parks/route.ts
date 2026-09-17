import { bboxAreaKm2, MAX_BBOX_AREA_KM2, type Bbox, validBbox } from "@/lib/bbox";

type CsvRow = Record<string, string>;
type OverpassElement = { type: "node" | "way" | "relation"; id: number; tags?: Record<string, string> };

let catalogueCache: { fetchedAt: number; rows: CsvRow[] } | null = null;
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; continue; }
      if (character === '"') { quoted = !quoted; continue; }
      if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; } else cell += character;
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((value, index) => [headers[index], value])));
}

function pick(row: CsvRow, names: string[]) {
  const key = names.find((name) => row[name]);
  return key ? row[key] : "";
}

function active(row: CsvRow) {
  const value = pick(row, ["active", "status", "park_status"]).toLowerCase();
  return value === "1" || value === "true" || value === "active";
}

function references(value: string) {
  return String(value || "").split(/[;,]/).map((reference) => reference.trim().toUpperCase()).filter(Boolean);
}

async function getCatalogue() {
  const now = Date.now();
  if (catalogueCache && now - catalogueCache.fetchedAt < CATALOGUE_TTL_MS) return catalogueCache.rows;
  const response = await fetch("https://pota.app/all_parks_ext.csv", { headers: { "user-agent": "pota-osm-updater/0.1" }, cache: "no-store" });
  if (!response.ok) throw new Error("POTA CSV returned " + response.status);
  const rows = parseCsv(await response.text());
  catalogueCache = { fetchedAt: now, rows };
  return rows;
}

async function getMappedReferences(bbox: Bbox) {
  const query = "[out:json][timeout:25];nwr[\"communication:amateur_radio:pota\"](" + bbox.south + "," + bbox.west + "," + bbox.north + "," + bbox.east + ");out center tags;";
  const response = await fetch("https://overpass.ea7klk.es/api/interpreter", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "pota-osm-updater/0.1" },
    body: "data=" + encodeURIComponent(query),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Overpass returned " + response.status);
  const payload = await response.json() as { elements?: OverpassElement[] };
  const mapped = new Set<string>();
  for (const element of payload.elements ?? []) references(element.tags?.["communication:amateur_radio:pota"] ?? "").forEach((reference) => mapped.add(reference));
  return mapped;
}

function queryBbox(searchParams: URLSearchParams): Bbox {
  return {
    south: Number(searchParams.get("south")), west: Number(searchParams.get("west")),
    north: Number(searchParams.get("north")), east: Number(searchParams.get("east")),
  };
}

export async function GET(request: Request) {
  const bbox = queryBbox(new URL(request.url).searchParams);
  if (!validBbox(bbox)) return Response.json({ error: "The map bounding box is invalid." }, { status: 400 });
  const area = bboxAreaKm2(bbox);
  if (area > MAX_BBOX_AREA_KM2) return Response.json({ error: "Zoom in until the visible map covers no more than 20,000 km².", areaKm2: area, maxAreaKm2: MAX_BBOX_AREA_KM2 }, { status: 413 });
  try {
    const [rows, mappedReferences] = await Promise.all([getCatalogue(), getMappedReferences(bbox)]);
    const features = rows.filter(active).map((row) => {
      const reference = pick(row, ["reference", "park_id", "park_code", "code"]).trim().toUpperCase();
      const latitude = Number(pick(row, ["latitude", "lat"]));
      const longitude = Number(pick(row, ["longitude", "lon", "lng"]));
      const name = pick(row, ["name", "park_name", "park"]) || reference;
      return { reference, latitude, longitude, name };
    }).filter((park) => park.reference && Number.isFinite(park.latitude) && Number.isFinite(park.longitude)
      && park.latitude >= bbox.south && park.latitude <= bbox.north && park.longitude >= bbox.west && park.longitude <= bbox.east
      && !mappedReferences.has(park.reference));
    return Response.json({ type: "FeatureCollection", features: features.map((park) => ({ type: "Feature", geometry: { type: "Point", coordinates: [park.longitude, park.latitude] }, properties: { pota_ref: park.reference, name: park.name } })), stats: { active: features.length, mappedInView: mappedReferences.size }, bbox, areaKm2: area }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load unmapped POTA parks." }, { status: 502 });
  }
}
