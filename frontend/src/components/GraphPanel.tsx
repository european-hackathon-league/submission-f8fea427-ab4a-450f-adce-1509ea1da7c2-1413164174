import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Api, Evidence, Graph, Workspace } from "../api/contracts";
import EvidenceList from "./EvidenceList";

type Node = Graph["nodes"][number];
function entityDetails(node: Node, workspace: Workspace) {
  const id = node.node_id;
  const findings = workspace.findings;
  const allChanges = workspace.proposals.variants.flatMap((v) => v.changes);
  const changes = allChanges.filter((c) =>
    node.entity_type === "requirement"
      ? c.wire?.requirement_id === id
      : c.change_id === id,
  );
  let ids: string[] = [];
  let label = node.label;
  switch (node.entity_type) {
    case "finding":
      ids = findings
        .filter((f) => f.finding_id === id)
        .map((f) => f.finding_id);
      label = findings.find((f) => f.finding_id === id)?.title ?? id;
      break;
    case "part":
      ids = findings
        .filter((f) => f.part_ids.some((part) => part === id))
        .map((f) => f.finding_id);
      label = `Part ${id}`;
      break;
    case "cohort":
      ids = findings
        .filter((f) => f.cohort_ids.includes(id))
        .map((f) => f.finding_id);
      break;
    case "change":
    case "requirement":
      ids = changes.flatMap((c) => c.wire?.finding_ids ?? [c.finding_id]);
      label = changes[0]?.after ?? id;
      break;
    case "variant": {
      const variant = workspace.proposals.variants.find(
        (v) => v.variant_id === id,
      );
      ids =
        variant?.changes.flatMap(
          (c) => c.wire?.finding_ids ?? [c.finding_id],
        ) ?? [];
      label = variant?.title ?? id;
      break;
    }
    case "research":
      ids = workspace.research
        .filter((r) => r.research_id === id)
        .map((r) => r.finding_id);
      break;
    case "evidence": {
      ids = findings
        .filter((f) =>
          [...f.supporting_evidence_ids, ...f.opposing_evidence_ids].includes(
            id,
          ),
        )
        .map((f) => f.finding_id);
      for (const edge of workspace.graph.wire?.edges ?? []) {
        if (
          edge.evidence_ids.includes(id) ||
          edge.from_id === id ||
          edge.to_id === id
        )
          ids.push(
            ...findings
              .filter(
                (f) =>
                  f.finding_id === edge.from_id || f.finding_id === edge.to_id,
              )
              .map((f) => f.finding_id),
          );
      }
      break;
    }
  }
  const unique = new Set(ids);
  return { label, findings: findings.filter((f) => unique.has(f.finding_id)) };
}
export default function GraphPanel({
  workspace,
  onSelect,
  api,
  runId,
  onOpen,
  compact = false,
}: {
  compact?: boolean;
  workspace: Workspace;
  onSelect: (id: string) => void;
  api?: Api;
  runId?: string;
  onOpen?: (e: Evidence) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const graphHeading = useRef<HTMLHeadingElement>(null);
  const nodes = workspace.graph.nodes.filter(
    (node) =>
      (filter === "all" || node.entity_type === filter) &&
      `${node.node_id} ${node.entity_type} ${entityDetails(node, workspace).label}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const visible = nodes.slice(0, limit);
  const selected = workspace.graph.nodes.find(
    (node) => node.node_id === selectedId,
  );
  const detail = selected ? entityDetails(selected, workspace) : null;
  useEffect(() => {
    if (
      focusedControl.current &&
      (!focusedControl.current.isConnected ||
        (focusedControl.current instanceof HTMLButtonElement &&
          focusedControl.current.disabled))
    ) {
      (selectionHeading.current ?? graphHeading.current)?.focus();
      focusedControl.current = null;
    }
  }, [visible]);
  const edges = workspace.graph.edges.filter((edge) =>
    selectedId
      ? edge.from_id === selectedId || edge.to_id === selectedId
      : visible.some(
          (n) => n.node_id === edge.from_id || n.node_id === edge.to_id,
        ),
  );
  const selectedEdge = workspace.graph.edges.find(
    (edge) => edge.edge_id === edgeId,
  );
  const evidenceIds = selectedEdge
    ? (workspace.graph.wire?.edges.find(
        (e) => e.edge_id === selectedEdge.edge_id,
      )?.evidence_ids ?? [])
    : [];
  const label = (id: string) => {
    const node = workspace.graph.nodes.find((n) => n.node_id === id);
    return node
      ? entityDetails(node, workspace).label
      : `${id} (entity detail unavailable)`;
  };
  const columns = [...new Set(visible.map((n) => n.entity_type))];
  const COL_X = 220;
  const ROW_Y = 108;
  const PAD_X = 110;
  const PAD_Y = 60;
  const positions = new Map(
    visible.map((n) => {
      const siblings = visible.filter((s) => s.entity_type === n.entity_type);
      return [
        n.node_id,
        {
          x: PAD_X + columns.indexOf(n.entity_type) * COL_X,
          y: PAD_Y + siblings.indexOf(n) * ROW_Y,
        },
      ];
    }),
  );
  const diagramWidth = Math.max(
      300,
      columns.length * COL_X + (PAD_X - COL_X / 2) * 2,
    ),
    diagramHeight = Math.max(
      180,
      ...columns.map(
        (c) => visible.filter((n) => n.entity_type === c).length * ROW_Y + 60,
      ),
    );
  return (
    <section
      aria-label="Evidence graph"
      onFocusCapture={(event) => {
        focusedControl.current = event.target as HTMLElement;
      }}
      onBlurCapture={() => {
        focusedControl.current = null;
      }}
    >
      <div className="section-title">
        <h2 ref={graphHeading} tabIndex={-1}>
          Evidence graph
        </h2>
        <label>
          Node type
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLimit(20);
            }}
          >
            <option value="all">All</option>
            {[...new Set(workspace.graph.nodes.map((n) => n.entity_type))].map(
              (type) => (
                <option key={type}>{type}</option>
              ),
            )}
          </select>
        </label>
      </div>
      <label className="stacked-label">
        Search graph
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(20);
          }}
        />
      </label>
      <p className="muted">
        Showing {visible.length} of {nodes.length} matching entities. Graph
        revision {workspace.graph.revision ?? "not supplied"}. Node IDs identify
        entities; labels do not establish associations.
      </p>
      {!nodes.length && <p>No graph entities match these filters.</p>}
      {compact && (
        <div className="relationship-map">
          <div
            className="relationship-canvas"
            style={{ width: diagramWidth, height: diagramHeight }}
          >
            <svg
              viewBox={`0 0 ${diagramWidth} ${diagramHeight}`}
              width={diagramWidth}
              height={diagramHeight}
              role="img"
              aria-label={`${visible.length} entities linked by backend relationships`}
            >
              <defs>
                <marker
                  id="graph-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a8b8" />
                </marker>
              </defs>
              {workspace.graph.edges
                .filter(
                  (e) => positions.has(e.from_id) && positions.has(e.to_id),
                )
                .map((e) => {
                  const a = positions.get(e.from_id)!,
                    b = positions.get(e.to_id)!;
                  const dim =
                    selectedId &&
                    e.from_id !== selectedId &&
                    e.to_id !== selectedId;
                  const midX = (a.x + b.x) / 2;
                  return (
                    <path
                      key={e.edge_id}
                      d={`M${a.x},${a.y} C${midX},${a.y} ${midX},${b.y} ${b.x},${b.y}`}
                      className={dim ? "is-dim" : undefined}
                      markerEnd="url(#graph-arrow)"
                    >
                      <title>{e.relationship}</title>
                    </path>
                  );
                })}
            </svg>
            {visible.map((n) => {
              const p = positions.get(n.node_id)!;
              const fullLabel = entityDetails(n, workspace).label;
              const shortLabel =
                fullLabel.length > 28
                  ? `${fullLabel.slice(0, 27)}…`
                  : fullLabel;
              return (
                <button
                  key={n.node_id}
                  style={{ left: p.x, top: p.y }}
                  title={`${n.entity_type} · ${fullLabel} · ${n.node_id}`}
                  aria-label={`Inspect ${n.entity_type} ${n.node_id}`}
                  aria-pressed={selectedId === n.node_id}
                  onClick={() => {
                    setSelectedId(n.node_id);
                    setEdgeId(null);
                  }}
                >
                  <small>{n.entity_type}</small>
                  <span>{shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!compact && (
        <div className="graph-nodes">
          {visible.map((node) => (
            <button
              key={node.node_id}
              className="graph-node"
              aria-label={`Inspect ${node.entity_type} ${node.node_id}`}
              aria-pressed={selectedId === node.node_id}
              onClick={() => {
                setSelectedId(node.node_id);
                setEdgeId(null);
              }}
            >
              <small>{node.entity_type}</small>
              <strong>{entityDetails(node, workspace).label}</strong>
              <small>{node.node_id}</small>
            </button>
          ))}
        </div>
      )}
      {visible.length < nodes.length && (
        <button onClick={() => setLimit((old) => old + 20)}>
          Show more nodes ({nodes.length - visible.length} remaining)
        </button>
      )}
      {selectedId && (
        <section aria-label="Selected graph entity" className="evidence-card">
          <h3 ref={selectionHeading} tabIndex={-1}>
            {detail?.label ?? selectedId}
          </h3>
          {!selected ? (
            <p>Selected entity is no longer present in this graph revision.</p>
          ) : (
            <>
              <p>
                {selected.entity_type} / {selected.node_id}
              </p>
              {!detail?.findings.length && (
                <p>
                  No verified finding association. Entity remains inspectable by
                  its stable ID.
                </p>
              )}
              {detail && detail.findings.length > 1 && (
                <p>
                  Multiple findings share this entity. Choose the finding to
                  inspect.
                </p>
              )}
              {detail?.findings.map((f) => (
                <button
                  key={f.finding_id}
                  onClick={() => onSelect(f.finding_id)}
                >
                  Open finding {f.title}
                </button>
              ))}
            </>
          )}
        </section>
      )}
      <details open={!compact}>
        <summary>Relationships</summary>
        {!edges.length && (
          <p className="muted">
            No relationships supplied for visible selection.
          </p>
        )}
        <ul className="graph-edges">
          {edges.map((edge) => (
            <li key={edge.edge_id}>
              <div className="graph-edge-route">
                <button
                  aria-label={`Inspect endpoint ${edge.from_id}`}
                  disabled={
                    !workspace.graph.nodes.some((n) => n.node_id === edge.from_id)
                  }
                  onClick={() => {
                    setSelectedId(edge.from_id);
                    setEdgeId(null);
                  }}
                  title={label(edge.from_id)}
                >
                  {label(edge.from_id)}
                </button>
                <span className="graph-edge-rel">
                  <ArrowRight size={14} aria-hidden />
                  {edge.relationship}
                </span>
                <button
                  aria-label={`Inspect endpoint ${edge.to_id}`}
                  disabled={
                    !workspace.graph.nodes.some((n) => n.node_id === edge.to_id)
                  }
                  onClick={() => {
                    setSelectedId(edge.to_id);
                    setEdgeId(null);
                  }}
                  title={label(edge.to_id)}
                >
                  {label(edge.to_id)}
                </button>
              </div>
              <div className="graph-edge-meta">
                <span>
                  Evidence provenance: {edge.provenance || "Not supplied"}
                </span>
                <button
                  aria-pressed={edge.edge_id === edgeId}
                  onClick={() => setEdgeId(edge.edge_id)}
                >
                  Inspect relationship {edge.edge_id}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </details>
      {edgeId && !selectedEdge && (
        <section aria-label="Relationship citations">
          <h3>Relationship {edgeId}</h3>
          <p>
            Selected relationship is no longer present in this graph revision.
          </p>
        </section>
      )}
      {selectedEdge && (
        <section aria-label="Relationship citations">
          <h3>
            {selectedEdge.relationship} / {selectedEdge.edge_id}
          </h3>
          <p>
            {selectedEdge.from_id} → {selectedEdge.to_id}
          </p>
          {api && runId && onOpen ? (
            <EvidenceList
              api={api}
              runId={runId}
              ids={evidenceIds}
              title="Cited observations"
              onOpen={onOpen}
            />
          ) : (
            <p>
              Citation IDs: {selectedEdge.provenance || "No citations supplied"}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
