import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  GitBranch,
  History,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload as UploadIcon,
  WandSparkles,
  X,
} from "lucide-react";
import { ApiError, commandKey, createApi } from "./api/client";
import type {
  Api,
  Change,
  Evidence,
  Finding,
  Instruction,
  Page,
  RenderResult,
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
type ProposalDraft = {
  text: string;
  target: string;
  baseVersion: number;
  dirty: boolean;
};

export default function App({ api: suppliedApi }: { api?: Api }) {
  const [api, setApi] = useState(() => suppliedApi ?? createApi());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleError, setVehicleError] = useState("");
  const [vehicleRetry, setVehicleRetry] = useState(0);
  const [vehicleId, setVehicleId] = useState("g60-i5-m60");
  const [deepDive, setDeepDive] = useState(false);
  const [mode, setMode] = useState<"autonomous" | "guided">("autonomous");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Findings");
  const [selectedFindingId, setSelectedFindingId] =
    useState("finding-dashboard");
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentId>("dashboard");
  const [view, setView] = useState<VehicleView>("exterior");
  const [variantId, setVariantId] = useState("variant-digital");
  const [heatmap, setHeatmap] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [source, setSource] = useState<Evidence | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [exportJob, setExportJob] = useState<{
    export_id: string;
    proposal_set_version: number;
    status: string;
    download_url?: string;
  } | null>(null);
  const lock = useRef(false);
  const startAttempt = useRef<{ input: string; key: string } | null>(null);
  const proposalDrafts = useRef(new Map<string, ProposalDraft>());
  const scopeDrafts = useRef(new Map<string, string>());
  const [dirtyDrafts, setDirtyDrafts] = useState(new Set<string>());
  const [confirmNewRun, setConfirmNewRun] = useState(false);
  const [savedConfigExpanded, setSavedConfigExpanded] = useState(false);
  const [vehicleExpanded, setVehicleExpanded] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState("");
  const hasUnsavedWork = dirtyDrafts.size > 0 || !!ideaDraft.trim();
  const rememberDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyDrafts((old) => {
      if (old.has(key) === dirty) return old;
      const next = new Set(old);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedWork]);
  const run = workspace?.snapshot;
  const vehicle = vehicles.find(
    (v) => v.vehicle_id === (run?.config.vehicle_id ?? vehicleId),
  );
  const baselineAvailable =
    vehicle?.vehicle_id === sceneCatalog.vehicle_id &&
    vehicle.baseline_asset_id === sceneCatalog.baseline_asset_id &&
    vehicle.part_catalog_version === sceneCatalog.catalog_version;
  const finding =
    workspace?.findings.find((f) => f.finding_id === selectedFindingId) ??
    workspace?.findings[0];
  const variant =
    workspace?.proposals.variants.find((v) => v.variant_id === variantId) ??
    workspace?.proposals.variants[0];
  const version = workspace?.proposals.proposal_set_version ?? 0;
  const readySourceIds = [
    ...new Set(
      uploads.filter((u) => u.status === "ready").map((u) => u.source_id!),
    ),
  ];
  const uploadingCount = uploads.filter((u) => u.status === "uploading").length;
  const readyCount = uploads.filter((u) => u.status === "ready").length;
  const hasUploadErrors = uploads.some(
    (u) => u.status === "failed" || u.status === "rejected",
  );
  const startReadiness = runId
    ? "Run created. Reconnect to load its workspace; your saved settings and files are unchanged."
    : busy
      ? "Starting your run. Your files and settings are being saved."
      : vehicleError
        ? "Vehicle options unavailable. Retry loading vehicles to continue."
        : !vehicles.length
          ? "Loading vehicle options…"
          : !baselineAvailable
            ? "No baseline asset for this vehicle. Choose a vehicle with an available baseline."
            : uploadingCount
              ? `Uploading ${uploadingCount} ${uploadingCount === 1 ? "file" : "files"}. Wait for uploads to finish.`
              : readyCount
                ? `${readyCount} ${readyCount === 1 ? "file" : "files"} ready. Only ready files will be included.`
                : "Add at least one source file to start.";
  const can = (action: string) =>
    !busy && !!run?.available_actions.includes(action);

  useEffect(() => {
    let active = true;
    setVehicleError("");
    api
      .request<Page<Vehicle>>("/vehicles")
      .then((result) => {
        if (active) {
          setVehicles(result.items);
          if (!result.items.length)
            setVehicleError(
              "No vehicles available. Retry or contact your workspace administrator.",
            );
        }
      })
      .catch((e) => {
        if (active) setVehicleError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api, vehicleRetry]);

  const refresh = useCallback(
    async (id: string) => {
      const next = await api.workspace(id);
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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.workspace(runId!);
        if (!cancelled) {
          setWorkspace((old) =>
            old && old.snapshot.revision > next.snapshot.revision ? old : next,
          );
          setConnection("");
        }
      } catch {
        if (!cancelled)
          setConnection(
            "Connection interrupted. Retrying; your drafts remain here.",
          );
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, runId]);

  useEffect(() => {
    if (
      !runId ||
      !renderResult ||
      !["queued", "rendering"].includes(renderResult.status)
    )
      return;
    let cancelled = false;
    const timer = setInterval(() => {
      api
        .request<RenderResult>(
          `/runs/${runId}/renders/${encodeURIComponent(renderResult.render_request_id)}`,
        )
        .then((result) => {
          if (!cancelled) setRenderResult(result);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, runId, renderResult]);

  useEffect(() => {
    if (
      !runId ||
      !exportJob ||
      !["queued", "processing"].includes(exportJob.status)
    )
      return;
    let cancelled = false;
    const timer = setInterval(() => {
      api
        .request<{ export_id: string; status: string; download_url?: string }>(
          `/runs/${runId}/exports/${encodeURIComponent(exportJob.export_id)}`,
        )
        .then((result) => {
          if (!cancelled) setExportJob((old) => old && { ...old, ...result });
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, runId, exportJob]);

  async function act(action: () => Promise<void>) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed. Retry.");
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

  function selectFinding(next: Finding) {
    setSelectedFindingId(next.finding_id);
    if (next.part_ids[0]) {
      setSelectedComponent(next.part_ids[0]);
      setView(
        ["dashboard", "steering", "seats"].includes(next.part_ids[0])
          ? "interior"
          : "exterior",
      );
    }
  }
  function selectPart(id: ComponentId) {
    setSelectedComponent(id);
    const next = workspace?.findings.find((f) => f.part_ids.includes(id));
    setSelectedFindingId(next?.finding_id ?? `unreported-${id}`);
  }
  const selectedFinding = selectedFindingId.startsWith("unreported-")
    ? undefined
    : finding;

  async function submitInstruction(instruction: Instruction) {
    let savedVersion: number | null = null;
    await act(async () => {
      await api.request(
        `/runs/${runId}/instructions`,
        instruction,
        commandKey(),
      );
      savedVersion = (await refresh(runId!)).proposals.proposal_set_version;
    });
    return savedVersion;
  }

  const reset = () => {
    startAttempt.current = null;
    proposalDrafts.current.clear();
    scopeDrafts.current.clear();
    setDirtyDrafts(new Set());
    setConfirmNewRun(false);
    setSavedConfigExpanded(false);
    setVehicleExpanded(false);
    setTab("Findings");
    setIdeaDraft("");
    setWorkspace(null);
    setRunId(null);
    setUploads([]);
    setRenderResult(null);
    setExportJob(null);
    setSource(null);
    setError("");
    setConnection("");
    setDeepDive(false);
    setMode("autonomous");
    setSelectedFindingId("finding-dashboard");
    setVariantId("variant-digital");
    setApi(suppliedApi ?? createApi());
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
        <span className="environment">
          {api.mode === "mock" ? "Synthetic workspace" : "Connected workspace"}
        </span>
      </header>
      <main id="workspace">
        <section className="run-setup" aria-label="Run setup">
          <div className="section-title">
            <h1 tabIndex={-1}>
              {run ? "Saved configuration" : "New analysis run"}
            </h1>
            {run && (
              <button onClick={() => setConfirmNewRun(true)} disabled={busy}>
                <Plus size={16} />
                New run
              </button>
            )}
          </div>
          {!run && (
            <div className="setup-intro">
              <p>
                Choose a vehicle, add your source files, then start a run to
                review customer findings and proposals.
              </p>
              {api.mode === "mock" && (
                <p className="demo-notice">
                  Demo mode: uploaded contents are not analyzed. Runs use
                  synthetic findings and proposals.
                </p>
              )}
            </div>
          )}
          {run && (
            <div className="saved-config-summary">
              <span>
                {vehicle?.title} · {run.config.participation_mode}
                {run.config.deep_dive.enabled ? " · Deep Dive" : ""}
              </span>
              <button
                aria-expanded={savedConfigExpanded}
                aria-controls="saved-config-fields"
                onClick={() => setSavedConfigExpanded(!savedConfigExpanded)}
              >
                {savedConfigExpanded ? "Hide settings" : "Show settings"}
              </button>
            </div>
          )}
          <div
            id="saved-config-fields"
            className={
              run
                ? `saved-config-fields${savedConfigExpanded ? " is-expanded" : ""}`
                : undefined
            }
          >
            {!run && (
              <h2 className="setup-step">1. Choose vehicle and settings</h2>
            )}
            <div className="setup-fields">
              <label className="vehicle-field">
                Vehicle
                <select
                  aria-label="Vehicle"
                  value={run?.config.vehicle_id ?? vehicleId}
                  disabled={!!runId || busy}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  {vehicles.length ? (
                    vehicles.map((v) => (
                      <option key={v.vehicle_id} value={v.vehicle_id}>
                        {v.title}
                      </option>
                    ))
                  ) : (
                    <option value="g60-i5-m60">
                      {vehicleError
                        ? "Vehicle options unavailable"
                        : "Loading vehicles..."}
                    </option>
                  )}
                </select>
              </label>
              <fieldset
                disabled={!!runId || busy}
                aria-describedby={!run ? "participation-help" : undefined}
              >
                <legend>Participation</legend>
                <label>
                  <input
                    type="radio"
                    name="participation"
                    checked={
                      (run?.config.participation_mode ?? mode) === "autonomous"
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
                      (run?.config.participation_mode ?? mode) === "guided"
                    }
                    onChange={() => setMode("guided")}
                  />
                  Guided
                </label>
              </fieldset>
              <label className="check-field">
                <input
                  type="checkbox"
                  aria-describedby={!run ? "deep-dive-help" : undefined}
                  checked={run?.config.deep_dive.enabled ?? deepDive}
                  disabled={!!runId || busy}
                  onChange={(e) => setDeepDive(e.target.checked)}
                />
                Deep Dive
              </label>
            </div>
            {!run && (
              <>
                {vehicleError && (
                  <div className="vehicle-load-error">
                    <p role="alert">{vehicleError}</p>
                    <button
                      onClick={() => setVehicleRetry((value) => value + 1)}
                    >
                      Retry loading vehicles
                    </button>
                  </div>
                )}
                <div className="setup-help">
                  <p id="participation-help" className="muted">
                    {mode === "autonomous"
                      ? "Autonomous: completes proposals without intermediate choices."
                      : "Guided: pauses at checkpoints for your input."}
                  </p>
                  <p id="deep-dive-help" className="muted">
                    Deep Dive adds competitor research for identified customer
                    needs.
                  </p>
                </div>
                <h2 className="setup-step">2. Add source files</h2>
                <p id="upload-help" className="muted">
                  CSV, XLSX, XLS, PDF, TXT or DOCX. Add one or more files;
                  partial packages are welcome.
                </p>
                <div className="upload-zone">
                  <label className="upload-control">
                    <UploadIcon size={18} />
                    <span>Upload files</span>
                    <input
                      aria-label="Upload files"
                      aria-describedby="upload-help"
                      type="file"
                      multiple
                      disabled={busy || !!runId}
                      onChange={(e) => {
                        void uploadFiles(Array.from(e.target.files ?? []));
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <span className="muted">
                    Customer feedback, studies and vehicle reference documents
                  </span>
                </div>
              </>
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
                  {!run && (
                    <button
                      className="icon-button"
                      aria-label={`Remove ${row.filename}`}
                      title="Remove file"
                      disabled={row.status === "uploading" || busy || !!runId}
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
            {!baselineAvailable && vehicles.length > 0 && run && (
              <p className="notice">Baseline asset unavailable</p>
            )}
            {!run && (
              <>
                {hasUploadErrors && (
                  <p className="upload-error">
                    Remove failed or rejected files and choose them again to
                    retry. They will not be included in the run.
                  </p>
                )}
                <div className="start-run-action">
                  <div>
                    <h2 className="setup-step">3. Start your run</h2>
                    <p id="start-run-readiness" role="status">
                      {startReadiness}
                    </p>
                  </div>

                  <button
                    className="primary"
                    aria-describedby="start-run-readiness"
                    disabled={
                      busy ||
                      (!runId &&
                        (!baselineAvailable ||
                          !!vehicleError ||
                          !readySourceIds.length ||
                          uploadingCount > 0))
                    }
                    onClick={() =>
                      void act(async () => {
                        if (runId) {
                          await refresh(runId);
                          return;
                        }
                        const config = {
                          vehicle_id: vehicle!.vehicle_id,
                          baseline_asset_id: vehicle!.baseline_asset_id,
                          part_catalog_version: vehicle!.part_catalog_version,
                          source_ids: readySourceIds,
                          market_context: [],
                          participation_mode: mode,
                          deep_dive: { enabled: deepDive },
                        };
                        const input = JSON.stringify(config);
                        if (startAttempt.current?.input !== input) {
                          startAttempt.current = { input, key: commandKey() };
                        }
                        const result = await api.request<{ run_id: string }>(
                          "/runs",
                          config,
                          startAttempt.current.key,
                        );
                        setRunId(result.run_id);
                        await refresh(result.run_id);
                      })
                    }
                  >
                    {busy ? (
                      <LoaderCircle size={16} />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                    {busy
                      ? runId
                        ? "Connecting…"
                        : "Starting run…"
                      : runId
                        ? "Reconnect to run"
                        : "Start run"}
                  </button>
                </div>
              </>
            )}
          </div>
          {run && (
            <div className="run-progress" role="status">
              <span className="status">{run.analysis_status}</span>
              <strong>{run.stage}</strong>
              <span>{run.run_id}</span>
              {busy && <LoaderCircle size={16} className="spin" />}
              {run.analysis_status === "proposals_ready" && (
                <button
                  onClick={() => {
                    setTab("Proposals");
                    document.getElementById("tab-Proposals")?.focus();
                  }}
                >
                  Review proposals <ArrowRight size={16} />
                </button>
              )}
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
                })
              }
            >
              <RefreshCw size={15} />
              Reconnect
            </button>
          </div>
        )}
        {run && (
          <div
            className="reimagine-toolbar"
            role="group"
            aria-label="Reimagine target"
          >
            <div id="reimagine-context" className="reimagine-context">
              <span className="muted">Selected variant</span>
              <strong>{variant?.title ?? "No variant available"}</strong>
              <span>Saved proposal version {version}</span>
              {hasUnsavedWork && (
                <p className="muted">
                  Uses saved proposals; unsaved edits are excluded.
                </p>
              )}
            </div>
            <button
              className="primary"
              aria-describedby="reimagine-context"
              disabled={!can("reimagine") || !variant}
              onClick={() =>
                void act(async () => {
                  const job = await api.request<{
                    render_request_id: string;
                  }>(
                    `/runs/${runId}/renders`,
                    {
                      proposal_set_version: version,
                      variant_ids: [variant!.variant_id],
                      baseline_asset_id: run.config.baseline_asset_id,
                    },
                    commandKey(),
                  );
                  setRenderResult(
                    await api.request<RenderResult>(
                      `/runs/${runId}/renders/${encodeURIComponent(job.render_request_id)}`,
                    ),
                  );
                  await refresh(runId!);
                })
              }
            >
              <WandSparkles size={16} />
              Reimagine
            </button>
          </div>
        )}
        <div
          className={`work-area${tab === "Proposals" && workspace ? " is-reviewing" : ""}`}
        >
          <section
            className={`vehicle-column${run ? " has-run" : ""}${vehicleExpanded ? " is-expanded" : ""}`}
            aria-label="Vehicle workspace"
          >
            <div className="section-title">
              <h2>Baseline vehicle</h2>
              {run && (
                <button
                  className="mobile-vehicle-toggle"
                  aria-expanded={vehicleExpanded}
                  aria-controls="vehicle-content"
                  onClick={() => setVehicleExpanded(!vehicleExpanded)}
                >
                  {vehicleExpanded ? "Hide vehicle" : "Show vehicle"}
                </button>
              )}
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={heatmap}
                  onChange={(e) => setHeatmap(e.target.checked)}
                />
                Feedback tags
              </label>
            </div>
            <div id="vehicle-content" className="vehicle-content">
              {baselineAvailable ? (
                <Suspense
                  fallback={
                    <div className="empty-state">
                      Loading baseline vehicle...
                    </div>
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
              {run && (
                <div className="render-section">
                  <div className="section-title">
                    <h2>Visualization</h2>
                  </div>
                  {renderResult ? (
                    <>
                      <h3>
                        Render proposal version{" "}
                        {renderResult.proposal_set_version}
                      </h3>
                      <span className="status">{renderResult.status}</span>
                      {renderResult.proposal_set_version !== version && (
                        <p className="notice">
                          Older render. Current proposal version {version};
                          baseline remains selected.
                        </p>
                      )}
                      <p className="muted">Not validated or approved</p>
                      {renderResult.outcomes.map((o) => (
                        <p key={o.change_id}>
                          <strong>
                            {o.change_id}: {o.status}
                          </strong>
                          <br />
                          {o.reason}
                        </p>
                      ))}
                      {renderResult.proposal_set_version === version &&
                        renderResult.variant_ids.includes(
                          variant?.variant_id ?? "",
                        ) &&
                        renderResult.assets.map((asset) =>
                          safeUrl(asset.url) ? (
                            <a
                              key={asset.asset_id}
                              href={asset.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open variant asset {asset.asset_id}
                            </a>
                          ) : null,
                        )}
                    </>
                  ) : (
                    <p className="muted">
                      No render requested for this proposal set.
                    </p>
                  )}
                </div>
              )}
            </div>
            {run?.warnings.map((w) => (
              <p className="coverage-note" key={w}>
                {w}
              </p>
            ))}
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
              id={`panel-${tab}`}
              aria-labelledby={`tab-${tab}`}
            >
              {!workspace ? (
                <div className="empty-state">
                  <Network size={30} />
                  <h2>Vehicle evidence workspace</h2>
                  <p>
                    Findings and proposals will appear here after you start a
                    run. Add source files in the setup above to begin.
                  </p>
                </div>
              ) : (
                <>
                  {workspace.checkpoint && (
                    <section className="checkpoint">
                      <h3>{workspace.checkpoint.question}</h3>
                      {workspace.checkpoint.alternatives.map((a) => (
                        <div key={a.id}>
                          <strong>{a.title}</strong>
                          <p>{a.tradeoff}</p>
                          <button
                            disabled={!can("continue_checkpoint")}
                            onClick={() =>
                              void act(async () => {
                                await api.request(
                                  `/runs/${runId}/checkpoints/${workspace.checkpoint!.checkpoint_id}/continue`,
                                  {
                                    checkpoint_version:
                                      workspace.checkpoint!.version,
                                    selected_resolution: a.id,
                                  },
                                  commandKey(),
                                );
                                setVariantId(a.id);
                                await refresh(runId!);
                              })
                            }
                          >
                            <Check size={15} />
                            Choose approach
                          </button>
                        </div>
                      ))}
                    </section>
                  )}
                  {tab === "Findings" && (
                    <>
                      <div className="section-title">
                        <h2>Customer findings</h2>
                        <span className="muted">Feedback records</span>
                      </div>
                      <div className="finding-list">
                        {workspace.findings.map((f) => (
                          <button
                            className="finding-item"
                            key={f.finding_id}
                            aria-pressed={selectedFindingId === f.finding_id}
                            onClick={() => {
                              selectFinding(f);
                              setTab("Evidence");
                            }}
                          >
                            <span
                              className="feedback-dot"
                              style={
                                {
                                  "--intensity": f.counts.intensity_value,
                                } as CSSProperties
                              }
                            />
                            <span>
                              <strong>{f.title}</strong>
                              <small>{f.customer_need}</small>
                              <small>
                                {f.counts.negative_records} of{" "}
                                {f.counts.total_records} negative feedback
                                records{f.provisional ? " / provisional" : ""}
                                {f.counts.low_evidence ? " / low evidence" : ""}
                              </small>
                            </span>
                            <ArrowRight size={16} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {tab === "Graph" && (
                    <GraphPanel
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
                        <FindingDetails finding={selectedFinding} />
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
                        {run?.config.deep_dive.enabled && (
                          <section className="research-section">
                            <h3>Deep Dive</h3>
                            {workspace.research
                              .filter(
                                (r) =>
                                  r.finding_id === selectedFinding.finding_id,
                              )
                              .map((r) => (
                                <div key={r.research_id}>
                                  <span className="status">{r.status}</span>
                                  <p>
                                    {r.competitor_scope} / {r.as_of}
                                  </p>
                                  {r.claims.map((claim, i) => (
                                    <article className="evidence-card" key={i}>
                                      <strong>{claim.type}</strong>
                                      <p>{claim.text}</p>
                                      {claim.evidence_ids.map((id) => (
                                        <button
                                          key={id}
                                          onClick={() =>
                                            void act(async () =>
                                              setSource(
                                                await api.request<Evidence>(
                                                  `/runs/${runId}/evidence/${encodeURIComponent(id)}`,
                                                ),
                                              ),
                                            )
                                          }
                                        >
                                          <BookOpen size={14} />
                                          Open citation {id}
                                        </button>
                                      ))}
                                    </article>
                                  ))}
                                  <h4>Recommended improvement</h4>
                                  <p>{r.recommendation}</p>
                                  <h4>Alternatives and counterevidence</h4>
                                  {[
                                    ...r.candidate_approaches,
                                    ...r.counterevidence,
                                  ].map((text) => (
                                    <p key={text}>{text}</p>
                                  ))}
                                  {r.gaps.map((gap) => (
                                    <p className="notice" key={gap}>
                                      {gap}
                                    </p>
                                  ))}
                                </div>
                              ))}
                            {!workspace.research.some(
                              (r) =>
                                r.finding_id === selectedFinding.finding_id,
                            ) && (
                              <p className="muted">
                                No research bundle available for this finding.
                              </p>
                            )}
                          </section>
                        )}
                      </>
                    ) : (
                      <div className="empty-state">
                        No finding mapped to this part. Vehicle-wide findings
                        remain available in Findings.
                      </div>
                    ))}
                  {tab === "Proposals" && (
                    <>
                      <div className="section-title">
                        <h2>Proposal version {version}</h2>
                        <span className="status">{run?.analysis_status}</span>
                      </div>
                      <label className="stacked-label">
                        Variant
                        <select
                          value={variant?.variant_id ?? ""}
                          onChange={(e) => setVariantId(e.target.value)}
                        >
                          {workspace.proposals.variants.map((v) => (
                            <option key={v.variant_id} value={v.variant_id}>
                              {v.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {workspace.proposals.unresolved_conflicts.map((c) => (
                        <p className="notice" key={c}>
                          {c}
                        </p>
                      ))}
                      {variant && (
                        <>
                          <p>
                            <strong>Scope:</strong>{" "}
                            {variant.cohort_scope.join(", ")}
                          </p>
                          {variant.assumptions.map((text) => (
                            <p className="muted" key={text}>
                              {text}
                            </p>
                          ))}
                          <details>
                            <summary>Regroup variant scope</summary>
                            <ScopeEditor
                              key={variant.variant_id}
                              scope={variant.cohort_scope}
                              initialDraft={scopeDrafts.current.get(
                                variant.variant_id,
                              )}
                              rememberDraft={(draft, dirty) => {
                                scopeDrafts.current.set(
                                  variant.variant_id,
                                  draft,
                                );
                                rememberDirty(
                                  `scope:${variant.variant_id}`,
                                  dirty,
                                );
                              }}
                              disabled={!can("edit")}
                              onSave={(cohort_scope) =>
                                submitInstruction({
                                  operation: "regroup_variants",
                                  variant_id: variant.variant_id,
                                  base_proposal_set_version: version,
                                  fields: { cohort_scope },
                                })
                              }
                            />
                          </details>
                          {variant.changes.map((change, index) => (
                            <ProposalEditor
                              initialDraft={proposalDrafts.current.get(
                                variant.variant_id + ":" + change.change_id,
                              )}
                              rememberDraft={(draft) => {
                                proposalDrafts.current.set(
                                  variant.variant_id + ":" + change.change_id,
                                  draft,
                                );
                                rememberDirty(
                                  variant.variant_id + ":" + change.change_id,
                                  draft.dirty,
                                );
                              }}
                              key={variant.variant_id + ":" + change.change_id}
                              change={change}
                              number={index + 1}
                              version={version}
                              disabled={!can("edit")}
                              evidence={
                                <ProposalEvidence
                                  api={api}
                                  runId={runId!}
                                  change={change}
                                  finding={workspace.findings.find(
                                    (f) => f.finding_id === change.finding_id,
                                  )}
                                  onOpen={setSource}
                                />
                              }
                              onSave={async (
                                operation,
                                fields,
                                baseVersion,
                              ) => {
                                const saved = await submitInstruction({
                                  operation,
                                  change_id: change.change_id,
                                  variant_id: variant.variant_id,
                                  base_proposal_set_version: baseVersion,
                                  fields,
                                });
                                if (
                                  saved !== null &&
                                  operation === "remove_change"
                                ) {
                                  const key =
                                    variant.variant_id + ":" + change.change_id;
                                  proposalDrafts.current.delete(key);
                                  rememberDirty(key, false);
                                }
                                return saved;
                              }}
                            />
                          ))}
                          <AddProposal
                            idea={ideaDraft}
                            setIdea={setIdeaDraft}
                            disabled={!can("edit")}
                            onAdd={(after) =>
                              submitInstruction({
                                operation: "add_change",
                                variant_id: variant.variant_id,
                                base_proposal_set_version: version,
                                fields: { after },
                              })
                            }
                          />
                        </>
                      )}
                    </>
                  )}
                  {tab === "History" && (
                    <>
                      <div className="section-title">
                        <h2>Run history</h2>
                        <button
                          disabled={!can("export") || !variant}
                          onClick={() =>
                            void act(async () => {
                              const job = await api.request<{
                                export_id: string;
                              }>(
                                `/runs/${runId}/exports`,
                                {
                                  proposal_set_version: version,
                                  variant_ids: [variant!.variant_id],
                                  format: "json",
                                },
                                commandKey(),
                              );
                              setExportJob({
                                export_id: job.export_id,
                                proposal_set_version: version,
                                status: "queued",
                              });
                              const result = await api.request<{
                                export_id: string;
                                status: string;
                                download_url?: string;
                              }>(
                                `/runs/${runId}/exports/${encodeURIComponent(job.export_id)}`,
                              );
                              setExportJob({
                                ...result,
                                proposal_set_version: version,
                              });
                              await refresh(runId!);
                            })
                          }
                        >
                          <Download size={16} />
                          Request export
                        </button>
                      </div>
                      {exportJob && (
                        <p>
                          Export proposal version{" "}
                          {exportJob.proposal_set_version}: {exportJob.status}{" "}
                          {exportJob.status === "ready" &&
                            exportJob.download_url &&
                            safeUrl(
                              exportJob.download_url,
                              api.mode === "mock",
                            ) && (
                              <a
                                download="vehicle-requirements.json"
                                href={exportJob.download_url}
                              >
                                Download export
                              </a>
                            )}
                        </p>
                      )}
                      <ol className="audit-list">
                        {workspace.history.map((event) => (
                          <li key={event.event_id}>
                            <span>
                              {event.actor} / proposal v
                              {event.proposal_set_version}
                            </span>
                            <strong>{event.description}</strong>
                            <time dateTime={event.occurred_at}>
                              {new Date(event.occurred_at).toLocaleString()}
                            </time>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </main>
      {confirmNewRun && (
        <ConfirmDialog
          title="Start a new run?"
          description={`${hasUnsavedWork ? "You have unsaved edits that will be discarded. " : ""}${api.mode === "mock" ? "Starting a new run clears this synthetic run and its results." : "Starting a new run closes this workspace."} Export anything you need before continuing.`}
          confirmLabel="Start new run"
          onCancel={() => setConfirmNewRun(false)}
          onConfirm={() => {
            reset();
            return true;
          }}
        />
      )}
      {source && (
        <SourceDialog evidence={source} onClose={() => setSource(null)} />
      )}
    </div>
  );
}

function FindingDetails({ finding: f }: { finding: Finding }) {
  return (
    <section className="finding-detail">
      <h2>{f.title}</h2>
      <p>{f.customer_need}</p>
      <p>
        <strong>
          {f.counts.negative_records} of {f.counts.total_records} negative
          feedback records
        </strong>{" "}
        /{" "}
        {f.counts.negative_share === null
          ? "Unknown share"
          : `${f.counts.negative_share}% negative`}
      </p>
      <div className="tag-row">
        {f.provisional && <span className="status">Provisional</span>}
        {f.counts.low_evidence && <span className="status">Low evidence</span>}
        <span>{f.cohort_ids.join(", ")}</span>
      </div>
      <dl>
        <dt>Coverage</dt>
        <dd>{f.coverage}</dd>
        <dt>Baseline</dt>
        <dd>{f.baseline}</dd>
        <dt>Applicability</dt>
        <dd>{f.applicability}</dd>
      </dl>
    </section>
  );
}

function EvidenceList({
  api,
  runId,
  ids,
  title,
  onOpen,
}: {
  api: Api;
  runId: string;
  ids: string[];
  title: string;
  onOpen: (e: Evidence) => void;
}) {
  const [rows, setRows] = useState<Evidence[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const idKey = ids.join("|");
  useEffect(() => {
    let active = true;
    setRows([]);
    setError("");
    setLoading(ids.length > 0);
    Promise.all(
      ids.map((id) =>
        api.request<Evidence>(
          `/runs/${runId}/evidence/${encodeURIComponent(id)}`,
        ),
      ),
    )
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, runId, idKey, retry]);
  return (
    <section className="evidence-section">
      <h3>{title}</h3>
      {loading && (
        <p role="status" className="muted">
          Loading observations…
        </p>
      )}
      {error && (
        <div>
          <p role="alert">{error}</p>
          <button
            aria-label={`Retry ${title}`}
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry evidence
          </button>
        </div>
      )}
      {!ids.length && <p className="muted">No observations supplied.</p>}
      {rows.map((e) => (
        <article key={e.evidence_id} className="evidence-card">
          <strong>
            {e.source_kind === "uploaded"
              ? "Customer evidence"
              : "External evidence"}
          </strong>
          <blockquote>{e.excerpt}</blockquote>
          <p className="muted">
            {e.scope} / {e.locator.label}
          </p>
          <button onClick={() => onOpen(e)}>
            <BookOpen size={14} />
            Open source {e.evidence_id}
          </button>
        </article>
      ))}
    </section>
  );
}

function ProposalEvidence({
  api,
  runId,
  change,
  finding,
  onOpen,
}: {
  api: Api;
  runId: string;
  change: Change;
  finding?: Finding;
  onOpen: (e: Evidence) => void;
}) {
  if (change.origin === "pm" && !change.evidence_ids.length)
    return <p className="muted">No evidence linked to this PM idea.</p>;
  const supporting = finding?.supporting_evidence_ids ?? [];
  const opposing = finding?.opposing_evidence_ids ?? [];
  const otherLinked = change.evidence_ids.filter(
    (id) => !supporting.includes(id) && !opposing.includes(id),
  );
  return (
    <>
      {finding ? (
        <>
          <h4>{finding.title}</h4>
          <p>{finding.customer_need}</p>
          <p>
            <strong>
              {finding.counts.negative_records} of{" "}
              {finding.counts.total_records} negative feedback records
            </strong>
            {finding.provisional ? " / provisional" : ""}
            {finding.counts.low_evidence ? " / low evidence" : ""}
          </p>
          <p className="muted">
            {finding.cohort_ids.join(", ")} · {finding.coverage}
          </p>
          <p className="muted">{finding.applicability}</p>
          <EvidenceList
            api={api}
            runId={runId}
            ids={supporting}
            title="Supporting observations"
            onOpen={onOpen}
          />
          <EvidenceList
            api={api}
            runId={runId}
            ids={opposing}
            title="Opposing observations"
            onOpen={onOpen}
          />
        </>
      ) : (
        <p className="muted">No customer finding linked to this proposal.</p>
      )}
      {otherLinked.length > 0 && (
        <EvidenceList
          api={api}
          runId={runId}
          ids={otherLinked}
          title="Linked proposal evidence"
          onOpen={onOpen}
        />
      )}
    </>
  );
}

function GraphPanel({
  workspace,
  onSelect,
}: {
  workspace: Workspace;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const nodes = workspace.graph.nodes.filter(
    (n) => filter === "all" || n.entity_type === filter,
  );
  return (
    <>
      <div className="section-title">
        <h2>Evidence graph</h2>
        <label>
          Node type
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option>
            {[...new Set(workspace.graph.nodes.map((n) => n.entity_type))].map(
              (type) => (
                <option key={type}>{type}</option>
              ),
            )}
          </select>
        </label>
      </div>
      <div className="graph-nodes">
        {nodes.map((node) => (
          <button
            key={node.node_id}
            className={`graph-node node-${node.entity_type}`}
            onClick={() => onSelect(node.finding_id)}
          >
            <small>{node.entity_type}</small>
            <strong>{node.label}</strong>
          </button>
        ))}
      </div>
      <ul className="graph-edges">
        {workspace.graph.edges
          .filter((edge) =>
            nodes.some(
              (n) => n.node_id === edge.from_id || n.node_id === edge.to_id,
            ),
          )
          .map((edge) => (
            <li key={edge.edge_id}>
              <span>
                {workspace.graph.nodes.find((n) => n.node_id === edge.from_id)
                  ?.label ?? edge.from_id}
              </span>
              <span>
                <ArrowRight size={14} />
                {edge.relationship}
              </span>
              <span>
                {workspace.graph.nodes.find((n) => n.node_id === edge.to_id)
                  ?.label ?? edge.to_id}
              </span>
            </li>
          ))}
      </ul>
    </>
  );
}

function ProposalEditor({
  change,
  number,
  version,
  disabled,
  onSave,
  evidence,
  initialDraft,
  rememberDraft,
}: {
  change: Change;
  number: number;
  version: number;
  disabled: boolean;
  onSave: (
    operation: Instruction["operation"],
    fields: Instruction["fields"],
    baseVersion: number,
  ) => Promise<number | null>;
  evidence: ReactNode;
  initialDraft?: ProposalDraft;
  rememberDraft: (draft: ProposalDraft) => void;
}) {
  const [text, setText] = useState(initialDraft?.text ?? change.after);
  const [target, setTarget] = useState(initialDraft?.target ?? change.target);
  const [baseVersion, setBaseVersion] = useState(
    initialDraft?.baseVersion ?? version,
  );
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [showEvidence, setShowEvidence] = useState(true);
  useEffect(() => {
    rememberDraft({
      text,
      target,
      baseVersion,
      dirty: text !== change.after || target !== change.target,
    });
  }, [text, target, baseVersion, change.after, change.target, rememberDraft]);
  const stale = version !== baseVersion;
  async function save(
    operation: Instruction["operation"],
    fields: Instruction["fields"],
  ) {
    const saved = await onSave(operation, fields, baseVersion);
    if (saved !== null) setBaseVersion(saved);
    return saved !== null;
  }
  return (
    <article className="proposal-item">
      <h3>
        <span className="change-number">{number}</span>
        {change.origin === "pm" ? "PM idea" : "AI proposal"}{" "}
        <small>{change.decision_state}</small>
      </h3>
      <div
        className={`proposal-review${showEvidence ? "" : " is-evidence-hidden"}`}
      >
        <div className="proposal-editor">
          <p>
            <strong>Before:</strong> {change.before}
          </p>
          <p>{change.rationale}</p>
          <label className="stacked-label">
            Proposal text
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={disabled}
            />
          </label>
          <label className="stacked-label">
            Target
            <textarea
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={disabled}
            />
          </label>
          <p className="muted">Target maturity: {change.target_maturity}</p>
          {change.assumptions.map((a) => (
            <p className="muted" key={a}>
              {a}
            </p>
          ))}
          {stale && (
            <div className="notice">
              <strong>
                Draft based on version {baseVersion}; current version {version}.
              </strong>
              <p>Current proposal: {change.after}</p>
              <button onClick={() => setBaseVersion(version)}>
                <RefreshCw size={15} />
                Use current version with my draft
              </button>
            </div>
          )}
          <div className="action-row">
            <button
              disabled={disabled || stale || !text.trim()}
              onClick={() => void save("edit_change", { after: text })}
            >
              <Save size={15} />
              Save edit
            </button>
            <button
              disabled={disabled || stale || !target.trim()}
              onClick={() => void save("edit_target", { target })}
            >
              <Save size={15} />
              Save target
            </button>
            <button
              aria-expanded={showEvidence}
              aria-controls={`proposal-evidence-${change.change_id}`}
              onClick={() => setShowEvidence(!showEvidence)}
            >
              <BookOpen size={15} />
              {showEvidence ? "Hide evidence" : "View evidence"}
            </button>
            <button
              className="icon-button"
              aria-label={`Remove change ${number}`}
              title="Remove change"
              disabled={disabled || stale}
              onClick={() => setConfirmRemoval(true)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <section
          id={`proposal-evidence-${change.change_id}`}
          className="proposal-evidence"
          aria-label={`Evidence for proposal ${number}`}
          hidden={!showEvidence}
        >
          <h3>Evidence</h3>
          {evidence}
        </section>
      </div>
      {confirmRemoval && (
        <ConfirmDialog
          title="Remove proposal?"
          description="This removes this proposal from the selected variant, including its unsaved edits. Removal cannot be undone here. Customer evidence stays unchanged."
          confirmLabel="Remove proposal"
          disabled={disabled || stale}
          onCancel={() => setConfirmRemoval(false)}
          onConfirm={() => save("remove_change", {})}
        />
      )}
    </article>
  );
}

function AddProposal({
  disabled,
  onAdd,
  idea,
  setIdea,
}: {
  disabled: boolean;
  onAdd: (after: string) => Promise<number | null>;
  idea: string;
  setIdea: (idea: string) => void;
}) {
  return (
    <section className="add-proposal">
      <h3>Add PM idea</h3>
      <label className="stacked-label">
        PM instruction
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          disabled={disabled}
        />
      </label>
      <button
        disabled={disabled || !idea.trim()}
        onClick={async () => {
          if ((await onAdd(idea)) !== null) setIdea("");
        }}
      >
        <Plus size={16} />
        Add proposal
      </button>
    </section>
  );
}

function ScopeEditor({
  scope,
  initialDraft,
  rememberDraft,
  disabled,
  onSave,
}: {
  scope: string[];
  initialDraft?: string;
  rememberDraft: (draft: string, dirty: boolean) => void;
  disabled: boolean;
  onSave: (scope: string[]) => Promise<number | null>;
}) {
  const [draft, setDraft] = useState(initialDraft ?? scope.join(", "));
  const currentScope = scope.join(", ");
  useEffect(() => {
    rememberDraft(draft, draft !== currentScope);
  }, [draft, currentScope, rememberDraft]);
  return (
    <div className="scope-editor">
      <label className="stacked-label">
        Cohort scope
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
        />
      </label>
      <button
        disabled={disabled || !draft.trim()}
        onClick={async () => {
          const next = draft
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if ((await onSave(next)) !== null) setDraft(next.join(", "));
        }}
      >
        <Save size={15} />
        Save grouping
      </button>
      <p className="muted">
        Scope changes require recomputation; overlapping cohorts are not added
        together.
      </p>
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  disabled = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => boolean | Promise<boolean>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (ref.current?.showModal) ref.current.showModal();
    else ref.current?.setAttribute("open", "");
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLHeadingElement>("main h1")?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (!pending) onCancel();
        }
      }}
    >
      <h2>{title}</h2>
      <p>{description}</p>
      {failed && (
        <p role="alert">
          Removal failed. Proposal and draft kept. Close this dialog to review
          the error, then retry.
        </p>
      )}
      <div className="action-row">
        <button disabled={pending} onClick={onCancel}>
          Keep working
        </button>
        <button
          className="primary"
          disabled={disabled || pending}
          onClick={async () => {
            setPending(true);
            setFailed(false);
            try {
              if (!(await onConfirm())) setFailed(true);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Working…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

function SourceDialog({
  evidence,
  onClose,
}: {
  evidence: Evidence;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (ref.current?.showModal) ref.current.showModal();
    else ref.current?.setAttribute("open", "");
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label="Source reference"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="section-title">
        <h2>Source reference</h2>
        <button
          className="icon-button"
          aria-label="Close source"
          title="Close source"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p>{evidence.source_version_id}</p>
      <p>{evidence.locator.label}</p>
      <blockquote>{evidence.excerpt}</blockquote>
      <p>{evidence.limitations}</p>
      {evidence.source_url && safeUrl(evidence.source_url) ? (
        <a href={evidence.source_url} target="_blank" rel="noreferrer">
          Open original source
        </a>
      ) : (
        <p className="muted">
          Original file link unavailable; exact source locator retained.
        </p>
      )}
    </dialog>
  );
}

function safeUrl(value: string, allowBlob = false) {
  try {
    const url = new URL(value, window.location.href);
    return (
      ["http:", "https:"].includes(url.protocol) ||
      (allowBlob && url.protocol === "blob:")
    );
  } catch {
    return false;
  }
}
