function cookieValue(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="))?.slice(name.length + 1) ?? "";
}

export async function GET(request: Request) {
  const token = cookieValue(request, "osm_access_token");
  if (!token) return Response.json({ connected: false });
  const response = await fetch("https://api.openstreetmap.org/api/0.6/user/details.json", { headers: { authorization: "Bearer " + token, accept: "application/json" } });
  if (!response.ok) return Response.json({ connected: false }, { status: 200 });
  const payload = await response.json() as { user?: { display_name?: string; id?: number } };
  return Response.json({ connected: true, user: payload.user ?? null });
}
