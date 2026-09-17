type CsvRow = Record<string, string>;
type OverpassElement = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
type PhotonResult = { osm_type: "node" | "way" | "relation"; osm_id: number; lat: string; lon: string; name?: string; display_name?: string; type?: string; category?: string; extratags?: Record<string, string> };
type NominatimResult = { osm_type: "node" | "way" | "relation"; osm_id: number; lat: string; lon: string; display_name?: string; name?: string; type?: string; category?: string; extratags?: Record<string, string> };

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const parseLine = (line: string) => {
    const cells: string[] = []; let cell = ""; let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === "," && !quoted) { cells.push(cell.trim()); cell = ""; } else cell += char;
    }
    cells.push(cell.trim()); return cells;
  };
  const headers = parseLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((value, index) => [headers[index], value])));
}

function pick(row: CsvRow, names: string[]) {
  const key = names.find((name) => row[name]); return key ? row[key] : "";
}

function normalize(value: string) {
  const fillerWords = new Set(["a", "an", "and", "area", "areas", "bioreserve", "biosphere", "conservation", "complex", "da", "das", "de", "del", "do", "dos", "el", "en", "forest", "protected", "in", "landscape", "monument", "municipal", "nacional", "national", "nationalpark", "natural", "nature", "of", "parc", "parque", "park", "parks", "preserve", "protected", "provincial", "recreation", "recreational", "refuge", "regional", "region", "reserve", "reserva", "site", "state", "the", "wetland", "wildlife", "y"]);
  const words = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((word) => !fillerWords.has(word));
  return (meaningful.length ? meaningful : words).join(" ");
}

function distanceKm(leftLat: number, leftLon: number, rightLat: number, rightLon: number) {
  const radians = Math.PI / 180;
  const x = (rightLon - leftLon) * radians * Math.cos(((leftLat + rightLat) / 2) * radians);
  const y = (rightLat - leftLat) * radians;
  return Math.sqrt(x * x + y * y) * 6371;
}

function levenshtein(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function matchScore(name: string, osmName: string, distance: number) {
  const left = normalize(name);
  const right = normalize(osmName);
  if (!left || !right) return 0;
  if (left === right) return 100;
  const leftWords = new Set(left.split(" "));
  const rightWords = new Set(right.split(" "));
  const overlap = Array.from(leftWords).filter((word) => word.length > 2 && rightWords.has(word)).length;
  const prefixOverlap = Array.from(leftWords).filter((word) => word.length > 3 && Array.from(rightWords).some((candidate) => candidate.startsWith(word) || word.startsWith(candidate))).length;
  const wordScore = Math.round(((overlap + prefixOverlap * 0.5) / Math.max(leftWords.size, rightWords.size)) * 82);
  const partialScore = left.includes(right) || right.includes(left) || Array.from(leftWords).some((word) => word.length > 4 && right.includes(word)) ? 34 : 0;
  const fuzzyScore = Math.round((1 - levenshtein(left, right) / Math.max(left.length, right.length)) * 70);
  const distancePenalty = Math.min(25, Math.round(distance / 4));
  return Math.max(0, Math.min(99, Math.max(wordScore, partialScore, fuzzyScore) + 14 - distancePenalty));
}

function typePriority(type: "node" | "way" | "relation") {
  return type === "relation" ? 2 : type === "way" ? 1 : 0;
}

function referenceCountry(reference: string) {
  return reference.split("-")[0]?.trim().toUpperCase() || "";
}

async function searchPhoton(name: string, country: string, lat: number, lon: number, acquire?: () => Promise<void>) {
  const query = [name, country].filter(Boolean).join(", ");
  const coordinateBias = lat && lon ? "&lat=" + encodeURIComponent(String(lat)) + "&lon=" + encodeURIComponent(String(lon)) : "";
  const url = "https://photon.komoot.io/api/?limit=8&lang=en" + coordinateBias + "&q=" + encodeURIComponent(query);
  try {
    await acquire?.();
    const response = await fetchWithTimeout(url, { headers: { accept: "application/json" } }, 5000);
    if (!response.ok) return null;
    const payload = await response.json() as { features?: Array<{ geometry?: { coordinates?: number[] }; properties?: Record<string, string | number> }> };
    return (payload.features ?? []).map((feature) => {
      const properties = feature.properties ?? {};
      const osmType = properties.osm_type === "W" ? "way" : properties.osm_type === "R" ? "relation" : "node";
      const coordinates = feature.geometry?.coordinates ?? [0, 0];
      const nameValue = String(properties.name ?? "");
      const display = [nameValue, properties.city, properties.state, properties.country].filter(Boolean).join(", ");
      return { osm_type: osmType as "node" | "way" | "relation", osm_id: Number(properties.osm_id ?? 0), lat: String(coordinates[1] ?? 0), lon: String(coordinates[0] ?? 0), name: nameValue, display_name: display, type: String(properties.osm_value ?? properties.type ?? ""), category: String(properties.osm_key ?? ""), extratags: {} } satisfies PhotonResult;
    }).filter((result) => result.osm_id > 0);
  } catch {
    return null;
  }
}

async function searchNominatim(name: string, country: string, lat: number, lon: number, acquire?: () => Promise<void>) {
  const query = [name, country].filter(Boolean).join(", ");
  const viewbox = lat && lon ? "&viewbox=" + encodeURIComponent(String(lon - 1)) + "," + encodeURIComponent(String(lat + 1)) + "," + encodeURIComponent(String(lon + 1)) + "," + encodeURIComponent(String(lat - 1)) : "";
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&addressdetails=1&namedetails=1&extratags=1&countrycodes=" + encodeURIComponent(country.toLowerCase()) + viewbox + "&q=" + encodeURIComponent(query);
  try {
    await acquire?.();
    const response = await fetchWithTimeout(url, { headers: { accept: "application/json", "accept-language": "en" } }, 8000);
    if (!response.ok) return [];
    const payload = await response.json() as NominatimResult[];
    return payload.map((result) => ({
      osm_type: result.osm_type,
      osm_id: Number(result.osm_id),
      lat: String(result.lat),
      lon: String(result.lon),
      name: result.name,
      display_name: result.display_name,
      type: result.type,
      category: result.category,
      extratags: result.extratags ?? {},
    })).filter((result) => result.osm_id > 0);
  } catch {
    return [];
  }
}

async function searchOsm(name: string, country: string, lat: number, lon: number, gates: { photon: () => Promise<void>; nominatim: () => Promise<void>; photonUnavailable: boolean }) {
  if (!gates.photonUnavailable) {
    const photonResults = await searchPhoton(name, country, lat, lon, gates.photon);
    if (photonResults?.length) return photonResults;
    if (photonResults === null) gates.photonUnavailable = true;
  }
  return searchNominatim(name, country, lat, lon, gates.nominatim);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeout = 9000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...init, signal: controller.signal, headers: { "user-agent": "pota-osm-updater/0.1", ...(init.headers ?? {}) } }); }
  finally { clearTimeout(timer); }
}

