type CsvRow = Record<string, string>;
type ScopeOption = { value: string; label: string; regions: Array<{ value: string; label: string }> };

let cache: { fetchedAt: number; countries: ScopeOption[] } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const countryNames: Record<string, string> = { AT: "Austria", AU: "Australia", BE: "Belgium", CA: "Canada", CH: "Switzerland", DE: "Germany", DK: "Denmark", ES: "Spain", FI: "Finland", FR: "France", GB: "United Kingdom", IE: "Ireland", IT: "Italy", JP: "Japan", NL: "Netherlands", NO: "Norway", NZ: "New Zealand", PL: "Poland", PT: "Portugal", SE: "Sweden", US: "United States" };

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

function scopeFromRow(row: CsvRow) {
  const reference = row.reference ?? "";
  const location = row.locationdesc ?? row.location_desc ?? "";
  const country = reference.split("-")[0].toUpperCase() || location.split("-")[0].toUpperCase();
  const region = location.split("-").slice(1).join("-").trim().toUpperCase();
  return { country, region };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return Response.json({ countries: cache.countries, refreshedAt: new Date(cache.fetchedAt).toISOString(), cached: true });
  try {
    const response = await fetch("https://pota.app/all_parks_ext.csv", { headers: { "user-agent": "pota-osm-updater/0.1" } });
    if (!response.ok) throw new Error("POTA CSV returned " + response.status);
    const rows = parseCsv(await response.text()).filter((row) => row.active === "1" || row.active?.toLowerCase() === "true");
    const grouped = new Map<string, Set<string>>();
    rows.forEach((row) => {
      const { country, region } = scopeFromRow(row);
      if (!country || !region) return;
      if (!grouped.has(country)) grouped.set(country, new Set());
      grouped.get(country)?.add(region);
    });
    const countries = Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([value, regions]) => ({ value, label: countryNames[value] ?? value, regions: Array.from(regions).sort().map((region) => ({ value: region, label: region })) }));
    cache = { fetchedAt: now, countries };
    return Response.json({ countries, refreshedAt: new Date(now).toISOString(), cached: false });
  } catch (error) {
    return Response.json({ countries: cache?.countries ?? [], refreshedAt: cache ? new Date(cache.fetchedAt).toISOString() : null, cached: Boolean(cache), error: error instanceof Error ? error.message : "POTA catalog unavailable" }, { status: cache ? 200 : 502 });
  }
}
