import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import type { Api, Evidence } from "../api/contracts";

type Row = { evidence?: Evidence; error?: string; loading: boolean };
export default function EvidenceList({
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
  const [rows, setRows] = useState<Record<string, Row>>({});
  const generation = useRef(0);
  const idKey = JSON.stringify([...new Set(ids)]);
  const currentIds = JSON.parse(idKey) as string[];
  const load = async (id: string, expectedGeneration: number) => {
    setRows((old) => ({
      ...old,
      [id]: { ...old[id], loading: true, error: undefined },
    }));
    try {
      const item = await api.request<Evidence>(
        `/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(id)}`,
      );
      if (item.evidence_id !== id)
        throw new Error("Evidence identity mismatch. Retry this source.");
      if (generation.current === expectedGeneration)
        setRows((old) => ({
          ...old,
          [id]: { evidence: item, loading: false },
        }));
    } catch (error) {
      if (generation.current === expectedGeneration)
        setRows((old) => ({
          ...old,
          [id]: {
            ...old[id],
            loading: false,
            error:
              error instanceof Error ? error.message : "Source unavailable.",
          },
        }));
    }
  };
  useEffect(() => {
    const token = ++generation.current;
    setRows({});
    for (const id of JSON.parse(idKey) as string[]) void load(id, token);
    return () => {
      generation.current++;
    };
  }, [api, runId, idKey]);
  return (
    <section className="evidence-section" aria-label={title}>
      <h3>{title}</h3>
      {!currentIds.length && <p className="muted">No observations supplied.</p>}
      {currentIds.map((id) => {
        const row = rows[id];
        const item = row?.evidence;
        return (
          <article key={id} className="evidence-card">
            {(!row || row.loading) && <p role="status">Loading source {id}…</p>}
            {row?.error && (
              <div>
                <p role="alert">
                  {id}: {row.error}
                </p>
                <button
                  disabled={row.loading}
                  onClick={() => void load(id, generation.current)}
                >
                  Retry source {id}
                </button>
              </div>
            )}
            {item && (
              <>
                <strong>
                  {item.wire?.source_kind === "feedback"
                    ? "Customer evidence"
                    : item.source_kind === "external"
                      ? "External evidence"
                      : "Uploaded evidence"}
                  {item.wire ? ` / ${item.wire.source_kind}` : ""}
                </strong>
                <blockquote>{item.excerpt}</blockquote>
                <p className="muted">
                  {item.scope} / {item.locator.label}
                </p>
                <details>
                  <summary>Source details</summary>
                  <p className="muted">
                    Source version: {item.source_version_id}. Applicability:{" "}
                    {item.wire?.applicability ?? "unknown"}.
                  </p>
                  {item.limitations && (
                    <p className="muted">Limitations: {item.limitations}</p>
                  )}
                </details>
                <button
                  onClick={(event) => {
                    event.currentTarget.focus();
                    onOpen(item);
                  }}
                >
                  <BookOpen size={14} />
                  Open source {item.evidence_id}
                </button>
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}
