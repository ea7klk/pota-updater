# Register an OpenStreetMap OAuth application

POTA → OSM uses OpenStreetMap as its only application identity provider. The app never asks for, receives, or stores an OSM password. OSM performs the login and consent flow, then returns an OAuth 2.0 access token that the app keeps in an HttpOnly session cookie.

## 1. Register the application in OSM

1. Sign in to [openstreetmap.org](https://www.openstreetmap.org/).
2. Open [OAuth 2 applications](https://www.openstreetmap.org/oauth2/applications).
3. Choose **Register new application**.
4. Use a clear name, such as `POTA OSM Updater`.
5. Add the callback URL for the environment where the app is running:

   - Local plain HTTP: `http://127.0.0.1:5173/api/osm/callback`
   - Live deployment: `https://potaupdater.ea7klk.es/api/osm/callback`

   OpenStreetMap requires HTTPS for normal web callbacks. Plain HTTP is intended for loopback development URLs such as `127.0.0.1`; use HTTPS for a deployed server.

6. Leave **Confidential application?** unchecked. Enable these permissions:

   - `read_prefs` — reads the signed-in OSM user's preferences and identity.
   - `write_api` — permits the user-approved changeset upload.
   - `write_changeset_comments` — permits changeset comments if that feature is enabled later.
   - `openid` — enables OpenStreetMap sign-in through OAuth.

   Leave the remaining permissions unchecked, including diary entries, private GPS traces, GPS uploads, notes, redactions, blocks, messages, and user preferences changes.

7. Save the application. Copy the generated **Client ID**. A client secret is not required by this app because it uses Authorization Code with PKCE.

## 2. Configure local development

Use the loopback URL in the browser as well as in the OSM registration. For example, open `http://127.0.0.1:5173/` rather than `http://localhost:5173/`.

Copy the example environment file to `.env.local` and replace the placeholder:

```env
OSM_CLIENT_ID=the-client-id-from-osm
OSM_REDIRECT_URI=http://127.0.0.1:5173/api/osm/callback
```

Restart the development server after changing environment variables. Then choose **Connect OSM account** in the app, sign in on OpenStreetMap, and approve the requested scopes.

## 3. Configure a deployed server

Register this exact HTTPS callback URL for the live deployment and set matching values in the server environment:

```env
OSM_CLIENT_ID=the-client-id-from-osm
OSM_REDIRECT_URI=https://potaupdater.ea7klk.es/api/osm/callback
```

Create the Kubernetes secret in the `pota-updater` namespace after copying the client ID:

```sh
kubectl -n pota-updater create secret generic pota-updater-osm-oauth \
  --from-literal=client-id=the-client-id-from-osm
```

The reverse proxy must terminate HTTPS and forward requests to the app. The OAuth session cookie is marked `Secure` automatically when the callback is HTTPS.

## 4. What the app authenticates with OSM

- `/api/osm/authorize` starts OSM OAuth 2.0 Authorization Code with PKCE.
- `/api/osm/callback` verifies the state and PKCE verifier, exchanges the code with OSM, and creates the HttpOnly session cookie.
- `/api/osm/session` validates the session against the OSM user API and provides the OSM display name for the header.
- `/api/osm/upload` sends only approved changes to OSM using the signed-in user’s token.
- There is no ChatGPT, local-password, or separate application account login.

If the app reports **OSM OAuth is not configured**, check that `.env.local` exists in the project root, that `OSM_CLIENT_ID` contains the real value, that the callback matches exactly, and that the server was restarted.

Reference: [OpenStreetMap OAuth documentation](https://wiki.openstreetmap.org/wiki/OAuth).
