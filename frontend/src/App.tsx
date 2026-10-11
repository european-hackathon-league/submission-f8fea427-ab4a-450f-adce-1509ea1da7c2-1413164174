import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  GitBranch,
  History,
  Network,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { ApiError, commandKey, createApi, createMockApi, createRealApi } from "./api/client";
import ApiAccess from "./ApiAccess";
import WorkshopSummary, {
  FeedbackOverview,
  EvidenceOverview,
  SuggestionReview,
} from "./components/WorkshopSummary";
import GraphPanel from "./components/GraphPanel";
import SourceDialog from "./components/SourceDialog";
import ResearchPanel from "./components/ResearchPanel";
import ConflictPanel from "./components/ConflictPanel";
import ProposalWorkspace from "./components/ProposalWorkspace";
import HistoryPanel from "./components/HistoryPanel";
import RenderPanel from "./components/RenderPanel";
import WorkspaceGeometry from "./viewer/WorkspaceGeometry";
import ChangeExplanation from "./components/ChangeExplanation";
import SceneCapabilities from "./components/SceneCapabilities";
import AcceptanceEnvironment from "./components/AcceptanceEnvironment";
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
import { models } from "./collection/journeyData.js";
import sceneCatalog from "../public/vehicles/scene-catalog-v1.json";
import "./ui/workspace.css";
import "./ui/workshop.css";

