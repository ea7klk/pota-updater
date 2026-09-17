# POTA to OSM Updater

This app is a review-first workspace for bringing active entries from the POTA extended park CSV into OpenStreetMap using the `communication:amateur_radio:pota=<POTA reference>` tag.

## Workflow

1. Select a country and region loaded from the active POTA CSV catalog.
2. The reconciliation route fetches the active POTA CSV rows and queries the configured Overpass interpreter only for existing tagged entities.
3. Candidate matches come from public OpenStreetMap search services: Photon first, with Nominatim as a fallback when Photon is unavailable. Partial names, fuzzy similarity, proximity, and object type are used for ranking; ways and relations are prioritized over nodes. Existing tagged entities are excluded.
4. Search results are independently checked against the OSM object API; any object that already has `communication:amateur_radio:pota` is discarded, even if Overpass did not return it.
5. Up to 500 active parks are searched per reconciliation. Regional scopes smaller than that are searched completely. Requests are queued with low concurrency and per-source delays so public services are not flooded.
6. Multiple candidates may be shown for one POTA park, but the review UI allows only one approved candidate per POTA reference.
7. A contributor approves individual suggestions.
8. The app generates an OsmChange .osc file containing only approved modifications to existing OSM objects. The file should be inspected in JOSM before upload.

The UI does not fall back to mock candidate data. If live reconciliation cannot verify a candidate safely, it is omitted and the user sees the live-source result instead.

## OSM authentication

The app delegates identity and edit authorization to OpenStreetMap OAuth 2.0 Authorization Code with PKCE. There is no separate app account or ChatGPT login. See [Register an OpenStreetMap OAuth application](./osm-oauth-setup.md) for the complete setup, including the required scopes and callback URLs. Configure:

    OSM_CLIENT_ID=...
    OSM_REDIRECT_URI=https://potaupdater.ea7klk.es/api/osm/callback

For local development, use `http://127.0.0.1:5173/` and register `http://127.0.0.1:5173/api/osm/callback`; OSM permits plain HTTP for loopback development URLs and requires HTTPS for deployed web callbacks. Copy `.env.example` to `.env.local`, replace the placeholder client ID, and restart the dev server after changing environment variables. If the client ID is missing, the app reports the exact callback URL needed. The OAuth callback uses a non-Secure cookie on local HTTP and automatically adds `Secure` when served over HTTPS.

The app requests `read_prefs`, `write_api`, `write_changeset_comments`, and `openid`. The access token is stored in an HttpOnly, SameSite cookie and is marked Secure when the app is served over HTTPS. The UI offers both a downloadable .osc file and an explicit Upload to OSM action after approval; it never uploads from the suggestion queue without that user action.

The production implementation should add server-side session storage, token rotation/revocation, rate limiting, and a server-side membership/authorization policy before enabling direct diff uploads. The scope catalog is cached in memory for 24 hours and refreshed from the POTA CSV on the first request after expiry.

## Local development

Use the bundled Node runtime if node is not on PATH:

    /Users/Volker_Kerkhoff/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/install-dependencies.mjs
    npm run dev

The local preview is served on loopback by default. External integrations use HTTPS endpoints:

- POTA CSV: https://pota.app/all_parks_ext.csv
- Overpass: https://overpass.ea7klk.es/api/interpreter (existing-tag detection only)
- Photon: https://photon.komoot.io/api/ (primary OSM candidate search)
- Nominatim: https://nominatim.openstreetmap.org/search (fallback OSM candidate search)
- OSM OAuth: https://www.openstreetmap.org/oauth2/authorize and /oauth2/token

## PlantUML

The diagrams are intentionally plain PlantUML and render on plantuml.com:

- architecture.puml
- reconciliation-sequence.puml

They avoid local includes, external sprites, and custom libraries. Paste either file into the PlantUML server or desktop app.
