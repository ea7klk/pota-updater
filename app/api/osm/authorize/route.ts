function toBase64Url(bytes: Uint8Array) {
  let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const redirectUri = process.env.OSM_REDIRECT_URI || origin + "/api/osm/callback";
  const clientId = process.env.OSM_CLIENT_ID?.trim();
  if (!clientId || clientId === "replace-with-your-osm-oauth-client-id") return Response.json({ error: "OSM OAuth is not configured", setupUrl: "https://www.openstreetmap.org/oauth2/applications", redirectUri }, { status: 503 });
  const state = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = toBase64Url(new Uint8Array(digest));
  const url = "https://www.openstreetmap.org/oauth2/authorize?response_type=code&client_id=" + encodeURIComponent(clientId) + "&redirect_uri=" + encodeURIComponent(redirectUri) + "&scope=" + encodeURIComponent("read_prefs write_api write_changeset_comments openid") + "&state=" + encodeURIComponent(state) + "&code_challenge=" + encodeURIComponent(challenge) + "&code_challenge_method=S256";
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const response = Response.json({ url });
  response.headers.append("set-cookie", "osm_oauth_state=" + state + "; HttpOnly" + secure + "; SameSite=Lax; Path=/; Max-Age=600");
  response.headers.append("set-cookie", "osm_oauth_verifier=" + verifier + "; HttpOnly" + secure + "; SameSite=Lax; Path=/; Max-Age=600");
  return response;
}
