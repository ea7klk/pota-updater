export async function GET(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const response = Response.json({ connected: false });
  response.headers.append("set-cookie", "osm_access_token=; Max-Age=0; HttpOnly" + secure + "; SameSite=Lax; Path=/");
  return response;
}
