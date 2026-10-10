import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Api, Evidence } from "../api/contracts";

function authorizedLink(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? value : null;
  } catch { return null; }
}
export default function SourceDialog({ api, evidence, onClose }: { api: Api; evidence: Evidence; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ identity: string; url?: string; error?: string }>({ identity: "" });
  const sourceUrl = authorizedLink(evidence.source_url);
  const locator = evidence.wire?.locator;
  const citedPage = locator && "url" in locator ? authorizedLink(locator.url) : null;
  const protectedSource = !!sourceUrl && !!api.canReadSource?.(sourceUrl);
  const identity = JSON.stringify([evidence.evidence_id, evidence.source_version_id, sourceUrl]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (ref.current?.showModal) ref.current.showModal();
    else ref.current?.setAttribute("open", "");
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let blobUrl: string | undefined;
    setResult({ identity });
    if (sourceUrl && protectedSource) {
      if (!api.readSource) setResult({ identity, error: "Authenticated source access unavailable." });
      else void api.readSource(sourceUrl, controller.signal).then(blob => {
        if (controller.signal.aborted) return;
        blobUrl = URL.createObjectURL(blob);
        setResult({ identity, url: blobUrl });
      }).catch(error => {
        if (!controller.signal.aborted) setResult({ identity, error: error instanceof Error ? error.message : "Original source unavailable." });
      });
    }
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [api, identity, sourceUrl, protectedSource, attempt]);
  const active = result.identity === identity ? result : undefined;
  const link = protectedSource ? active?.url : sourceUrl;
  return <dialog ref={ref} aria-label="Source reference" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
    <div className="section-title"><h2>Source reference</h2><button className="icon-button" aria-label="Close source" title="Close source" onClick={onClose}><X size={18}/></button></div>
    <dl>
      <dt>Evidence</dt><dd>{evidence.evidence_id}</dd>
      <dt>Source version</dt><dd>{evidence.source_version_id}</dd>
      <dt>Source type</dt><dd>{evidence.wire?.source_kind ?? evidence.source_kind}</dd>
      <dt>Exact locator</dt><dd>{evidence.locator.label}</dd>
      <dt>Scope</dt><dd>{evidence.scope}</dd>
      <dt>Applicability</dt><dd>{evidence.wire?.applicability ?? "unknown"}</dd>
    </dl>
    <blockquote>{evidence.excerpt}</blockquote>
    {citedPage && <p><a href={citedPage} target="_blank" rel="noreferrer">Open cited page</a></p>}
    <p>{evidence.limitations || "No limitations supplied."}</p>
    {protectedSource && !active?.url && !active?.error && <p role="status">Loading authorized original source…</p>}
    {active?.error && <><p role="alert">{active.error}</p><button onClick={() => setAttempt(old => old + 1)}>Retry original source</button></>}
    {link ? <a href={link} target="_blank" rel="noreferrer" download={protectedSource || undefined}>Open original source</a> : !protectedSource && <p className="muted">Original file link unavailable; exact source locator retained.</p>}
  </dialog>;
}
