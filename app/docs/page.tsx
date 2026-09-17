import Link from "next/link";

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#f5f7f9] px-5 py-10 text-slate-900 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-[#176b85] hover:underline">← Back to updater</Link>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.17em] text-[#176b85]">Documentation</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-[#102b3d]">POTA → OSM Updater</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">A review-first workflow for reconciling active POTA parks with OpenStreetMap amateur radio entities.</p>
        <div className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_14px_45px_rgb(15_23_42/5%)] sm:p-8">
          <section><h2 className="text-lg font-semibold text-[#102b3d]">How it works</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600"><li>Pan and zoom the Leaflet map to the area you want to review.</li><li>The map loads active POTA CSV points and uses Overpass to remove references already tagged in OSM.</li><li>The visible map must cover no more than 20,000 km². Confirm the view with <strong>Find candidates in the displayed map</strong>.</li><li>Search public OSM Photon results first, falling back to Nominatim when needed, with partial and fuzzy matching that prioritizes ways and relations.</li><li>Inspect candidates in OSM, then approve at most one candidate per POTA park.</li><li>Download an OsmChange file containing only approved modifications.</li></ol></section>
          <section><h2 className="text-lg font-semibold text-[#102b3d]">Authentication</h2><p className="mt-3 text-sm leading-6 text-slate-600">OpenStreetMap is the only identity provider. Connect an OSM account through OAuth 2.0 Authorization Code with PKCE; the app requests read_prefs and write_api, keeps the token in an HttpOnly cookie, and adds Secure automatically for HTTPS deployments. The complete registration guide is in <code>docs/osm-oauth-setup.md</code> in the repository.</p></section>
          <section><h2 className="text-lg font-semibold text-[#102b3d]">Safeguards</h2><p className="mt-3 text-sm leading-6 text-slate-600">The app never uploads changes automatically from the review queue. After approval, choose direct upload or inspect the generated file in JOSM first.</p></section>
          <section><h2 className="text-lg font-semibold text-[#102b3d]">PlantUML diagrams</h2><p className="mt-3 text-sm leading-6 text-slate-600">The source diagrams are in the docs directory: architecture and reconciliation sequence. They use only core PlantUML syntax so they render on plantuml.com.</p></section>
        </div>
      </div>
    </main>
  );
}