function createRateGate(intervalMs: number) {
  let nextAllowedAt = 0;
  return async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextAllowedAt - now);
    nextAllowedAt = Math.max(now, nextAllowedAt) + intervalMs;
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function readOsmPotaStatus(result: PhotonResult, acquire: () => Promise<void>) {
  try {
    if (!["node", "way", "relation"].includes(result.osm_type) || !Number.isInteger(result.osm_id) || result.osm_id <= 0) return null;
    await acquire();
    const response = await fetchWithTimeout("https://api.openstreetmap.org/api/0.6/" + result.osm_type + "/" + result.osm_id + ".json", { headers: { accept: "application/json" } }, 8000);
    if (!response.ok) return null;
    const payload = await response.json() as { elements?: Array<{ tags?: Record<string, string> }> };
    const element = payload.elements?.[0];
    if (!element) return null;
    return Object.prototype.hasOwnProperty.call(element.tags ?? {}, "communication:amateur_radio:pota");
  } catch {
    return null;
  }
}

async function readOverpassElements(response: Response) {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { elements?: OverpassElement[] }).elements ?? [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const { bbox } = await request.json() as { bbox?: Bbox };
  if (!bbox || !validBbox(bbox)) return Response.json({ error: "The map bounding box is invalid." }, { status: 400 });
  if (bboxAreaKm2(bbox) > MAX_BBOX_AREA_KM2) return Response.json({ error: "Zoom in until the visible map covers no more than 20,000 km²." }, { status: 413 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      void (async () => {
        try {
          emit({ type: "progress", phase: "fetching-csv", message: "Downloading the active POTA park catalogue…", completed: 0, total: 0, candidateCount: 0, existing: 0 });
    const csvResponse = await fetchWithTimeout("https://pota.app/all_parks_ext.csv", {});
    if (!csvResponse.ok) throw new Error("POTA CSV returned " + csvResponse.status);
    const rows = parseCsv(await csvResponse.text());
    const scoped = rows.filter((row) => {
      const reference = pick(row, ["reference", "park_id", "park_code", "code"]);
      const active = pick(row, ["active", "status", "park_status"]).toLowerCase();
      const lat = Number(pick(row, ["latitude", "lat"]));
      const lon = Number(pick(row, ["longitude", "lon", "lng"]));
      return Boolean(reference) && (active === "1" || active === "true" || active === "active") && Number.isFinite(lat) && Number.isFinite(lon) && lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east;
    });
    emit({ type: "progress", phase: "loading-overpass", message: "Checking Overpass for parks already tagged in OSM…", completed: 0, total: scoped.length, candidateCount: 0, existing: 0 });
    const query = "[out:json][timeout:25];nwr[\"communication:amateur_radio:pota\"](" + bbox.south + "," + bbox.west + "," + bbox.north + "," + bbox.east + ");out center tags;";
    let elements: OverpassElement[] = [];
    try {
      const overpassResponse = await fetchWithTimeout("https://overpass.ea7klk.es/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" } }, 15000);
      if (overpassResponse.ok) elements = await readOverpassElements(overpassResponse);
    } catch {
      elements = [];
    }
    const tagged = elements.filter((element) => Object.prototype.hasOwnProperty.call(element.tags ?? {}, "communication:amateur_radio:pota"));
    const existingKeys = new Set(tagged.map((element) => element.type + "/" + element.id));
    const existingNames = new Set(tagged.map((element) => normalize(element.tags?.name ?? "")));
    const existingRefs = new Set(tagged.flatMap((element) => String(element.tags?.["communication:amateur_radio:pota"] ?? "").split(/[;,]/).map((reference) => reference.trim().toUpperCase()).filter(Boolean)));
    const gates = { photon: createRateGate(300), nominatim: createRateGate(1000), osm: createRateGate(500), photonUnavailable: false };
    const verificationCache = new Map<string, Promise<boolean | null>>();
    const verifyResult = (result: PhotonResult) => {
      const key = result.osm_type + "/" + result.osm_id;
      const cached = verificationCache.get(key);
      if (cached) return cached;
      const verification = readOsmPotaStatus(result, gates.osm);
      verificationCache.set(key, verification);
      return verification;
    };
    const parkRows = scoped.filter((row) => !existingRefs.has(pick(row, ["reference", "park_id", "park_code", "code"]).trim().toUpperCase()));
    emit({ type: "progress", phase: "searching", message: "Searching public OSM indexes for parks in the displayed map…", completed: 0, total: parkRows.length, candidateCount: 0, existing: existingRefs.size });
    let completed = 0;
    let candidateCount = 0;
    const searched = await mapWithConcurrency(parkRows, 2, async (row, index) => {
      const name = pick(row, ["name", "park_name", "park"]) || "Unnamed POTA park";
      const code = pick(row, ["reference", "park_id", "park_code", "code"]) || "POTA-" + (index + 1);
      const lat = Number(pick(row, ["latitude", "lat"])) || 0;
      const lon = Number(pick(row, ["longitude", "lon", "lng"])) || 0;
      const countryCode = referenceCountry(code);
      const results = await searchOsm(name, countryCode, lat, lon, gates);
      const matches = results.map((result) => {
        const osmName = result.name || result.display_name?.split(",")[0] || "";
        const resultLat = Number(result.lat);
        const resultLon = Number(result.lon);
        const distance = lat && lon && resultLat && resultLon ? distanceKm(lat, lon, resultLat, resultLon) : 0;
        return { result, osmName, score: matchScore(name, osmName, distance) };
      }).filter((match) => !existingKeys.has(match.result.osm_type + "/" + match.result.osm_id) && !existingRefs.has(code) && !existingNames.has(normalize(name)) && match.score >= 25).sort((left, right) => typePriority(right.result.osm_type) - typePriority(left.result.osm_type) || right.score - left.score).slice(0, 8);
      const verifiedMatches = (await mapWithConcurrency(matches, 2, async (match) => ({ match, hasPotaTag: await verifyResult(match.result) }))).filter(({ hasPotaTag }) => hasPotaTag === false).map(({ match }) => match);
      const mappedMatches = verifiedMatches.map((match) => {
        const result = match.result;
        const tags = { name: match.osmName, ...(result.extratags ?? {}) };
        return {
          id: code + "::" + result.osm_type + "::" + result.osm_id, name, code, country: countryCode, region: pick(row, ["locationdesc", "location_desc", "region", "state", "province", "subdivision"]), lat, lon,
          confidence: Math.min(99, Math.max(35, match.score)), matchType: match.score >= 90 ? "exact" : match.score >= 65 ? "near" : "review",
          osmType: result.osm_type, osmId: String(result.osm_id), osmName: match.osmName, tags,
        };
      });
      completed += 1;
      candidateCount += mappedMatches.length;
      emit({ type: "progress", phase: "searching", message: "Processed " + completed + " of " + parkRows.length + " parks in the displayed map…", completed, total: parkRows.length, candidateCount, existing: existingRefs.size });
      return mappedMatches;
    });
    const candidates = searched.flat();
    candidates.sort((left, right) => typePriority(right.osmType as "node" | "way" | "relation") - typePriority(left.osmType as "node" | "way" | "relation") || Number(right.confidence) - Number(left.confidence));
    emit({ type: "complete", phase: "complete", message: "Reconciliation complete.", completed: parkRows.length, total: parkRows.length, candidateCount: candidates.length, existing: existingRefs.size, live: true, candidates, stats: { total: parkRows.length, existing: existingRefs.size, suggestions: candidates.length } });
    controller.close();
        } catch (error) {
          emit({ type: "error", phase: "error", message: "Live reconciliation unavailable.", error: error instanceof Error ? error.message : "Live reconciliation unavailable" });
          controller.close();
        }
      })();
    },
  });
  return new Response(stream, { headers: { "cache-control": "no-cache, no-transform", "content-type": "application/x-ndjson; charset=utf-8", connection: "keep-alive" } });
}
import { bboxAreaKm2, MAX_BBOX_AREA_KM2, type Bbox, validBbox } from "@/lib/bbox";
