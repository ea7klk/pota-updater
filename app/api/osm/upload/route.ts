function cookieValue(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="))?.slice(name.length + 1) ?? "";
}

type Candidate = { code?: unknown; osmType?: unknown; osmId?: unknown };
type OsmElement = { type: "node" | "way" | "relation"; id: number; version: number; lat?: number; lon?: number; nodes?: number[]; members?: Array<{ type: string; ref: number; role?: string }>; tags?: Record<string, string> };

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

function modifyXml(element: OsmElement, candidate: Candidate, changesetId: string) {
  const attributes = " id=\"" + element.id + "\" version=\"" + element.version + "\" changeset=\"" + escapeXml(changesetId) + "\"";
  const tags = { ...(element.tags ?? {}), "communication:amateur_radio:pota": String(candidate.code ?? "") };
  const tagXml = Object.entries(tags).map(([key, value]) => "<tag k=\"" + escapeXml(key) + "\" v=\"" + escapeXml(value) + "\"/>").join("");
  if (element.type === "node") return "<node" + attributes + " lat=\"" + Number(element.lat ?? 0).toFixed(7) + "\" lon=\"" + Number(element.lon ?? 0).toFixed(7) + "\">" + tagXml + "</node>";
  if (element.type === "way") return "<way" + attributes + ">" + (element.nodes ?? []).map((ref) => "<nd ref=\"" + ref + "\"/>").join("") + tagXml + "</way>";
  return "<relation" + attributes + ">" + (element.members ?? []).map((member) => "<member type=\"" + escapeXml(member.type) + "\" ref=\"" + member.ref + "\" role=\"" + escapeXml(member.role ?? "") + "\"/>").join("") + tagXml + "</relation>";
}

export async function POST(request: Request) {
  const token = cookieValue(request, "osm_access_token");
  if (!token) return Response.json({ error: "Connect an OSM account before uploading." }, { status: 401 });
  const payload = await request.json() as { comment?: unknown; candidates?: unknown[] };
  const comment = String(payload.comment || "Add missing POTA park references");
  const candidates = (Array.isArray(payload.candidates) ? payload.candidates : []) as Candidate[];
  try {
    const elements = await Promise.all(candidates.map((candidate) => fetchElement(candidate)));
    const changesetXml = '<osm><changeset><tag k="created_by" v="POTA OSM Updater"/><tag k="comment" v="' + escapeXml(comment) + '"/></changeset></osm>';
    const changesetResponse = await fetch("https://api.openstreetmap.org/api/0.6/changeset/create", { method: "PUT", headers: { authorization: "Bearer " + token, "content-type": "application/xml" }, body: changesetXml });
    if (!changesetResponse.ok) return Response.json({ error: "OSM rejected changeset creation." }, { status: 502 });
    const changesetId = (await changesetResponse.text()).trim();
    const changes = elements.map((element, index) => modifyXml(element, candidates[index], changesetId)).join("");
    const osc = '<?xml version="1.0" encoding="UTF-8"?><osmChange version="0.6" generator="POTA OSM Updater"><modify>' + changes + "</modify></osmChange>";
    const uploadResponse = await fetch("https://api.openstreetmap.org/api/0.6/changeset/" + changesetId + "/upload", { method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/xml" }, body: osc });
    if (!uploadResponse.ok) return Response.json({ error: "OSM rejected the diff upload.", changesetId }, { status: 502 });
    return Response.json({ changesetId, uploaded: candidates.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not upload the OSM changeset." }, { status: 502 });
  }
}
