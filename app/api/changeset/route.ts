type Candidate = { code?: unknown; osmType?: unknown; osmId?: unknown };
type OsmTag = Record<string, string>;
type OsmMember = { type: string; ref: number; role: string };
type OsmElement = { type: "node" | "way" | "relation"; id: number; version: number; lat?: number; lon?: number; nodes?: number[]; members?: OsmMember[]; tags?: OsmTag };

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

async function fetchElement(candidate: Candidate) {
  const type = String(candidate.osmType ?? "");
  const id = String(candidate.osmId ?? "");
  if (!["node", "way", "relation"].includes(type) || !/^\d+$/.test(id)) throw new Error("A proposed match has no valid OSM object ID.");
  const response = await fetch("https://api.openstreetmap.org/api/0.6/" + type + "/" + id + ".json", { headers: { accept: "application/json", "user-agent": "pota-osm-updater/0.1" } });
  if (!response.ok) throw new Error("Could not read OSM " + type + "/" + id + ".");
  const payload = await response.json() as { elements?: OsmElement[] };
  const element = payload.elements?.[0];
  if (!element || element.type !== type || element.id !== Number(id) || !element.version) throw new Error("OSM returned no complete object for " + type + "/" + id + ".");
  return element;
}

function modifyXml(element: OsmElement, candidate: Candidate) {
  const attributes = " id=\"" + element.id + "\" version=\"" + element.version + "\"";
  const tags = { ...(element.tags ?? {}), "communication:amateur_radio:pota": String(candidate.code ?? "") };
  const tagXml = Object.entries(tags).map(([key, value]) => "<tag k=\"" + escapeXml(key) + "\" v=\"" + escapeXml(value) + "\"/>").join("");
  if (element.type === "node") return "<node" + attributes + " lat=\"" + Number(element.lat ?? 0).toFixed(7) + "\" lon=\"" + Number(element.lon ?? 0).toFixed(7) + "\">" + tagXml + "</node>";
  if (element.type === "way") return "<way" + attributes + ">" + (element.nodes ?? []).map((ref) => "<nd ref=\"" + ref + "\"/>").join("") + tagXml + "</way>";
  return "<relation" + attributes + ">" + (element.members ?? []).map((member) => "<member type=\"" + escapeXml(member.type) + "\" ref=\"" + member.ref + "\" role=\"" + escapeXml(member.role ?? "") + "\"/>").join("") + tagXml + "</relation>";
}

export async function POST(request: Request) {
  const payload = await request.json() as { comment?: unknown; candidates?: unknown[] };
  const comment = String(payload.comment || "Add missing POTA park references");
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as Candidate[];
  try {
    const elements = await Promise.all(candidates.map((candidate) => fetchElement(candidate)));
    const changes = elements.map((element, index) => modifyXml(element, candidates[index])).join("\n  ");
    const osc = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<osmChange version=\"0.6\" generator=\"POTA OSM Updater\">\n  <modify>\n  " + changes + "\n  </modify>\n</osmChange>\n";
    return Response.json({ osc, comment, count: candidates.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not prepare the OSM changeset." }, { status: 502 });
  }
}
