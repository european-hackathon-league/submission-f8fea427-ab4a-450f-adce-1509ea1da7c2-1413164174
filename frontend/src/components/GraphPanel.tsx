import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Api, Evidence, Graph, Workspace } from "../api/contracts";
import EvidenceList from "./EvidenceList";

type Node = Graph["nodes"][number];
function entityDetails(node: Node, workspace: Workspace) {
  const id = node.node_id;
  const findings = workspace.findings;
  const allChanges = workspace.proposals.variants.flatMap(v => v.changes);
  const changes = allChanges.filter(c => node.entity_type === "requirement" ? c.wire?.requirement_id === id : c.change_id === id);
  let ids: string[] = [];
  let label = node.label;
  switch (node.entity_type) {
    case "finding": ids = findings.filter(f => f.finding_id === id).map(f => f.finding_id); label = findings.find(f => f.finding_id === id)?.title ?? id; break;
    case "part": ids = findings.filter(f => f.part_ids.some(part => part === id)).map(f => f.finding_id); label = `Part ${id}`; break;
    case "cohort": ids = findings.filter(f => f.cohort_ids.includes(id)).map(f => f.finding_id); break;
    case "change": case "requirement": ids = changes.flatMap(c => c.wire?.finding_ids ?? [c.finding_id]); label = changes[0]?.after ?? id; break;
    case "variant": {
      const variant = workspace.proposals.variants.find(v => v.variant_id === id);
      ids = variant?.changes.flatMap(c => c.wire?.finding_ids ?? [c.finding_id]) ?? []; label = variant?.title ?? id; break;
    }
    case "research": ids = workspace.research.filter(r => r.research_id === id).map(r => r.finding_id); break;
    case "evidence": {
      ids = findings.filter(f => [...f.supporting_evidence_ids, ...f.opposing_evidence_ids].includes(id)).map(f => f.finding_id);
      for (const edge of workspace.graph.wire?.edges ?? []) {
        if (edge.evidence_ids.includes(id) || edge.from_id === id || edge.to_id === id)
          ids.push(...findings.filter(f => f.finding_id === edge.from_id || f.finding_id === edge.to_id).map(f => f.finding_id));
      }
      break;
    }
  }
  const unique = new Set(ids);
  return { label, findings: findings.filter(f => unique.has(f.finding_id)) };
}
export default function GraphPanel({ workspace, onSelect, api, runId, onOpen }: {
  workspace: Workspace; onSelect: (id: string) => void; api?: Api; runId?: string; onOpen?: (e: Evidence) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const focusedNode = useRef<string | null>(null);
  const selectionHeading = useRef<HTMLHeadingElement>(null);
  const graphHeading = useRef<HTMLHeadingElement>(null);
  const nodes = workspace.graph.nodes.filter(node => (filter === "all" || node.entity_type === filter) && `${node.node_id} ${node.entity_type} ${entityDetails(node, workspace).label}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const visible = nodes.slice(0, limit);
  const selected = workspace.graph.nodes.find(node => node.node_id === selectedId);
  const detail = selected ? entityDetails(selected, workspace) : null;
  useEffect(() => {
    if (focusedNode.current && !visible.some(node => node.node_id === focusedNode.current)) {
      (selectionHeading.current ?? graphHeading.current)?.focus();
      focusedNode.current = null;
    }
  }, [visible]);
  const edges = workspace.graph.edges.filter(edge => selectedId ? edge.from_id === selectedId || edge.to_id === selectedId : visible.some(n => n.node_id === edge.from_id || n.node_id === edge.to_id));
  const selectedEdge = workspace.graph.edges.find(edge => edge.edge_id === edgeId);
  const evidenceIds = selectedEdge ? workspace.graph.wire?.edges.find(e => e.edge_id === selectedEdge.edge_id)?.evidence_ids ?? [] : [];
  const label = (id: string) => { const node = workspace.graph.nodes.find(n => n.node_id === id); return node ? entityDetails(node, workspace).label : `${id} (entity detail unavailable)`; };
  return <section aria-label="Evidence graph">
    <div className="section-title"><h2 ref={graphHeading} tabIndex={-1}>Evidence graph</h2><label>Node type<select value={filter} onChange={event => { setFilter(event.target.value); setLimit(20); }}><option value="all">All</option>{[...new Set(workspace.graph.nodes.map(n => n.entity_type))].map(type => <option key={type}>{type}</option>)}</select></label></div>
    <label className="stacked-label">Search graph<input value={search} onChange={event => { setSearch(event.target.value); setLimit(20); }}/></label>
    <p className="muted">Showing {visible.length} of {nodes.length} matching entities. Graph revision {workspace.graph.revision ?? "not supplied"}. Node IDs identify entities; labels do not establish associations.</p>
    {!nodes.length && <p>No graph entities match these filters.</p>}
    <div className="graph-nodes">{visible.map(node => <button key={node.node_id} className="graph-node" onFocus={() => { focusedNode.current = node.node_id; }} onBlur={() => { focusedNode.current = null; }} aria-label={`Inspect ${node.entity_type} ${node.node_id}`} aria-pressed={selectedId === node.node_id} onClick={() => { setSelectedId(node.node_id); setEdgeId(null); }}><small>{node.entity_type}</small><strong>{entityDetails(node, workspace).label}</strong><small>{node.node_id}</small></button>)}</div>
    {visible.length < nodes.length && <button onClick={() => setLimit(old => old + 20)}>Show more nodes ({nodes.length - visible.length} remaining)</button>}
    {selectedId && <section aria-label="Selected graph entity" className="evidence-card">
      <h3 ref={selectionHeading} tabIndex={-1}>{detail?.label ?? selectedId}</h3>
      {!selected ? <p>Selected entity is no longer present in this graph revision.</p> : <><p>{selected.entity_type} / {selected.node_id}</p>
        {!detail?.findings.length && <p>No verified finding association. Entity remains inspectable by its stable ID.</p>}
        {detail && detail.findings.length > 1 && <p>Multiple findings share this entity. Choose the finding to inspect.</p>}
        {detail?.findings.map(f => <button key={f.finding_id} onClick={() => onSelect(f.finding_id)}>Open finding {f.title}</button>)}
      </>}
    </section>}
    <h3>Relationships</h3>
    {!edges.length && <p className="muted">No relationships supplied for visible selection.</p>}
    <ul className="graph-edges">{edges.map(edge => <li key={edge.edge_id}>
      <button aria-label={`Inspect endpoint ${edge.from_id}`} disabled={!workspace.graph.nodes.some(n => n.node_id === edge.from_id)} onClick={() => { setSelectedId(edge.from_id); setEdgeId(null); }}>{label(edge.from_id)}</button><span><ArrowRight size={14}/>{edge.relationship}</span><button aria-label={`Inspect endpoint ${edge.to_id}`} disabled={!workspace.graph.nodes.some(n => n.node_id === edge.to_id)} onClick={() => { setSelectedId(edge.to_id); setEdgeId(null); }}>{label(edge.to_id)}</button>
      <span>Evidence provenance: {edge.provenance || "Not supplied"}</span>
      <button aria-pressed={edge.edge_id === edgeId} onClick={() => setEdgeId(edge.edge_id)}>Inspect relationship {edge.edge_id}</button>
    </li>)}</ul>
    {selectedEdge && <section aria-label="Relationship citations"><h3>{selectedEdge.relationship} / {selectedEdge.edge_id}</h3><p>{selectedEdge.from_id} → {selectedEdge.to_id}</p>
      {api && runId && onOpen ? <EvidenceList api={api} runId={runId} ids={evidenceIds} title="Cited observations" onOpen={onOpen}/> : <p>Citation IDs: {selectedEdge.provenance || "No citations supplied"}</p>}
    </section>}
  </section>;
}
