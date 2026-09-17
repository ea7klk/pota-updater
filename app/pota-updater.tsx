"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, ExternalLink, FileDown, Globe2, History, LoaderCircle, Map, Radio, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

type Candidate = { id: string; name: string; code: string; region: string; country: string; lat: number; lon: number; confidence: number; matchType: "exact" | "near" | "review"; osmType: "node" | "way" | "relation"; osmId: string; osmName: string; tags: Record<string, string> };
type ScopeOption = { value: string; label: string; regions: Array<{ value: string; label: string }> };
type OsmUser = { display_name?: string; id?: number };
type ReconciliationProgress = { phase: string; message: string; completed: number; total: number; candidateCount: number; existing: number };

const fallbackScopes: ScopeOption[] = [
  { value: "DE", label: "Germany", regions: [{ value: "BY", label: "BY" }] },
  { value: "ES", label: "Spain", regions: [{ value: "AN", label: "AN" }] },
  { value: "US", label: "United States", regions: [{ value: "CO", label: "CO" }] },
  { value: "GB", label: "United Kingdom", regions: [{ value: "SCT", label: "SCT" }] },
];

const stepLabels = ["Scope", "Reconcile", "Review", "Prepare upload"];
const initials = (name: string) => name.split(/[ @]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const matchLabel = (type: Candidate["matchType"]) => type === "exact" ? "Exact name" : type === "near" ? "Nearby match" : "Needs review";

export function PotaUpdater() {
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>(fallbackScopes);
  const [country, setCountry] = useState("DE");
  const [region, setRegion] = useState("BY");
  const [activeStep, setActiveStep] = useState(2);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [scopeStats, setScopeStats] = useState({ total: 0, existing: 0 });
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconciliationProgress, setReconciliationProgress] = useState<ReconciliationProgress | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [osmUser, setOsmUser] = useState<OsmUser | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [inspectCandidate, setInspectCandidate] = useState<Candidate | null>(null);
  const [changesetComment, setChangesetComment] = useState("Add missing POTA park references");
  useEffect(() => {
    let mounted = true;
    if (new URLSearchParams(window.location.search).get("osm") === "connected") setIsConnected(true);
    fetch("/api/osm/session").then((response) => response.json() as Promise<{ connected?: boolean; user?: OsmUser | null }>).then((payload) => { if (mounted) { setIsConnected(Boolean(payload.connected)); setOsmUser(payload.user ?? null); } }).catch(() => undefined);
    fetch("/api/catalog").then((response) => response.json() as Promise<{ countries?: ScopeOption[] }>).then((payload) => {
      if (!mounted || !payload.countries?.length) return;
      setScopeOptions(payload.countries);
      const first = payload.countries.find((entry) => entry.value === "DE") ?? payload.countries[0];
      setCountry(first.value);
      setRegion(first.regions[0]?.value ?? "");
      setCandidates([]);
      setSelected([]);
      setScopeStats({ total: 0, existing: 0 });
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  const selectedCountry = scopeOptions.find((entry) => entry.value === country) ?? scopeOptions[0];
  useEffect(() => {
    const seen = new Set<string>();
    const unique = selected.filter((id) => {
      const candidate = candidates.find((item) => item.id === id);
      if (!candidate || seen.has(candidate.code)) return false;
      seen.add(candidate.code);
      return true;
    });
    if (unique.length !== selected.length) setSelected(unique);
  }, [selected, candidates]);
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    const matchesQuery = `${candidate.name} ${candidate.code} ${candidate.osmName}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (statusFilter === "all" || candidate.matchType === statusFilter);
  }), [candidates, query, statusFilter]);
  const selectedCandidates = candidates.filter((candidate) => selected.includes(candidate.id));
  const progress = candidates.length ? Math.round((selected.length / candidates.length) * 100) : 0;

  const toggleCandidate = (id: string) => setSelected((current) => {
    if (current.includes(id)) return current.filter((item) => item !== id);
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) return current;
    return [...current.filter((item) => candidates.find((itemCandidate) => itemCandidate.id === item)?.code !== candidate.code), id];
  });
  const setCountryAndRegion = (value: string) => {
    const nextRegion = scopeOptions.find((entry) => entry.value === value)?.regions[0]?.value ?? "";
    setCountry(value); setRegion(nextRegion); setCandidates([]); setSelected([]); setScopeStats({ total: 0, existing: 0 });
  };
  const setScopeRegion = (value: string) => {
    setRegion(value); setCandidates([]); setSelected([]); setScopeStats({ total: 0, existing: 0 });
  };

  async function reconcile() {
    setIsReconciling(true); setReconciliationProgress({ phase: "starting", message: "Starting reconciliation…", completed: 0, total: 0, candidateCount: 0, existing: 0 }); setActiveStep(1);
    try {
      const response = await fetch("/api/reconcile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ country, region }) });
      if (!response.ok || !response.body) throw new Error("The reconciliation stream was unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: { candidates?: Candidate[]; live?: boolean; stats?: { total?: number; existing?: number }; error?: string } | null = null;
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type?: string; phase?: string; message?: string; completed?: number; total?: number; candidateCount?: number; existing?: number; candidates?: Candidate[]; live?: boolean; stats?: { total?: number; existing?: number }; error?: string };
          if (event.type === "progress") setReconciliationProgress({ phase: event.phase ?? "working", message: event.message ?? "Reconciling sources…", completed: event.completed ?? 0, total: event.total ?? 0, candidateCount: event.candidateCount ?? 0, existing: event.existing ?? 0 });
          if (event.type === "complete") payload = event;
          if (event.type === "error") throw new Error(event.error ?? event.message ?? "Live reconciliation unavailable");
        }
        if (chunk.done) break;
      }
      if (buffer.trim()) {
        const event = JSON.parse(buffer) as { type?: string; candidates?: Candidate[]; live?: boolean; stats?: { total?: number; existing?: number }; error?: string; message?: string };
        if (event.type === "complete") payload = event;
        if (event.type === "error") throw new Error(event.error ?? event.message ?? "Live reconciliation unavailable");
      }
      if (!payload?.live) {
        setCandidates([]);
        setSelected([]);
        setScopeStats({ total: 0, existing: 0 });
        toast.error("Reconciliation failed", { description: payload?.error ?? "POTA or OSM search data is unavailable." });
        return;
      }
      const nextCandidates = payload.candidates ?? [];
      setCandidates(nextCandidates);
      setSelected(nextCandidates.slice(0, 3).map((candidate) => candidate.id));
      setScopeStats({ total: payload.stats?.total ?? 0, existing: payload.stats?.existing ?? 0 });
      toast.success("Live CSV and OpenStreetMap search reconciled", { description: `${payload.stats?.total ?? candidates.length} active parks in scope · ${nextCandidates.length} proposed matches` });
    } catch (error) { setCandidates([]); setSelected([]); setScopeStats({ total: 0, existing: 0 }); toast.error("Reconciliation failed", { description: error instanceof Error ? error.message : "POTA or OSM search data is unavailable." }); }
    finally { setIsReconciling(false); setReconciliationProgress(null); setActiveStep(2); }
  }

  async function connectOsm() {
    try {
      const response = await fetch("/api/osm/authorize");
      const payload = await response.json() as { url?: string; error?: string; setupUrl?: string; redirectUri?: string };
      if (payload.url) window.location.href = payload.url;
      else if (payload.error === "OSM OAuth is not configured") toast.error("OSM account connection is unavailable", { description: `Register an OSM OAuth app, set OSM_CLIENT_ID, and restart the server. Callback: ${payload.redirectUri ?? window.location.origin + "/api/osm/callback"}` });
      else toast.error("OSM account connection is unavailable", { description: payload.error ?? "Check the OSM OAuth server configuration." });
    } catch { toast.error("Could not start OSM sign-in"); }
  }

  async function downloadOsc() {
    const response = await fetch("/api/changeset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment: changesetComment, candidates: selectedCandidates }) });
    const payload = await response.json() as { osc?: string; error?: string };
    if (!response.ok || !payload.osc) { toast.error("Could not prepare the OsmChange file", { description: payload.error ?? "OSM objects could not be read." }); return; }
    const url = URL.createObjectURL(new Blob([payload.osc], { type: "application/xml" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "pota-osm-changes.osc"; anchor.click(); URL.revokeObjectURL(url);
    setShowUpload(false); setActiveStep(3); toast.success("OsmChange file downloaded", { description: `${selected.length} approved parks are ready for upload.` });
  }

  async function uploadToOsm() {
    const response = await fetch("/api/osm/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment: changesetComment, candidates: selectedCandidates }) });
    const payload = await response.json() as { changesetId?: string; error?: string };
    if (!response.ok) { toast.error("OSM upload failed", { description: payload.error }); return; }
    setShowUpload(false); setActiveStep(3); toast.success("Changes uploaded to OSM", { description: "Changeset " + payload.changesetId + " is now on OpenStreetMap." });
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#f5f7f9] text-slate-950">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#123d5a] text-white shadow-[0_8px_20px_rgb(18_61_90/18%)]"><Radio className="size-5" /></div><div><p className="text-[15px] font-semibold tracking-[-0.02em]">POTA → OSM</p><p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Park updater</p></div></div>
          <div className="flex items-center gap-2"><a href="https://pota.app/all_parks_ext.csv" target="_blank" rel="noreferrer" className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 sm:flex"><FileDown className="size-4" />Source CSV</a><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Help"><CircleHelp className="size-4" /></Button></TooltipTrigger><TooltipContent>Read the workflow documentation</TooltipContent></Tooltip>{isConnected && <><Separator orientation="vertical" className="mx-1 h-6" /><Avatar className="size-8"><AvatarFallback className="bg-[#e4eef5] text-xs font-semibold text-[#123d5a]">{initials(osmUser?.display_name ?? "OSM")}</AvatarFallback></Avatar><span className="hidden text-sm font-medium text-slate-700 md:block">{osmUser?.display_name ?? "OSM account"}</span></>}</div>
        </header>

        <div className="mx-auto grid max-w-[1540px] grid-cols-1 lg:grid-cols-[222px_minmax(0,1fr)]">
          <aside className="hidden min-h-[calc(100vh-72px)] border-r border-slate-200 bg-[#f9fbfc] px-5 py-7 lg:block">
            <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
            <nav className="space-y-1 text-sm"><button className="flex w-full items-center gap-3 rounded-lg bg-[#e8f1f6] px-3 py-2.5 font-semibold text-[#123d5a]"><Activity className="size-4" />Update queue</button><button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-600 hover:bg-white"><History className="size-4" />Run history</button><button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-600 hover:bg-white"><Map className="size-4" />OSM explorer</button></nav>
            <Separator className="my-7" /><p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Data sources</p><div className="space-y-2 px-3 text-xs text-slate-500"><p className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" />POTA CSV <span className="ml-auto text-[10px] text-slate-400">live</span></p><p className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" />Overpass <span className="ml-auto text-[10px] text-slate-400">live</span></p><p className="flex items-center gap-2"><span className={`size-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-slate-300"}`} />OSM account <span className="ml-auto text-[10px] text-slate-400">{isConnected ? "ready" : "off"}</span></p></div>
            <div className="mt-auto pt-24"><div className="rounded-xl border border-slate-200 bg-white p-3"><p className="flex items-center gap-2 text-xs font-semibold text-slate-700"><ShieldCheck className="size-4 text-[#176b85]" /> Review-first edits</p><p className="mt-2 text-xs leading-5 text-slate-500">Nothing reaches OSM until you approve the match list.</p></div></div>
          </aside>

          <main className="min-w-0 px-4 py-5 sm:px-8 sm:py-8"><div className="mx-auto max-w-[1160px]">
            <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.17em] text-[#176b85]">Reconciliation workspace</p><h1 className="text-[clamp(1.8rem,3vw,2.7rem)] font-semibold tracking-[-0.05em] text-[#102b3d]">Keep POTA park data in sync with OSM.</h1><p className="mt-2 max-w-2xl text-[15px] leading-6 text-slate-500">Compare active parks against existing <code className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[13px] text-slate-700">communication:amateur_radio:pota=</code> entities, review likely matches, then prepare a safe changeset.</p></div><Button variant={isConnected ? "outline" : "default"} className={isConnected ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "bg-[#123d5a] hover:bg-[#0b2e47]"} onClick={() => { if (isConnected) { fetch("/api/osm/logout").catch(() => undefined); setIsConnected(false); toast.message("OSM account disconnected"); } else connectOsm(); }}><Globe2 className="size-4" />{isConnected ? "OSM connected" : "Connect OSM account"}</Button></div>

            <div className="mb-7 flex items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_8px_28px_rgb(15_23_42/4%)]">{stepLabels.map((label, index) => <button key={label} onClick={() => setActiveStep(index)} className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${activeStep === index ? "bg-[#123d5a] text-white" : index < activeStep ? "text-[#176b85]" : "text-slate-400"}`}><span className={`grid size-5 place-items-center rounded-full text-[11px] ${activeStep === index ? "bg-white/15 text-white" : index < activeStep ? "bg-[#dceef2] text-[#176b85]" : "bg-slate-100 text-slate-400"}`}>{index < activeStep ? <Check className="size-3" /> : index + 1}</span>{label}{index < stepLabels.length - 1 && <ArrowRight className="ml-auto hidden size-3.5 opacity-35 md:block" />}</button>)}</div>

            <Card className="mb-6 overflow-hidden border-slate-200 shadow-[0_14px_45px_rgb(15_23_42/5%)]"><CardHeader className="border-b border-slate-100 bg-white pb-4"><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base text-[#102b3d]"><SlidersHorizontal className="size-4 text-[#176b85]" />1. Define the update scope</CardTitle><p className="mt-1 text-sm text-slate-500">Only active POTA parks in this scope will be queried.</p></div><Badge variant="outline" className="border-slate-200 font-normal text-slate-500">{selectedCountry.label}</Badge></div></CardHeader><CardContent className="grid gap-4 bg-[#fcfdfe] p-5 md:grid-cols-[1fr_1fr_auto] md:items-end"><div className="space-y-2"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Country</label><Select value={country} onValueChange={setCountryAndRegion}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent>{scopeOptions.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><label className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Region</label><Select value={region} onValueChange={setScopeRegion}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent>{selectedCountry.regions.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent></Select></div><Button onClick={reconcile} disabled={isReconciling} className="bg-[#176b85] hover:bg-[#11566b]">{isReconciling ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Reconcile sources</Button></CardContent></Card>

            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Active parks in scope" value={String(scopeStats.total)} note="Live POTA CSV result" icon={<Globe2 />} /><Metric label="Already in OSM" value={String(scopeStats.existing)} note="Overpass + OSM tag verification" icon={<CheckCircle2 />} accent="emerald" /><Metric label="Suggested matches" value={String(candidates.length)} note="Ranked by normalized name + proximity" icon={<Sparkles />} accent="amber" /><Metric label="Approved for upload" value={String(selected.length)} note={`${progress}% of suggestions selected`} icon={<UploadCloud />} /></div>

            <Card className="border-slate-200 shadow-[0_14px_45px_rgb(15_23_42/5%)]"><CardHeader className="gap-4 border-b border-slate-100 pb-4"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div><CardTitle className="text-base text-[#102b3d]">2. Review proposed matches</CardTitle><p className="mt-1 text-sm text-slate-500">Approve only matches that represent the same real-world park. {selected.length} selected.</p></div><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={() => setSelected(filteredCandidates.map((candidate) => candidate.id))}>Select visible</Button><Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button></div></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search park, POTA code, or OSM name" className="bg-white pl-9" /></div><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-full bg-white sm:w-[170px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All suggestions</SelectItem><SelectItem value="exact">Exact name</SelectItem><SelectItem value="near">Nearby match</SelectItem><SelectItem value="review">Needs review</SelectItem></SelectContent></Select></div></CardHeader><CardContent className="p-0"><div className="hidden grid-cols-[40px_minmax(200px,1.4fr)_minmax(220px,1fr)_100px_100px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 md:grid"><span /><span>POTA park</span><span>OSM candidate</span><span>Match</span><span>Confidence</span></div><div className="divide-y divide-slate-100">{filteredCandidates.map((candidate) => <CandidateRow key={candidate.id} candidate={candidate} selected={selected.includes(candidate.id)} onToggle={() => toggleCandidate(candidate.id)} onInspect={() => setInspectCandidate(candidate)} />)}{filteredCandidates.length === 0 && <div className="p-10 text-center text-sm text-slate-500">No proposed matches meet this filter.</div>}</div></CardContent><div className="flex flex-col justify-between gap-3 border-t border-slate-100 bg-[#fcfdfe] px-5 py-4 sm:flex-row sm:items-center"><div className="flex items-center gap-2 text-sm text-slate-500"><span className="size-2 rounded-full bg-emerald-500" />Suggestions are read-only until approved</div><Button disabled={!selected.length} onClick={() => setShowUpload(true)} className="bg-[#123d5a] hover:bg-[#0b2e47]">Prepare changeset <ArrowRight className="size-4" /></Button></div></Card>

            <div className="mt-6 flex flex-col gap-3 rounded-xl border border-[#cfe2e9] bg-[#eef7fa] px-4 py-3 text-sm text-[#315d6f] sm:flex-row sm:items-center"><ShieldCheck className="size-4 shrink-0 text-[#176b85]" /><p><span className="font-semibold text-[#123d5a]">Safe by default.</span> The generated <code className="rounded bg-white/70 px-1 py-0.5 text-xs">.osc</code> file contains only approved modifications and can be inspected in JOSM before upload.</p><a className="flex shrink-0 items-center gap-1 font-semibold text-[#176b85] hover:underline" href="/docs">Read docs <ExternalLink className="size-3" /></a></div>
          </div></main>
        </div>
        <Dialog open={showUpload} onOpenChange={setShowUpload}><DialogContent className="border-slate-200 sm:max-w-[600px]"><DialogHeader><DialogTitle className="flex items-center gap-2 text-[#102b3d]"><UploadCloud className="size-5 text-[#176b85]" />Prepare an OSM changeset</DialogTitle><DialogDescription>These {selected.length} approved matches will get a <code>communication:amateur_radio:pota</code> tag whose value is each POTA reference. Review the comment and tag payload, then choose a delivery method.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"><div className="mb-2 flex items-center justify-between"><span className="font-medium text-slate-700">Selected parks and tag payload</span><Badge variant="secondary">{selected.length}</Badge></div><div className="space-y-2 text-xs text-slate-500">{selectedCandidates.map((candidate) => <div key={candidate.id} className="rounded-md border border-slate-200 bg-white px-3 py-2"><div className="flex items-center justify-between gap-3"><span className="truncate font-medium text-slate-700">{candidate.name}</span><span className="shrink-0 font-mono text-[11px] text-slate-400">{candidate.osmType}/{candidate.osmId}</span></div><div className="mt-1.5 flex flex-wrap gap-1.5"><code className="rounded bg-[#eaf5f7] px-1.5 py-1 text-[11px] text-[#176b85]">communication:amateur_radio:pota={candidate.code}</code></div></div>)}</div></div><div className="space-y-2"><label htmlFor="changeset-comment" className="text-sm font-medium text-slate-700">Changeset comment</label><Input id="changeset-comment" value={changesetComment} onChange={(event) => setChangesetComment(event.target.value)} /></div><div className="rounded-lg border border-[#cfe2e9] bg-[#eef7fa] px-3 py-2 text-xs leading-5 text-[#315d6f]">{isConnected ? "OSM account connected. Uploading will create a changeset and publish the approved diff." : "Connect an OSM account to enable direct upload, or download the file for inspection in JOSM."}</div></div><DialogFooter><Button variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button><Button variant="outline" disabled={!isConnected} onClick={uploadToOsm} className="border-[#176b85] text-[#176b85] hover:bg-[#eef7fa]"><UploadCloud className="size-4" />Upload to OSM</Button><Button onClick={downloadOsc} className="bg-[#176b85] hover:bg-[#11566b]"><FileDown className="size-4" />Download .osc</Button></DialogFooter></DialogContent></Dialog>
        <Sheet open={Boolean(inspectCandidate)} onOpenChange={(open) => { if (!open) setInspectCandidate(null); }}><SheetContent side="right" className="w-full border-slate-200 sm:max-w-[480px]"><SheetHeader className="border-b border-slate-100"><SheetTitle className="text-[#102b3d]">Inspect proposed OSM match</SheetTitle><SheetDescription>Compare the POTA record with the selected OSM object before approving it.</SheetDescription></SheetHeader>{inspectCandidate && <div className="space-y-5 overflow-y-auto px-5 pb-6"><div className="rounded-xl border border-[#cfe2e9] bg-[#eef7fa] p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#176b85]">POTA reference</p><p className="mt-2 text-base font-semibold text-[#102b3d]">{inspectCandidate.name}</p><p className="mt-1 text-sm text-slate-500">{inspectCandidate.code} · {inspectCandidate.country} / {inspectCandidate.region}</p></div><div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">OSM candidate</p><p className="mt-2 text-base font-semibold text-slate-800">{inspectCandidate.osmName}</p><p className="mt-1 font-mono text-xs text-slate-500">{inspectCandidate.osmType}/{inspectCandidate.osmId}</p><a href={"https://www.openstreetmap.org/" + inspectCandidate.osmType + "/" + inspectCandidate.osmId} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#123d5a] px-3 py-2 text-sm font-medium text-white hover:bg-[#0b2e47]">Open in OSM <ExternalLink className="size-3.5" /></a></div><div className="space-y-2"><p className="text-sm font-semibold text-slate-700">Proposed tags</p><div className="flex flex-wrap gap-2"><code className="rounded bg-[#eaf5f7] px-2 py-1 text-xs text-[#176b85]">communication:amateur_radio:pota={inspectCandidate.code}</code></div></div><div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">Coordinates: {inspectCandidate.lat.toFixed(5)}, {inspectCandidate.lon.toFixed(5)}. Check the OSM name, geometry, and surrounding features in the new tab before approving.</div></div>}</SheetContent></Sheet>
        {isReconciling && reconciliationProgress && <ReconciliationProgressPanel progress={reconciliationProgress} />}
        <Toaster />
      </div>
    </TooltipProvider>
  );
}

function ReconciliationProgressPanel({ progress }: { progress: ReconciliationProgress }) {
  const percentage = progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 6;
  return <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 w-[min(390px,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgb(15_23_42/18%)]"><div className="flex items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#eaf5f7] text-[#176b85]"><LoaderCircle className="size-5 animate-spin" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-[#102b3d]">Reconciling sources</p><span className="text-xs font-semibold text-[#176b85]">{progress.total ? percentage + "%" : "…"}</span></div><p className="mt-1 text-xs leading-5 text-slate-500">{progress.message}</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#176b85] transition-[width] duration-300" style={{ width: percentage + "%" }} /></div><div className="mt-2 flex justify-between gap-3 text-[11px] text-slate-400"><span>{progress.total ? `${progress.completed} / ${progress.total} parks processed` : "Preparing live sources"}</span><span>{progress.candidateCount} candidates</span></div></div></div></div>;
}

function Metric({ label, value, note, icon, accent = "blue" }: { label: string; value: string; note: string; icon: React.ReactNode; accent?: "blue" | "emerald" | "amber" }) {
  const palette = accent === "emerald" ? "text-emerald-600 bg-emerald-50" : accent === "amber" ? "text-amber-600 bg-amber-50" : "text-[#176b85] bg-[#eaf5f7]";
  return <Card className="border-slate-200 shadow-[0_8px_30px_rgb(15_23_42/3%)]"><CardContent className="p-4"><div className="mb-3 flex items-center justify-between"><span className={`grid size-8 place-items-center rounded-lg ${palette}`}>{icon}</span><ChevronDown className="size-4 rotate-[-45deg] text-slate-300" /></div><p className="text-2xl font-semibold tracking-[-0.04em] text-[#102b3d]">{value}</p><p className="mt-1 text-sm font-medium text-slate-600">{label}</p><p className="mt-2 text-[11px] text-slate-400">{note}</p></CardContent></Card>;
}

function CandidateRow({ candidate, selected, onToggle, onInspect }: { candidate: Candidate; selected: boolean; onToggle: () => void; onInspect: () => void }) {
  return <div className={`grid gap-3 px-5 py-4 transition hover:bg-slate-50/75 md:grid-cols-[40px_minmax(200px,1.4fr)_minmax(220px,1fr)_100px_100px] md:items-center ${selected ? "bg-[#f7fbfc]" : ""}`}><div><Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Approve ${candidate.name}`} /></div><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-800">{candidate.name}</p><Badge variant="outline" className="hidden border-slate-200 text-[10px] font-normal text-slate-500 sm:inline-flex">{candidate.code}</Badge></div><p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Map className="size-3" />{candidate.region} · {candidate.lat.toFixed(3)}, {candidate.lon.toFixed(3)}</p></div><button type="button" onClick={onInspect} aria-label={`Inspect ${candidate.osmName} in OSM`} className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-[#9ccbd6] hover:bg-[#f5fbfc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176b85]"><p className="truncate text-sm font-medium text-slate-700">{candidate.osmName}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{candidate.osmType}/{candidate.osmId}</span><span className="truncate">{Object.entries(candidate.tags).map(([key, value]) => `${key}=${value}`).join(" · ")}</span></p><p className="mt-2 text-[11px] font-semibold text-[#176b85]">Inspect in OSM ↗</p></button><div className="flex items-center gap-2 md:block"><Badge variant="outline" className={`border ${candidate.matchType === "exact" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : candidate.matchType === "near" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{matchLabel(candidate.matchType)}</Badge><span className="text-xs text-slate-400 md:hidden">{candidate.confidence}%</span></div><div className="hidden md:block"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${candidate.confidence >= 90 ? "text-emerald-700 bg-emerald-50 border-emerald-200" : candidate.confidence >= 80 ? "text-amber-700 bg-amber-50 border-amber-200" : "text-slate-600 bg-slate-50 border-slate-200"}`}>{candidate.confidence}%</span></div></div>;
}