const CollectionViewer = lazy(() => import("./collection/VehicleViewer.jsx"));
const VehicleViewer = lazy(() => import("./viewer/BmwAssetViewer"));
const tabs = [
  { title: "Findings", icon: BookOpen },
  { title: "Graph", icon: Network },
  { title: "Evidence", icon: BookOpen },
  { title: "Proposals", icon: GitBranch },
  { title: "History", icon: History },
  { title: "Research", icon: BookOpen },
  { title: "Conflicts", icon: GitBranch },
  { title: "Renders", icon: BookOpen },
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
  const fields = error.field_errors
    .map((field) =>
      Object.entries(field)
        .map(([name, value]) => `${name}: ${value}`)
        .join(" · "),
    )
    .join("; ");
  return [
    error.message,
    fields,
    error.requestId ? `Request ID: ${error.requestId}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
}
const spatialPartIds = new Set<string>([
  "body",
  "lighting",
  "charging",
  "steering",
  "dashboard",
  "seats",
]);
type ProposalDraft = {
  text: string;
  target: string;
  baseVersion: number;
  dirty: boolean;
};

type CollectionModel = {
  id: string;
  name: string;
  family: string;
  trim: string;
};
function collectionVehicleId(model?: CollectionModel | null) {
  if (!model) return "g60-i5-m60";
  if (model.id === "G60-i5-M60-xDrive") return "g60-i5-m60";
  return model.family === "G60"
    ? model.id.toLowerCase()
    : model.family.toLowerCase();
}
export default function App({
  api: suppliedApi,
  initialModel,
  onBack,
}: {
  api?: Api;
  initialModel?: CollectionModel | null;
  onBack?: () => void;
}) {
  const [connectedApi, setConnectedApi] = useState<Api | null>(
    suppliedApi ??
      (import.meta.env.VITE_API_MODE === "mock" ? createApi() : null),
  );
  if (!connectedApi)
    return (
      <>
        <AcceptanceEnvironment />
        {onBack && <button onClick={onBack}>Back to the BMW journey</button>}
        <ApiAccess
          baseUrl={import.meta.env.VITE_API_BASE_URL || "/api/v1"}
          onConnect={(base, headers, sessionNamespace) =>
            setConnectedApi(
              createRealApi(base, { headers: () => headers, sessionNamespace }),
            )
          }
        />
      </>
    );
  return (
    <>
      <AcceptanceEnvironment />
      <WorkspaceApp
        key={connectedApi.sessionNamespace ?? connectedApi.mode}
        api={connectedApi}
        initialModel={initialModel}
        onBack={onBack}
        onDisconnect={
          connectedApi.mode === "real" && !suppliedApi
            ? () => setConnectedApi(null)
            : undefined
        }
      />
    </>
  );
}

function WorkspaceApp({
  api: suppliedApi,
  onDisconnect,
  initialModel,
  onBack,
}: {
  api: Api;
  initialModel?: CollectionModel | null;
  onBack?: () => void;
  onDisconnect?: () => void;
}) {
  const [api, setApi] = useState(() => suppliedApi ?? createApi());
  const sessionNamespace =
    api.sessionNamespace ??
    `real:${import.meta.env.VITE_API_BASE_URL || "/api/v1"}`;
  const [restored] = useState(() =>
    api.mode === "real" ? readSession(sessionNamespace) : null,
  );
  const [pendingRun, setPendingRun] = useState<PendingRun | null>(
    restored?.pendingRun ?? null,
  );
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [vehicleError, setVehicleError] = useState("");
  const [vehicleRetry, setVehicleRetry] = useState(0);
  const [vehicleId, setVehicleId] = useState(() =>
    collectionVehicleId(initialModel),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [reviewChange, setReviewChange] = useState<{
    variantId: string;
    changeId: string;
    displayedWorkspace: Workspace;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [collectionViewerOpen, setCollectionViewerOpen] = useState(false);
  const [deepDive, setDeepDive] = useState(false);
  const [mode, setMode] = useState<"autonomous" | "guided">("autonomous");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [runId, setRunId] = useState<string | null>(restored?.runId ?? null);
  const activeRunId = useRef(runId);
  const runEpoch = useRef(0);
  const [tab, setTab] = useState<Tab>(
    tabs.some((t) => t.title === restored?.tab)
      ? (restored!.tab as Tab)
      : "Proposals",
  );
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    restored ? restored.selectedFindingId : "",
  );
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentId | null>(
      spatialPartIds.has(restored?.selectedComponent ?? "") &&
        sceneCatalog.parts.some(
          (p) => p.part_id === restored?.selectedComponent,
        )
        ? (restored!.selectedComponent as ComponentId)
        : null,
    );
  const [view, setView] = useState<VehicleView>(
    restored?.view === "interior" ? "interior" : "exterior",
  );
  const [variantId, setVariantId] = useState(restored?.variantId ?? "");
  const [proposalSelection, setProposalSelection] =
    useState<ProposalSelection | null>(restored?.proposalSelection ?? null);
  const [heatmap, setHeatmap] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [findingFocusRequest, setFindingFocusRequest] = useState(0);
  const [reimagineRequest, setReimagineRequest] = useState(0);
  const [source, setSource] = useState<Evidence | null>(null);
  const lock = useRef(false);
  const proposalDrafts = useRef(
    new Map<string, ProposalDraft>(
      (restored?.proposalDrafts ?? []).map(([key, draft]) => [
        key,
        { ...draft, dirty: true },
      ]),
    ),
  );
  const [dirtyDrafts, setDirtyDrafts] = useState(
    new Set<string>((restored?.proposalDrafts ?? []).map(([key]) => key)),
  );
  const [confirmNewRun, setConfirmNewRun] = useState(false);
  const [ideaDraft, setIdeaDraft] = useState(restored?.ideaDraft ?? "");
  const [proposalDirty, setProposalDirty] = useState<boolean | null>(null);
  const hasUnsavedWork =
    proposalDirty ?? (dirtyDrafts.size > 0 || !!ideaDraft.trim());

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
  const savedConfig = run?.config ?? pendingRun?.config;
  const vehicle = vehicles.find(
    (v) => v.vehicle_id === (savedConfig?.vehicle_id ?? vehicleId),
  );
  const baselineAvailable =
    vehicle?.vehicle_id === sceneCatalog.vehicle_id &&
    (savedConfig?.baseline_asset_id ?? vehicle.baseline_asset_id) ===
      sceneCatalog.baseline_asset_id &&
    (savedConfig?.part_catalog_version ?? vehicle.part_catalog_version) ===
      sceneCatalog.part_catalog_version;
  const configurationAvailable =
    !!vehicle?.baseline_asset_id && !!vehicle.part_catalog_version;
  const setupLocked = !!runId || !!pendingRun;
  useEffect(() => {
    if (initialModel && !setupLocked)
      setVehicleId(collectionVehicleId(initialModel));
  }, [initialModel, setupLocked]);
  const previewModel = models.find(
    (model) =>
      collectionVehicleId(model) === (savedConfig?.vehicle_id ?? vehicleId),
  );
  const finding =
    selectedFindingId === null
      ? undefined
      : selectedFindingId
        ? workspace?.findings.find((f) => f.finding_id === selectedFindingId)
        : workspace?.findings[0];
  const variant = variantId
    ? workspace?.proposals.variants.find((v) => v.variant_id === variantId)
    : workspace?.proposals.variants[0];
  const activeVariantId = variant?.variant_id ?? variantId;
  useEffect(() => {
    if (!variantId && workspace?.proposals.variants[0])
      setVariantId(workspace.proposals.variants[0].variant_id);
    if (selectedFindingId === "" && workspace?.findings[0])
      setSelectedFindingId(workspace.findings[0].finding_id);
  }, [workspace, variantId, selectedFindingId]);
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
          : !configurationAvailable
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
    setCatalogReady(false);
    setVehicleError("");
    (api.vehicles
      ? api.vehicles()
      : api.request<Page<Vehicle>>("/vehicles").then((page) => page.items)
    )
      .then((result) => {
        if (active) {
          setVehicles(result);
          setCatalogReady(true);
          setVehicleId((current) =>
            initialModel || result.some((v) => v.vehicle_id === current)
              ? current
              : (result[0]?.vehicle_id ?? current),
          );
          if (!result.length)
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
    void recoverRun(
      api,
      runId,
      {
        workspace: (next) =>
          setWorkspace((old) =>
            old?.snapshot.run_id === runId &&
            old.snapshot.revision > next.snapshot.revision
              ? old
              : next,
          ),
        status: setConnection,
      },
      controller.signal,
    );
    return () => controller.abort();
  }, [api, runId, recoveryAttempt]);

  const persistSession = useCallback(() => {
    if (api.mode !== "real") return;
    saveSession(sessionNamespace, {
      pendingRun,
      runId,
      tab,
      selectedFindingId,
      selectedComponent: selectedComponent ?? "",
      view,
      variantId,
      proposalSelection,
      ideaDraft,
      proposalDrafts: [...proposalDrafts.current],
    });
  }, [
    api.mode,
    sessionNamespace,
    pendingRun,
    runId,
    tab,
    selectedFindingId,
    selectedComponent,
    view,
    variantId,
    proposalSelection,
    ideaDraft,
  ]);
  useEffect(persistSession, [persistSession]);
  useEffect(() => {
    window.addEventListener("pagehide", persistSession);
    return () => {
      persistSession();
      window.removeEventListener("pagehide", persistSession);
    };
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
        result = await api.request<{ run_id: string }>(
          "/runs",
          command.config,
          command.key,
        );
      } catch (error) {
        if (
          error instanceof ApiError &&
          !error.retryable &&
          error.status !== null &&
          error.status < 500
        )
          setPendingRun(null);
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
    setFindingFocusRequest((old) => old + 1);
    setSelectedFindingId(next.finding_id);
    const mapped =
      baselineAvailable &&
      next.part_ids.find(
        (id) =>
          spatialPartIds.has(id) &&
          sceneCatalog.parts.some(
            (part) =>
              part.part_id === id &&
              part.capabilities.some(
                (c) => c === "list_annotation" || c === "photo_annotation",
              ),
          ),
      );
    setSelectedComponent(mapped || null);
  }

  function selectPart(id: ComponentId) {
    setProposalSelection(null);
    setTab("Evidence");
    setSelectedComponent(id);
    const matches =
      workspace?.findings.filter((f) => f.part_ids.includes(id)) ?? [];
    const existing = matches.find((f) => f.finding_id === selectedFindingId);
    setSelectedFindingId(
      existing?.finding_id ??
        (matches.length === 1 ? matches[0].finding_id : null),
    );
    const linked =
      workspace &&
      [...workspace.proposals.variants]
        .sort(
          (a, b) =>
            Number(b.variant_id === activeVariantId) -
            Number(a.variant_id === activeVariantId),
        )
        .flatMap((v) => v.changes.map((c) => ({ v, c })))
        .find(({ c }) => c.part_ids.includes(id));
    if (linked) {
      setVariantId(linked.v.variant_id);
      setReviewChange({
        variantId: linked.v.variant_id,
        changeId: linked.c.change_id,
        displayedWorkspace: workspace!,
      });
      setTab("Proposals");
    } else if (matches.length > 1 && !existing) setTab("Findings");
  }
  const selectedFinding = finding;

  useEffect(() => {
    if (findingFocusRequest && tab === "Evidence")
      document.getElementById("panel-Evidence")?.focus();
  }, [findingFocusRequest, tab]);
  useEffect(() => {
    if (!catalogReady || (runId && !workspace)) return;
    if (
      selectedComponent &&
      (!baselineAvailable ||
        (selectedFindingId && !finding?.part_ids.includes(selectedComponent)))
    )
      setSelectedComponent(null);
  }, [
    catalogReady,
    runId,
    workspace,
    baselineAvailable,
    finding,
    selectedFindingId,
    selectedComponent,
  ]);

  const reset = () => {
    activeRunId.current = null;
    runEpoch.current++;
    clearSession(sessionNamespace);
    proposalDrafts.current.clear();
    setDirtyDrafts(new Set());
    setProposalDirty(null);
    setConfirmNewRun(false);
    setTab("Proposals");
    setReviewChange(null);
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
    if (api.mode === "mock") {
      api.dispose?.();
      setApi(createMockApi(import.meta.env.VITE_MOCK_SCENARIO));
    }
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
        {onBack && <button onClick={onBack}>Back to the BMW journey</button>}
        {previewModel && (
          <button onClick={() => setCollectionViewerOpen(true)}>
            Explore model in 360°
          </button>
        )}
        {initialModel && (
          <span className="collection-context">
            Collection: {initialModel.name}
          </span>
        )}
        {onDisconnect && (
          <button
            onClick={() => {
              persistSession();
              onDisconnect();
            }}
          >
            Change API access
          </button>
        )}
        <span className="environment">
          {api.mode === "mock" ? "Synthetic workspace" : "Connected workspace"}
        </span>
      </header>
      {collectionViewerOpen && previewModel && (
        <Suspense fallback={<p role="status">Preparing model viewer…</p>}>
          <CollectionViewer
            initial={previewModel.id}
            onClose={() => setCollectionViewerOpen(false)}
          />
        </Suspense>
      )}
      <main id="workspace">
        <section className="run-setup" aria-label="Run setup">
          <div className="section-title">
            <h1 tabIndex={-1}>Workshop</h1>
            {setupLocked && (
              <button
                disabled={busy}
                onClick={(event) => {
                  event.currentTarget.focus();
                  setConfirmNewRun(true);
                }}
              >
                <Plus size={16} />
                New run
              </button>
            )}
          </div>
          {workspace && (
            <div className="workshop-summary">
              <span>
                <b>{workspace.findings.length}</b> customer needs
              </span>
              <span>
                <b>{variant?.changes.length ?? 0}</b> suggested{" "}
                {variant?.changes.length === 1 ? "change" : "changes"}
              </span>
              <span>
                <b>
                  {variant?.changes.filter(
                    (c) => c.decision_state === "proposed",
                  ).length ?? 0}
                </b>{" "}
                awaiting decision
              </span>
            </div>
          )}

          <div className="setup-fields">
            <label className="vehicle-field">
              Vehicle
              <select
                aria-label="Vehicle"
                value={savedConfig?.vehicle_id ?? vehicleId}
                disabled={setupLocked || busy}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                {initialModel &&
                  vehicles.length > 0 &&
                  !vehicles.some((v) => v.vehicle_id === vehicleId) && (
                    <option value={vehicleId}>
                      {initialModel.name} · Analysis unavailable
                    </option>
                  )}
                {vehicles.length ? (
                  vehicles.map((v) => (
                    <option key={v.vehicle_id} value={v.vehicle_id}>
                      {v.title}
                    </option>
                  ))
                ) : (
                  <option value={vehicleId}>
                    {vehicleError
                      ? "Vehicle options unavailable"
                      : "Loading vehicles…"}
                  </option>
                )}
              </select>
            </label>
            <label className="workshop-switch">
              Autonomous
              <input
                role="switch"
                type="checkbox"
                checked={
                  (savedConfig?.participation_mode ?? mode) === "autonomous"
                }
                disabled={setupLocked || busy}
                onChange={(e) =>
                  setMode(e.target.checked ? "autonomous" : "guided")
                }
              />
              <span className="switch-track" />
            </label>
            <label className="workshop-switch">
              Deep Dive
              <input
                role="switch"
                type="checkbox"
                checked={savedConfig?.deep_dive.enabled ?? deepDive}
                disabled={setupLocked || busy}
                onChange={(e) => setDeepDive(e.target.checked)}
              />
              <span className="switch-track" />
            </label>
            {!run && (
              <>
                <input
                  ref={fileInput}
                  className="sr-only"
                  aria-label="Upload files"
                  type="file"
                  accept=".xlsx,.pdf"
                  multiple
                  disabled={setupLocked || busy}
                  onChange={(e) => {
                    void uploadFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                {!runId && (
                  <button
                    className="primary"
                    aria-describedby="start-run-readiness"
                    disabled={
                      busy ||
                      setupLocked ||
                      !!pendingRun ||
                      uploadingCount > 0 ||
                      !configurationAvailable ||
                      !!vehicleError
                    }
                    onClick={() => {
                      if (!readySourceIds.length) {
                        fileInput.current?.click();
                        return;
                      }
                      void createRun({
                        vehicle_id: vehicle!.vehicle_id,
                        baseline_asset_id: vehicle!.baseline_asset_id!,
                        part_catalog_version: vehicle!.part_catalog_version!,
                        source_ids: readySourceIds,
                        market_context: [],
                        participation_mode: mode,
                        deep_dive: { enabled: deepDive },
                      });
                    }}
                  >
                    {busy || uploadingCount
                      ? "Working…"
                      : readySourceIds.length
                        ? "Start analysis"
                        : "Add files"}
                  </button>
                )}
              </>
            )}
          </div>
          {!run && (
            <p className="sr-only" id="start-run-readiness" role="status">
              {startReadiness}
            </p>
          )}
          {runId && !run && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await refresh(runId!);
                })
              }
            >
              Reconnect to run
            </button>
          )}
          {vehicleError && (
            <div role="alert">
              {vehicleError}
              <button onClick={() => setVehicleRetry((v) => v + 1)}>
                Retry loading vehicles
              </button>
            </div>
          )}
          {hasUploadErrors && (
            <p className="upload-error">
              Remove failed or rejected files and choose them again to retry.
              They will not be included in the run.
            </p>
          )}
          {!!uploads.length && (
            <details
              className="source-package"
              open={!readySourceIds.length || hasUploadErrors}
            >
              <summary>
                {uploads.length} {uploads.length === 1 ? "file" : "files"}{" "}
                <span className="muted">
                  {uploadingCount ? "· Uploading" : "· Manage"}
                </span>
              </summary>
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
                        disabled={
                          row.status === "uploading" || busy || setupLocked
                        }
                        onClick={() =>
                          setUploads((old) =>
                            old.filter((u) => u.id !== row.id),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {!setupLocked && (
                <button onClick={() => fileInput.current?.click()}>
                  Add more files
                </button>
              )}
            </details>
          )}
          {pendingRun && !runId && (
            <div role="status" className="notice">
              Run creation pending. Settings frozen.
              <button disabled={busy} onClick={() => void createRun()}>
                Retry run creation
              </button>
            </div>
          )}
          {run && (
            <details className="run-details">
              <summary>
                Analysis details{" "}
                <span className="status">
                  {run.analysis_status.replaceAll("_", " ")}
                </span>
              </summary>
              <dl>
                <dt>Completed source IDs</dt>
                <dd>{run.config.source_ids.join(", ")}</dd>
                <dt>Baseline asset</dt>
                <dd>{run.config.baseline_asset_id}</dd>
                <dt>Part catalog</dt>
                <dd>{run.config.part_catalog_version}</dd>
                <dt>Market context</dt>
                <dd>
                  {run.config.market_context.join(", ") ||
                    "From source evidence"}
                </dd>
              </dl>
              <p>{run.run_id}</p>
              <p>{run.stage}</p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await refresh(runId!);
                  })
                }
              >
                Reconnect to run
              </button>
            </details>
          )}
          {runId && !run && <p role="status">Recovering saved analysis…</p>}
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
                  setRecoveryAttempt((old) => old + 1);
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
            className="variant-context"
            role="group"
            aria-label="Reimagine target"
          >
            <strong>{variant?.title ?? "Variant unavailable"}</strong>
            <span>
              Saved proposal version {workspace?.proposals.proposal_set_version}
            </span>
          </div>
        )}
        <div className="work-area">
          <section
            className={`vehicle-column${run ? " has-run" : ""}`}
            aria-label="Vehicle workspace"
          >
            <div className="section-title">
              <h2>{vehicle?.title ?? "Vehicle reference"}</h2>
              {workspace && <button className="primary" disabled={busy || hasUnsavedWork || !workspace.snapshot.available_actions.includes("reimagine")} onClick={() => { setTab("Renders"); setReimagineRequest(value => value + 1); }}>Reimagine saved suggestions</button>}
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
              {hasUnsavedWork && <p className="notice">Save or discard unsaved edits before Reimagine.</p>}
              {baselineAvailable || workspace?.snapshot.resource_links?.geometry ? (
                <Suspense
                  fallback={
                    <div className="empty-state">
                      Loading baseline vehicle...
                    </div>
                  }
                >
                  <WorkspaceGeometry key={JSON.stringify([api.sessionNamespace ?? api.mode, workspace?.snapshot.run_id])} api={api} workspace={workspace} tags={heatmap} onSelect={selectPart} onFinding={id => { const finding = workspace?.findings.find(item => item.finding_id === id); if (finding) { setReviewChange(null); selectFinding(finding); setTab("Evidence"); } }}>
                  {baselineAvailable ? <VehicleViewer
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
                  /> : <p>Loading verified editable baseline…</p>}
                  </WorkspaceGeometry>
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
            </div>
            <details className="vehicle-reference-details">
              <summary>Vehicle details</summary>
              <p>
                Reference-view tags mark approximate cabin regions. Editable-model
                tags use verified geometry mappings.
              </p>
              <SceneCapabilities
                vehicle={vehicle}
                config={
                  savedConfig ?? {
                    vehicle_id: vehicleId,
                    baseline_asset_id: vehicle?.baseline_asset_id ?? "",
                    part_catalog_version: vehicle?.part_catalog_version ?? "",
                  }
                }
              />
              {run?.warnings.map((w) => (
                <p className="coverage-note" key={w}>
                  {w}
                </p>
              ))}
            </details>
          </section>
          <section className="analysis-column" data-current-view={tab} aria-label="Analysis panels">
            <div
              className="panel-tabs"
              role="tablist"
              aria-label="Analysis views"
            >
              {(["Proposals", "Findings"] as const).map((title) => (
                <button
                  key={title}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      const next =
                        e.key === "Home"
                          ? "Proposals"
                          : e.key === "End"
                            ? "Findings"
                            : title === "Proposals"
                              ? "Findings"
                              : "Proposals";
                      setTab(next);
                      document.getElementById(`tab-${next}`)?.focus();
                    }
                  }}
                  id={`tab-${title}`}
                  role="tab"
                  aria-selected={tab === title}
                  aria-controls={`panel-${title}`}
                  onClick={() => setTab(title)}
                >
                  {title === "Proposals" ? "Suggestions" : "Customer feedback"}
                </button>
              ))}
              <select
                id={
                  tab !== "Proposals" && tab !== "Findings"
                    ? `tab-${tab}`
                    : "more-views"
                }
                aria-label="More review views"
                value={tab === "Proposals" || tab === "Findings" ? "" : tab}
                onChange={(e) => {
                  if (e.target.value) setTab(e.target.value as Tab);
                }}
              >
                <option value="">More</option>
                {tabs
                  .filter(
                    (t) => t.title !== "Proposals" && t.title !== "Findings",
                  )
                  .map((t) => (
                    <option key={t.title}>{t.title}</option>
                  ))}
              </select>
            </div>
            <div
              className="analysis-panel"
              role="tabpanel"
              tabIndex={-1}
              id={`panel-${tab}`}
              aria-label={
                tab === "Proposals"
                  ? "Suggestions"
                  : tab === "Findings"
                    ? "Customer feedback"
                    : tab
              }
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
                  <div hidden={tab !== "Conflicts"}>
                    <ConflictPanel
                      compact
                      api={api}
                      workspace={workspace}
                      busy={busy}
                      onRefresh={() => refresh(runId!)}
                    />
                  </div>
                  {tab === "Findings" && (
                    <FeedbackOverview
                      findings={workspace.findings}
                      selectedId={selectedFindingId}
                      onReview={(f) => {
                        selectFinding(f);
                        setTab("Evidence");
                      }}
                    />
                  )}
                  {tab === "Proposals" && (
                    <WorkshopSummary
                      api={api}
                      workspace={workspace}
                      variantId={activeVariantId}
                      onReview={(c) =>
                        setReviewChange({
                          variantId: activeVariantId,
                          changeId: c.change_id,
                          displayedWorkspace: workspace,
                        })
                      }
                    />
                  )}
                  {tab === "Research" && (
                    <section>
                      <h2>Research</h2>
                      {savedConfig?.deep_dive.enabled ? (
                        <>
                          <label className="stacked-label">
                            Finding
                            <select
                              value={selectedFindingId ?? ""}
                              onChange={(e) => {
                                const f = workspace.findings.find(
                                  (f) => f.finding_id === e.target.value,
                                );
                                if (f) selectFinding(f);
                              }}
                            >
                              {workspace.findings.map((f) => (
                                <option key={f.finding_id} value={f.finding_id}>
                                  {f.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          {selectedFinding && (
                            <ResearchPanel
                              compact
                              api={api}
                              runId={runId!}
                              finding={selectedFinding}
                              bundles={workspace.research}
                              error={workspace.resourceErrors?.research}
                              onRetry={() => refresh(runId!)}
                              onOpen={setSource}
                            />
                          )}
                        </>
                      ) : (
                        <div className="empty-state">Deep Dive off</div>
                      )}
                    </section>
                  )}

                  <div hidden={tab !== "Renders"}>
                    <RenderPanel
                      compact
                      api={api}
                      workspace={workspace}
                      variantId={activeVariantId}
                      busy={busy}
                      hasUnsavedWork={hasUnsavedWork}
                      requestReimagine={reimagineRequest}
                      onRefresh={() => refresh(runId!)}
                      onOpen={setSource}
                    />
                  </div>
                  {tab === "Graph" && (
                    <GraphPanel
                      compact
                      api={api}
                      runId={runId!}
                      onOpen={setSource}
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
                  {tab === "Evidence" && (
                    <>
                      {proposalSelection && !selectedFinding ? (
                        <>
                          <p>
                            No available finding is linked to this proposal.
                          </p>
                          <ChangeExplanation
                            api={api}
                            runId={runId!}
                            proposals={
                              proposalSelection.proposalVersion ===
                              workspace.proposals.proposal_set_version
                                ? workspace.proposals
                                : { ...workspace.proposals, variants: [] }
                            }
                            variantId={proposalSelection.variantId}
                            changeId={proposalSelection.changeId}
                            onOpen={setSource}
                          />
                        </>
                      ) : (
                        <EvidenceOverview
                          api={api}
                          workspace={workspace}
                          selectedId={selectedFindingId}
                          onOpen={setSource}
                        />
                      )}
                    </>
                  )}
                  <div hidden={tab !== "Proposals"}>
                    <details
                      open={editing}
                      onToggle={(e) => setEditing(e.currentTarget.open)}
                      className="proposal-tools"
                    >
                      <summary>Edit suggestions & variants</summary>
                      <ProposalWorkspace
                        api={api}
                        workspace={workspace}
                        variantId={activeVariantId}
                        onVariantChange={setVariantId}
                        busy={busy}
                        onRefresh={() => refresh(runId!)}
                        sessionNamespace={sessionNamespace}
                        legacyDrafts={[...proposalDrafts.current]}
                        legacyIdea={ideaDraft}
                        onOpen={setSource}
                        onDirtyChange={setProposalDirty}
                        onEvidence={(change) => {
                          const linked = workspace.findings.find((f) =>
                            (
                              change.wire?.finding_ids ?? [change.finding_id]
                            ).includes(f.finding_id),
                          );
                          if (linked) selectFinding(linked);
                          else {
                            setSelectedFindingId(null);
                            setSelectedComponent(null);
                            setProposalSelection({
                              proposalVersion:
                                workspace.proposals.proposal_set_version,
                              variantId: activeVariantId,
                              changeId: change.change_id,
                            });
                            setFindingFocusRequest((old) => old + 1);
                          }
                          setTab("Evidence");
                        }}
                      />
                    </details>
                  </div>
                  <div hidden={tab !== "History"}>
                    <HistoryPanel
                      compact
                      api={api}
                      workspace={workspace}
                      variantId={activeVariantId}
                      busy={busy}
                      onRefresh={() => refresh(runId!)}
                      onOpen={setSource}
                    />
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
      {reviewChange && workspace && (
        <SuggestionReview
          key={`${runId}:${reviewChange.variantId}:${reviewChange.changeId}`}
          api={api}
          workspace={{
            ...reviewChange.displayedWorkspace,
            snapshot: workspace.snapshot,
          }}
          variantId={reviewChange.variantId}
          changeId={reviewChange.changeId}
          onClose={() => setReviewChange(null)}
          onRefresh={() => refresh(runId!)}
          onOpen={setSource}
          onEdit={() => {
            setReviewChange(null);
            setTab("Proposals");
            setEditing(true);
          }}
        />
      )}
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
        <SourceDialog
          api={api}
          evidence={source}
          onClose={() => setSource(null)}
        />
      )}
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
    const dialog = ref.current;
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
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
