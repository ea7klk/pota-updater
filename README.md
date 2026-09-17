# POTA → OSM Updater

Review-first web application for reconciling active POTA park records with OpenStreetMap `communication:amateur_radio:pota=<POTA reference>` entities.

## Features

- Shows active unmapped POTA parks in a Leaflet map, using a 20,000 km² visible-bounding-box limit and Overpass tag detection.
- Generates candidates only for the confirmed, currently visible map bounding box.
- Searches Photon and Nominatim for additional OSM candidates, using partial/fuzzy matching and prioritising relations and ways over nodes.
- Independently verifies candidates against the official OSM object API so already-tagged entities are excluded.
- Shows multiple candidates per park but permits only one approved candidate per POTA reference.
- Provides OSM inspection links, streamed reconciliation progress, downloadable `.osc` files, and explicit OSM uploads.
- Uses OpenStreetMap OAuth 2.0 Authorization Code with PKCE as the only application authentication provider.

## Local development

Requirements: Node.js 22 or newer and pnpm 11.

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000/`. Configure OSM OAuth first using [docs/osm-oauth-setup.md](docs/osm-oauth-setup.md). Copy `.env.example` to `.env.local` and set `OSM_CLIENT_ID`.

Useful checks:

```sh
pnpm typecheck
pnpm lint
pnpm build
```

## Docker

```sh
docker build -t pota-updater:local .
docker run --rm -p 3000:3000 \
  -e OSM_CLIENT_ID=your-client-id \
  -e OSM_REDIRECT_URI=http://127.0.0.1:3000/api/osm/callback \
  pota-updater:local
```

The production image is built from the Next.js standalone output. GitHub Actions publishes `ghcr.io/ea7klk/pota-updater` for pushes to `main`.

## Deployment

Kubernetes manifests for Rancher Fleet are in [deploy/fleet](deploy/fleet). They deploy the image to the `pota-updater` namespace and expose it through Traefik at `https://potaupdater.ea7klk.es`.

The OAuth client ID is intentionally not committed. Create the `pota-updater-osm-oauth` Kubernetes Secret with the `client-id` key in the deployment namespace, and set the live callback URL in the OSM application to:

```text
https://potaupdater.ea7klk.es/api/osm/callback
```

See [docs/README.md](docs/README.md) for the workflow, safeguards, sources, and PlantUML diagrams.
