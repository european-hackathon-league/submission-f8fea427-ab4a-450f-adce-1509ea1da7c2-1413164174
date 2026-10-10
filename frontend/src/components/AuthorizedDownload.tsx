import { useEffect, useRef, useState } from "react";
import type { Api } from "../api/contracts";
export default function AuthorizedDownload({
  api,
  url,
  filename,
}: {
  api: Api;
  url: string;
  filename?: string;
}) {
  const protectedFile = !!api.canReadAsset?.(url);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    api: Api;
    url: string;
    link?: string;
    error?: string;
  }>({ api, url });
  const controller = useRef<AbortController | null>(null);
  const region = useRef<HTMLElement>(null);
  useEffect(() => {
    const cancellation = new AbortController();
    controller.current = cancellation;
    let blobUrl: string | undefined;
    let active = true;
    setState({ api, url });
    if (attempt > 0) region.current?.focus();
    if (protectedFile) {
      if (!api.readAsset)
        setState({
          api,
          url,
          error: "Authenticated export download unavailable.",
        });
      else
        void api
          .readAsset(url, cancellation.signal)
          .then((bytes) => {
            if (!active || cancellation.signal.aborted) return;
            blobUrl = URL.createObjectURL(bytes);
            setState({ api, url, link: blobUrl });
          })
          .catch((error) => {
            if (active && !cancellation.signal.aborted)
              setState({
                api,
                url,
                error:
                  error instanceof Error
                    ? error.message
                    : "Authorized download unavailable.",
              });
          });
    }
    return () => {
      active = false;
      cancellation.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [api, url, protectedFile, attempt]);
  if (!protectedFile)
    return (
      <a href={url} target="_blank" rel="noreferrer">
        Download authorized export
      </a>
    );
  const current = state.api === api && state.url === url ? state : undefined;
  return (
    <section ref={region} tabIndex={-1} aria-label="Authorized export download">
      {!current?.link && !current?.error && (
        <>
          <p role="status">Loading authorized export bytes…</p>
          <button
            onClick={() => {
              controller.current?.abort();
              setState({
                api,
                url,
                error:
                  "Export download canceled. Retry retrieves the same authoritative file.",
              });
              region.current?.focus();
            }}
          >
            Cancel export download
          </button>
        </>
      )}
      {current?.error && (
        <>
          <p role="alert">{current.error}</p>
          <button onClick={() => setAttempt((old) => old + 1)}>
            Retry authorized export download
          </button>
        </>
      )}
      {current?.link && (
        <a href={current.link} download={filename ?? "proposal-export"}>
          Download authorized export
        </a>
      )}
    </section>
  );
}
