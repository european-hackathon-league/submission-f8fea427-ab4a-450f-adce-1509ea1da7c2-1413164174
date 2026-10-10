import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  BookOpen,
  GitBranch,
  History,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { ApiError, commandKey, createApi, createRealApi } from "./api/client";
import ApiAccess from "./ApiAccess";
import FindingDetails from "./components/FindingDetails";
import EvidenceList from "./components/EvidenceList";
import GraphPanel from "./components/GraphPanel";
import SourceDialog from "./components/SourceDialog";
import ResearchPanel from "./components/ResearchPanel";
import ConflictPanel from "./components/ConflictPanel";
import ProposalWorkspace from "./components/ProposalWorkspace";
import HistoryPanel from "./components/HistoryPanel";
import RenderPanel from "./components/RenderPanel";
import ChangeExplanation from "./components/ChangeExplanation";
import SceneCapabilities from "./components/SceneCapabilities";
import { recoverRun } from "./runRecovery";
import { readSession, saveSession, clearSession } from "./session";
import type { PendingRun, ProposalSelection } from "./session";
import type {
  Api,
  Evidence,
  Finding,
  Page,
  RunConfig,
  Upload,
  Vehicle,
  Workspace,
} from "./api/contracts";
import type { ComponentId, VehicleView } from "./domain/contracts";
import sceneCatalog from "../public/vehicles/scene-catalog-v1.json";
import "./ui/workspace.css";

const VehicleViewer = lazy(() => import("./viewer/BmwAssetViewer"));
const tabs = [
  { title: "Findings", icon: BookOpen },
  { title: "Graph", icon: Network },
  { title: "Evidence", icon: BookOpen },
  { title: "Proposals", icon: GitBranch },
  { title: "History", icon: History },
] as const;
type Tab = (typeof tabs)[number]["title"];
type UploadRow = {
  id: string;
  filename: string;
  status: "uploading" | "failed" | "ready" | "rejected";
  source_id?: string;
  reason?: string | null;
};
function requestError(error: unknown): string {
  if (!(error instanceof Error)) return "Request failed. Retry.";
  if (!(error instanceof ApiError)) return error.message;
  const fields = error.field_errors.map(field => Object.entries(field).map(([name, value]) => `${name}: ${value}`).join(" · ")).join("; ");
  return [error.message, fields, error.requestId ? `Request ID: ${error.requestId}` : ""].filter(Boolean).join(" — ");
}
const spatialPartIds = new Set<string>(["body", "lighting", "charging", "steering", "dashboard", "seats"]);
type ProposalDraft = { text: string; target: string; baseVersion: number };

export default function App({ api: suppliedApi }: { api?: Api }) {
  const [connectedApi, setConnectedApi] = useState<Api | null>(suppliedApi ?? (import.meta.env.VITE_API_MODE === "real" ? null : createApi()));
  if (!connectedApi) return <ApiAccess baseUrl={import.meta.env.VITE_API_BASE_URL || "/api/v1"} onConnect={(base, headers, sessionNamespace) => setConnectedApi(createRealApi(base, { headers: () => headers, sessionNamespace }))} />;
  return <WorkspaceApp key={connectedApi.sessionNamespace ?? connectedApi.mode} api={connectedApi} onDisconnect={connectedApi.mode === "real" && !suppliedApi ? () => setConnectedApi(null) : undefined} />;
}

