function cookieValue(request: Request, name: string) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="))?.slice(name.length + 1) ?? "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code"); const state = url.searchParams.get("state");
  const savedState = cookieValue(request, "osm_oauth_state"); const verifier = cookieValue(request, "osm_oauth_verifier");
  const clientId = process.env.OSM_CLIENT_ID?.trim();
  if (!code || !state || !savedState || state !== savedState || !verifier || !clientId) return new Response("Invalid OSM OAuth callback", { status: 400 });
  const redirectUri = process.env.OSM_REDIRECT_URI || url.origin + "/api/osm/callback";
  const tokenRequest = new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier });
  const clientSecret = process.env.OSM_CLIENT_SECRET?.trim();
  if (clientSecret && process.env.OSM_OAUTH_CONFIDENTIAL === "true") tokenRequest.set("client_secret", clientSecret);
  const tokenResponse = await fetch("https://www.openstreetmap.org/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: tokenRequest });
  if (!tokenResponse.ok) {
    const errorBody = (await tokenResponse.text()).slice(0, 500);
    console.error("OSM OAuth token exchange failed", tokenResponse.status, errorBody);
    return new Response("Could not exchange OSM authorization code", { status: 502 });
  }
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return new Response("OSM did not return an access token", { status: 502 });
  const secure = url.protocol === "https:" ? "; Secure" : "";
  const response = Response.redirect(url.origin + "/?osm=connected", 302);
  response.headers.append("set-cookie", "osm_access_token=" + token.access_token + "; HttpOnly" + secure + "; SameSite=Lax; Path=/; Max-Age=2592000");
  return response;
}