function WorkspaceApp({ api: suppliedApi, onDisconnect }: { api: Api; onDisconnect?: () => void }) {
  const [api, setApi] = useState(() => suppliedApi ?? createApi());
  const sessionNamespace = api.sessionNamespace ?? `real:${import.meta.env.VITE_API_BASE_URL || "/api/v1"}`;
  const [restored] = useState(() => api.mode === "real" ? readSession(sessionNamespace) : null);
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(restored?.pendingRun ?? null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("g60-i5-m60");
  const [deepDive, setDeepDive] = useState(false);
  const [mode, setMode] = useState<"autonomous" | "guided">("autonomous");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [runId, setRunId] = useState<string | null>(restored?.runId ?? null);
  const activeRunId = useRef(runId);
  const runEpoch = useRef(0);
  const [tab, setTab] = useState<Tab>(tabs.some(t => t.title === restored?.tab) ? restored!.tab as Tab : "Findings");
  const [selectedFindingId, setSelectedFindingId] =
    useState<string | null>(restored ? restored.selectedFindingId : "");
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentId | null>(spatialPartIds.has(restored?.selectedComponent ?? "") && sceneCatalog.parts.some(p => p.part_id === restored?.selectedComponent) ? restored!.selectedComponent as ComponentId : null);
  const [view, setView] = useState<VehicleView>(restored?.view === "interior" ? "interior" : "exterior");
  const [variantId, setVariantId] = useState(restored?.variantId ?? "");
  const [proposalSelection, setProposalSelection] = useState<ProposalSelection | null>(restored?.proposalSelection ?? null);
  const [heatmap, setHeatmap] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [findingFocusRequest, setFindingFocusRequest] = useState(0);
  const [source, setSource] = useState<Evidence | null>(null);
  const lock = useRef(false);
  const proposalDrafts = useRef(new Map<string, ProposalDraft>(restored?.proposalDrafts ?? []));
  const [ideaDraft, setIdeaDraft] = useState(restored?.ideaDraft ?? "");
  const run = workspace?.snapshot;
  const savedConfig = run?.config ?? pendingRun?.config;
  const vehicle = vehicles.find(
    (v) => v.vehicle_id === (savedConfig?.vehicle_id ?? vehicleId),
  );
  const baselineAvailable =
    vehicle?.vehicle_id === sceneCatalog.vehicle_id &&
    (savedConfig?.baseline_asset_id ?? vehicle.baseline_asset_id) === sceneCatalog.baseline_asset_id &&
    (savedConfig?.part_catalog_version ?? vehicle.part_catalog_version) === sceneCatalog.part_catalog_version;
  const configurationAvailable = !!vehicle?.baseline_asset_id && !!vehicle.part_catalog_version;
  const setupLocked = !!runId || !!pendingRun;
  const finding =
    selectedFindingId === null ? undefined : selectedFindingId ? workspace?.findings.find((f) => f.finding_id === selectedFindingId) : workspace?.findings[0];
  const variant =
    variantId ? workspace?.proposals.variants.find((v) => v.variant_id === variantId) : workspace?.proposals.variants[0];
  const activeVariantId = variant?.variant_id ?? variantId;
  useEffect(() => {
    if (!variantId && workspace?.proposals.variants[0]) setVariantId(workspace.proposals.variants[0].variant_id);
    if (selectedFindingId === "" && workspace?.findings[0]) setSelectedFindingId(workspace.findings[0].finding_id);
  }, [workspace, variantId, selectedFindingId]);
  const readySourceIds = [
    ...new Set(
      uploads.filter((u) => u.status === "ready").map((u) => u.source_id!),
    ),
  ];

  useEffect(() => {
    let active = true;
    (api.vehicles ? api.vehicles() : api.request<Page<Vehicle>>("/vehicles").then(page => page.items))
      .then((result) => {
        if (active) {
          setVehicles(result);
          setVehicleId(current => result.some(v => v.vehicle_id === current) ? current : result[0]?.vehicle_id ?? current);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const refresh = useCallback(
    async (id: string) => {
      const epoch = runEpoch.current;
      const next = await api.workspace(id);
      if (activeRunId.current !== id || runEpoch.current !== epoch) return next;
      setWorkspace((old) =>
        old?.snapshot.run_id === id &&
        old.snapshot.revision > next.snapshot.revision
          ? old
          : next,
      );
      setConnection("");
      return next;
    },
    [api],
  );

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    void recoverRun(api, runId, {
      workspace: next => setWorkspace(old => old?.snapshot.run_id === runId && old.snapshot.revision > next.snapshot.revision ? old : next),
      status: setConnection,
    }, controller.signal);
    return () => controller.abort();
  }, [api, runId, recoveryAttempt]);

  const persistSession = useCallback(() => {
    if (api.mode !== "real") return;
    saveSession(sessionNamespace, { pendingRun, runId, tab, selectedFindingId, selectedComponent: selectedComponent ?? "", view, variantId, proposalSelection, ideaDraft, proposalDrafts: [...proposalDrafts.current] });
  }, [api.mode, sessionNamespace, pendingRun, runId, tab, selectedFindingId, selectedComponent, view, variantId, proposalSelection, ideaDraft]);
  useEffect(persistSession, [persistSession]);
  useEffect(() => {
    window.addEventListener("pagehide", persistSession);
    return () => { persistSession(); window.removeEventListener("pagehide", persistSession); };
  }, [persistSession]);

  async function act(action: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(requestError(e));
      if (e instanceof ApiError && e.code === "stale_version" && runId)
        await refresh(runId).catch(() =>
          setConnection("Refresh failed. Retry; your draft remains here."),
        );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function uploadFiles(files: File[]) {
    const rows = files.map((file) => ({
      id: commandKey(),
      filename: file.name,
      status: "uploading" as const,
    }));
    setUploads((old) => [...old, ...rows]);
    await Promise.all(
      files.map(async (file, index) => {
        try {
          const uploaded: Upload = await api.upload(file);
          setUploads((old) =>
            old.map((row) =>
              row.id === rows[index].id ? { ...row, ...uploaded } : row,
            ),
          );
        } catch (e) {
          setUploads((old) =>
            old.map((row) =>
              row.id === rows[index].id
                ? {
                    ...row,
                    status: "failed",
                    reason:
                      e instanceof Error
                        ? e.message
                        : "Upload failed. Remove and try again.",
                  }
                : row,
            ),
          );
        }
      }),
    );
  }

  async function createRun(config?: RunConfig) {
    const command = pendingRun ?? { key: commandKey(), config: config! };
    if (!command.config) return;
    setPendingRun(command);
    await act(async () => {
      let result: { run_id: string };
      try {
        result = await api.request<{ run_id: string }>("/runs", command.config, command.key);
      } catch (error) {
        if (error instanceof ApiError && !error.retryable && error.status !== null && error.status < 500) setPendingRun(null);
        throw error;
      }
      activeRunId.current = result.run_id;
      setRunId(result.run_id);
      setPendingRun(null);
      await refresh(result.run_id);
    });
  }

  function selectFinding(next: Finding) {
    setProposalSelection(null);
    setFindingFocusRequest(old => old + 1);
    setSelectedFindingId(next.finding_id);
    const mapped = baselineAvailable && next.part_ids.find(id => spatialPartIds.has(id) && sceneCatalog.parts.some(part => part.part_id === id && part.capabilities.some(c => c === "list_annotation" || c === "photo_annotation")));
    setSelectedComponent(mapped || null);
    if (mapped) setView(["dashboard", "steering", "seats"].includes(mapped) ? "interior" : "exterior");
  }

  function selectPart(id: ComponentId) {
    setProposalSelection(null);
    setTab("Evidence");
    setSelectedComponent(id);
    const matches = workspace?.findings.filter(f => f.part_ids.includes(id)) ?? [];
    const existing = matches.find(f => f.finding_id === selectedFindingId);
    setSelectedFindingId(existing?.finding_id ?? (matches.length === 1 ? matches[0].finding_id : null));
    if (matches.length > 1 && !existing) setTab("Findings");
  }
  const selectedFinding = finding;

  useEffect(() => {
    if (findingFocusRequest && tab === "Evidence") document.getElementById("panel-Evidence")?.focus();
  }, [findingFocusRequest, tab]);
  useEffect(() => {
    if (selectedComponent && (!baselineAvailable || (selectedFindingId && !finding?.part_ids.includes(selectedComponent)))) setSelectedComponent(null);
  }, [baselineAvailable, finding, selectedFindingId, selectedComponent]);

  const reset = () => {
    activeRunId.current = null;
    runEpoch.current++;
    clearSession(sessionNamespace);
    proposalDrafts.current.clear();
    setIdeaDraft("");
    setPendingRun(null);
    setWorkspace(null);
    setRunId(null);
    setUploads([]);
    setSource(null);
    setError("");
    setConnection("");
    setDeepDive(false);
    setMode("autonomous");
    setSelectedFindingId("");
    setSelectedComponent(null);
    setVariantId("");
    setProposalSelection(null);
    if (api.mode === "mock") { api.dispose?.(); setApi(createApi()); }
  };

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="app-header">
        <div>
          <strong className="wordmark">FWD</strong>
          <span>Vehicle requirements</span>
        </div>
        {onDisconnect && <button onClick={onDisconnect}>Change API access</button>}
        <span className="environment">
          {api.mode === "mock" ? "Synthetic workspace" : "Connected workspace"}
        </span>
      </header>
      <main id="workspace">
        <section className="run-setup" aria-label="Run setup">
          <div className="section-title">
            <h1>{setupLocked ? "Saved configuration" : "New analysis run"}</h1>
            {runId && (
              <button onClick={reset} disabled={busy}>
                <Plus size={16} />
                New run
              </button>
            )}
          </div>
          <div className="setup-fields">
            <label className="vehicle-field">
              Vehicle
              <select
                aria-label="Vehicle"
                value={savedConfig?.vehicle_id ?? vehicleId}
                disabled={setupLocked || busy}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                {vehicles.length ? (
                  vehicles.map((v) => (
                    <option key={v.vehicle_id} value={v.vehicle_id}>
                      {v.title}
                    </option>
                  ))
                ) : (
                  <option value="g60-i5-m60">Loading vehicles...</option>
                )}
              </select>
            </label>
            <fieldset disabled={setupLocked || busy}>
              <legend>Participation</legend>
              <label>
                <input
                  type="radio"
                  name="participation"
                  checked={
                    (savedConfig?.participation_mode ?? mode) === "autonomous"
                  }
                  onChange={() => setMode("autonomous")}
                />
                Autonomous
              </label>
              <label>
                <input
                  type="radio"
                  name="participation"
                  checked={
                    (savedConfig?.participation_mode ?? mode) === "guided"
                  }
                  onChange={() => setMode("guided")}
                />
                Guided
              </label>
            </fieldset>
            <label className="check-field">
              <input
                type="checkbox"
                checked={savedConfig?.deep_dive.enabled ?? deepDive}
                disabled={setupLocked || busy}
                onChange={(e) => setDeepDive(e.target.checked)}
              />
              Deep Dive
            </label>
            {!setupLocked && (
              <button
                className="primary"
                disabled={
                  busy ||
                  !configurationAvailable ||
                  !readySourceIds.length ||
                  uploads.some((u) => u.status === "uploading")
                }
                onClick={() => void createRun({
                  vehicle_id: vehicle!.vehicle_id,
                  baseline_asset_id: vehicle!.baseline_asset_id!,
                  part_catalog_version: vehicle!.part_catalog_version!,
                  source_ids: readySourceIds,
                  market_context: [],
                  participation_mode: mode,
                  deep_dive: { enabled: deepDive },
                })}
              >
                {busy ? <LoaderCircle size={16} /> : <ArrowRight size={16} />}
                Create run
              </button>
            )}
          </div>
          {pendingRun && !runId && <div role="status" className="notice">
            Run creation outcome pending. Settings frozen; retry original request to recover its result.
            <button disabled={busy} onClick={() => void createRun()}>Retry run creation</button>
          </div>}
          {!setupLocked && (
            <div className="upload-zone">
              <label className="upload-control">
                <UploadIcon size={18} />
                <span>Upload files</span>
                <input
                  aria-label="Upload files"
                  type="file"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    void uploadFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </label>
              <span className="muted">
                Partial packages and multiple regional files accepted
              </span>
            </div>
          )}
          <ul className="upload-list">
            {uploads.map((row) => (
              <li key={row.id}>
                <span>{row.filename}</span>
                <span className={`status status-${row.status}`}>
                  {row.status}
                </span>
                {row.reason && (
                  <span className="upload-error">{row.reason}</span>
                )}
                {!setupLocked && (
                  <button
                    className="icon-button"
                    aria-label={`Remove ${row.filename}`}
                    title="Remove file"
                    disabled={row.status === "uploading" || busy}
                    onClick={() =>
                      setUploads((old) => old.filter((u) => u.id !== row.id))
                    }
                  >
                    <X size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!baselineAvailable && vehicles.length > 0 && (
            <p className="notice">Baseline asset unavailable</p>
          )}
          {run && <dl aria-label="Saved source package">
            <dt>Completed source IDs</dt><dd>{run.config.source_ids.join(", ")}</dd>
            <dt>Baseline asset</dt><dd>{run.config.baseline_asset_id}</dd>
            <dt>Part catalog</dt><dd>{run.config.part_catalog_version}</dd>
            <dt>Market context</dt><dd>{run.config.market_context.join(", ") || "Not supplied"}</dd>
          </dl>}
          {runId && !run && <p role="status">Run {runId} accepted. Recovering saved configuration…</p>}
          {run && (
            <div className="run-progress" role="status">
              <span className="status">{run.analysis_status}</span>
              <strong>{run.stage}</strong>
              <span>{run.run_id}</span>
              {busy && <LoaderCircle size={16} className="spin" />}
            </div>
          )}
        </section>
        {error && (
          <div role="alert" className="error-bar">
            {error}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              title="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {connection && (
          <div role="status" className="notice">
            {connection}
            <button
              onClick={() =>
                void act(async () => {
                  await refresh(runId!);
                  setRecoveryAttempt(old => old + 1);
                })
              }
            >
              <RefreshCw size={15} />
              Reconnect
            </button>
          </div>
        )}
        <div className="work-area">
          <section className="vehicle-column" aria-label="Vehicle workspace">
            <div className="section-title">
              <h2>Baseline vehicle</h2>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={heatmap}
                  onChange={(e) => setHeatmap(e.target.checked)}
                />
                Feedback tags
              </label>
            </div>
            {baselineAvailable ? (
              <Suspense
                fallback={
                  <div className="empty-state">Loading baseline vehicle...</div>
                }
              >
                <VehicleViewer
                  className="bmw-asset-viewer--compact"
                  selectedComponent={selectedComponent}
                  onSelectComponent={selectPart}
                  view={view}
                  onViewChange={setView}
                  heatmap={heatmap}
                  findings={(run?.part_aggregates ?? []).map((a) => ({
                    id: a.part_id,
                    counts: a.counts,
                    cohort_ids: a.wire?.cohort_ids ?? [],
                  }))}
                />
              </Suspense>
            ) : (
              <div className="empty-state">
                <h3>{vehicle?.title ?? "Vehicle catalog"}</h3>
                <p>
                  {vehicles.length
                    ? "No verified baseline asset for this model."
                    : "Loading asset availability..."}
                </p>
              </div>
            )}
            <SceneCapabilities vehicle={vehicle} config={savedConfig ?? {
              vehicle_id: vehicleId,
              baseline_asset_id: vehicle?.baseline_asset_id ?? "",
              part_catalog_version: vehicle?.part_catalog_version ?? "",
            }} />
            {run?.warnings.map((w) => (
              <p className="coverage-note" key={w}>
                {w}
              </p>
            ))}
            {workspace && <RenderPanel api={api} workspace={workspace} variantId={activeVariantId} busy={busy} onRefresh={() => refresh(runId!)} onOpen={setSource} />}
          </section>
          <section className="analysis-column" aria-label="Analysis panels">
            <div
              className="panel-tabs"
              role="tablist"
              aria-label="Analysis views"
            >
              {tabs.map(({ title, icon: Icon }, index) => (
                <button
                  id={`tab-${title}`}
                  key={title}
                  role="tab"
                  aria-selected={tab === title}
                  aria-controls={`panel-${title}`}
                  tabIndex={tab === title ? 0 : -1}
                  onClick={() => setTab(title)}
                  onKeyDown={(e) => {
                    const next =
                      e.key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : e.key === "ArrowLeft"
                          ? (index + tabs.length - 1) % tabs.length
                          : e.key === "Home"
                            ? 0
                            : e.key === "End"
                              ? tabs.length - 1
                              : null;
                    if (next !== null) {
                      e.preventDefault();
                      setTab(tabs[next].title);
                      document
                        .getElementById(`tab-${tabs[next].title}`)
                        ?.focus();
                    }
                  }}
                >
                  <Icon size={16} />
                  {title}
                </button>
              ))}
            </div>
            <div
              className="analysis-panel"
              role="tabpanel"
              tabIndex={-1}
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
            >
              {!workspace ? (
                <div className="empty-state">
                  <Network size={30} />
                  <h2>Vehicle evidence workspace</h2>
                  <p>No analysis run yet.</p>
                </div>
              ) : (
                <>
                  <ConflictPanel api={api} workspace={workspace} busy={busy} onRefresh={() => refresh(runId!)} />
                  {tab === "Findings" && (
                    <>
                      <div className="section-title">
                        <h2>Customer findings</h2>
                        <span className="muted">Feedback records</span>
                      </div>
                      {[
                        { title: "Part findings", matches: (f: Finding) => f.part_ids.length > 0 && f.part_ids.every(id => baselineAvailable && spatialPartIds.has(id) && sceneCatalog.parts.some(p => p.part_id === id)) },
                        { title: "Vehicle-wide findings", matches: (f: Finding) => f.part_ids.length === 0 },
                        { title: "Unmapped or non-geometric findings", matches: (f: Finding) => f.part_ids.length > 0 && f.part_ids.some(id => !baselineAvailable || !spatialPartIds.has(id) || !sceneCatalog.parts.some(p => p.part_id === id)) },
                      ].map(group => <section key={group.title} aria-label={group.title}>
                        <h3>{group.title}</h3>
                        <div className="finding-list">
                          {workspace.findings.filter(group.matches).map(f => <button className="finding-item" key={f.finding_id} aria-pressed={finding?.finding_id === f.finding_id} onClick={() => { selectFinding(f); setTab("Evidence"); }}>
                            <BookOpen size={16} aria-hidden="true" />
                            <span><strong>{f.title}</strong><small>{f.customer_need}</small><small>{f.counts.negative_records} of {f.counts.total_records} negative feedback records{f.provisional ? " / provisional" : ""}</small><small>{f.part_ids.length ? `Part IDs: ${f.part_ids.join(", ")}` : "Vehicle-wide; no geometric mapping"}</small></span>
                            <ArrowRight size={16} aria-hidden="true" />
                          </button>)}
                          {!workspace.findings.some(group.matches) && <p className="muted">No findings in this group.</p>}
                        </div>
                      </section>)}
                    </>
                  )}
                  {tab === "Graph" && (
                    <GraphPanel
                      api={api} runId={runId!} onOpen={setSource}
                      workspace={workspace}
                      onSelect={(id) => {
                        const f = workspace.findings.find(
                          (row) => row.finding_id === id,
                        );
                        if (f) {
                          selectFinding(f);
                          setTab("Evidence");
                        }
                      }}
                    />
                  )}
                  {tab === "Evidence" &&
                    (selectedFinding ? (
                      <>
                        <FindingDetails finding={selectedFinding} aggregates={run?.part_aggregates} changes={workspace.proposals.variants.flatMap(v => v.changes)} />
                        <EvidenceList
                          api={api}
                          runId={runId!}
                          ids={selectedFinding.supporting_evidence_ids}
                          title="Supporting observations"
                          onOpen={setSource}
                        />
                        <EvidenceList
                          api={api}
                          runId={runId!}
                          ids={selectedFinding.opposing_evidence_ids}
                          title="Opposing observations"
                          onOpen={setSource}
                        />
                        {savedConfig?.deep_dive.enabled && <ResearchPanel api={api} runId={runId!} finding={selectedFinding} bundles={workspace.research} error={workspace.resourceErrors?.research} onRetry={() => refresh(runId!)} onOpen={setSource} />}
                      </>
                    ) : proposalSelection ? (
                      <>
                        <p>No available finding is linked to this proposal. Customer findings remain separate from PM ideas.</p>
                        {proposalSelection.proposalVersion === workspace.proposals.proposal_set_version ? <ChangeExplanation api={api} runId={runId!} proposals={workspace.proposals} variantId={proposalSelection.variantId} changeId={proposalSelection.changeId} onOpen={setSource} /> : <p>Selected proposal version {proposalSelection.proposalVersion} has changed. Inspect that exact immutable version in History.</p>}
                      </>
                    ) : (
                      <div className="empty-state">
                        {selectedFindingId ? "Selected finding is unavailable in this snapshot. Return to Findings or reconnect to retry." : "No finding mapped to this part. Vehicle-wide findings remain available in Findings."}
                      </div>
                    ))}
                  <div hidden={tab !== "Proposals"}>
                    <ProposalWorkspace api={api} workspace={workspace} variantId={activeVariantId} onVariantChange={setVariantId} busy={busy} onRefresh={() => refresh(runId!)} sessionNamespace={sessionNamespace} legacyDrafts={[...proposalDrafts.current]} legacyIdea={ideaDraft} onEvidence={change => {
                      const linked = workspace.findings.find(f => (change.wire?.finding_ids ?? [change.finding_id]).includes(f.finding_id));
                      if (linked) selectFinding(linked);
                      else {
                        setSelectedFindingId(null);
                        setSelectedComponent(null);
                        setProposalSelection({proposalVersion: workspace.proposals.proposal_set_version, variantId: activeVariantId, changeId: change.change_id});
                        setFindingFocusRequest(old => old + 1);
                      }
                      setTab("Evidence");
                    }} />
                  </div>
                  <div hidden={tab !== "History"}>
                    <HistoryPanel api={api} workspace={workspace} variantId={activeVariantId} busy={busy} onRefresh={() => refresh(runId!)} onOpen={setSource} />
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
      {source && (
        <SourceDialog api={api} evidence={source} onClose={() => setSource(null)} />
      )}
    </div>
  );
}
