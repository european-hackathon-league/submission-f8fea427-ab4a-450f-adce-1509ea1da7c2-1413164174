import { useEffect, useRef, useState } from "react";
import type { Api } from "../api/contracts";
import type { Asset, RenderResult } from "../api/wire";
type AssetApi = Api & {
  canReadAsset?(url: string): boolean;
  readAsset?(url: string, signal: AbortSignal): Promise<Blob>;
};
export interface RenderAssetsProps {
  api: AssetApi;
  assets: RenderResult["assets"];
  identity: string;
  onRefreshLinks?: () => void;
}
const previewMedia = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/svg+xml",
]);
function authorizedUrl(api: Api, value: string): string | null {
  try {
    if (typeof value !== "string" || !value.trim()) return null;
    const resolved = api.linkUrl ? api.linkUrl(value) : value;
    if (!resolved) return null;
    const url = new URL(resolved, window.location.href);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function Preview({
  api,
  asset,
  url,
  onRefreshLinks,
  protectedAsset = false,
  inline = true,
}: {
  api: AssetApi;
  asset: Asset;
  url: string;
  onRefreshLinks?: () => void;
  protectedAsset?: boolean;
  inline?: boolean;
}) {
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "timeout"
  >("loading");
  const [displayUrl, setDisplayUrl] = useState<string | null>(
    protectedAsset ? null : url,
  );
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const currentAttempt = useRef(attempt);
  currentAttempt.current = attempt;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const figure = useRef<HTMLElement>(null);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    let objectUrl: string | undefined;
    const abort = new AbortController();
    setError("");
    setStatus("loading");
    setDisplayUrl(protectedAsset ? null : url);
    timer.current = setTimeout(() => {
      active = false;
      abort.abort();
      setStatus("timeout");
    }, 15000);
    if (attempt > 0) figure.current?.focus();
    if (protectedAsset) {
      void (async () => {
        try {
          if (!api.readAsset)
            throw new Error(
              "Authorized asset retrieval unavailable. Refresh asset links.",
            );
          const blob = await api.readAsset(url, abort.signal);
          if (!active || abort.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setDisplayUrl(objectUrl);
          if (!inline) {
            clearTimeout(timer.current);
            setStatus("ready");
          }
        } catch (cause) {
          if (!active || abort.signal.aborted) return;
          clearTimeout(timer.current);
          setError(
            cause instanceof Error
              ? cause.message
              : "Authorized asset retrieval failed.",
          );
          setStatus("error");
        }
      })();
    }
    return () => {
      active = false;
      mounted.current = false;
      abort.abort();
      clearTimeout(timer.current);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, url, attempt, protectedAsset, inline]);
  function finish(next: "ready" | "error") {
    if (!mounted.current || currentAttempt.current !== attempt) return;
    clearTimeout(timer.current);
    setStatus(next);
  }
  const failed = status === "error" || status === "timeout";
  return (
    <figure
      ref={figure}
      tabIndex={-1}
      aria-label={`Variant asset ${asset.asset_id}`}
    >
      <figcaption>
        Asset {asset.asset_id} / {asset.media_type}
      </figcaption>
      {!failed && displayUrl && inline && (
        <img
          key={attempt}
          src={displayUrl}
          alt={`Variant asset ${asset.asset_id} preview`}
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={() => finish("ready")}
          onError={() => finish("error")}
          style={{ display: "block", maxWidth: "100%", height: "auto" }}
        />
      )}
      {!inline && (
        <p>
          Inline preview unavailable for {asset.media_type}. Geometry and
          semantic mappings are not inferred.
        </p>
      )}
      {status === "loading" && (
        <p role="status">Loading asset {asset.asset_id}…</p>
      )}
      {status === "ready" && (
        <p role="status">Asset {asset.asset_id} loaded.</p>
      )}
      {failed && (
        <>
          <p role="alert">
            Asset {asset.asset_id} preview unavailable
            {status === "timeout" ? ": loading timed out." : "."} {error}
          </p>
          <p>
            Baseline and numbered explanations remain available. Preview retry
            uses the returned authorized link.
          </p>
          <button
            onClick={() => {
              setStatus("loading");
              setAttempt((old) => old + 1);
            }}
          >
            Retry asset {asset.asset_id} preview
          </button>
          {onRefreshLinks && (
            <button onClick={onRefreshLinks}>Refresh asset links</button>
          )}
        </>
      )}
      {displayUrl && (
        <a
          href={displayUrl}
          download={protectedAsset ? asset.asset_id : undefined}
          target={protectedAsset ? undefined : "_blank"}
          rel="noreferrer"
        >
          {protectedAsset ? "Download" : "Open"} variant asset {asset.asset_id}
        </a>
      )}
    </figure>
  );
}
export default function RenderAssets({
  api,
  assets,
  identity,
  onRefreshLinks,
}: RenderAssetsProps) {
  const unique = new Map<string, { asset: Asset; conflict: boolean }>();
  let invalid = false;
  for (const asset of assets) {
    if (
      typeof asset?.asset_id !== "string" ||
      !asset.asset_id ||
      typeof asset.media_type !== "string" ||
      !asset.media_type
    ) {
      invalid = true;
      continue;
    }
    const previous = unique.get(asset.asset_id);
    if (previous) {
      if (
        previous.asset.url !== asset.url ||
        previous.asset.media_type !== asset.media_type
      )
        previous.conflict = true;
    } else unique.set(asset.asset_id, { asset, conflict: false });
  }
  return (
    <>
      {!assets.length && (
        <p>
          No bound asset supplied for this variant. Baseline remains
          independently available.
        </p>
      )}
      {invalid && (
        <p role="alert">
          Asset identity or media type unavailable. Preview withheld.
        </p>
      )}
      {[...unique.values()].map(({ asset, conflict }) => {
        const url = authorizedUrl(api, asset.url);
        const key = JSON.stringify([
          identity,
          asset.asset_id,
          asset.url,
          url,
          asset.media_type,
        ]);
        if (conflict)
          return (
            <p key={key} role="alert">
              Conflicting asset identity {asset.asset_id}. Preview and link
              withheld.
            </p>
          );
        if (!url)
          return (
            <p key={key} role="alert">
              Asset {asset.asset_id}: authorized web link unavailable. Baseline
              and numbered explanations remain available.
            </p>
          );
        const protectedAsset = api.canReadAsset?.(url) ?? false;
        if (
          !previewMedia.has(asset.media_type.toLowerCase()) &&
          !protectedAsset
        )
          return (
            <figure key={key}>
              <figcaption>
                Asset {asset.asset_id} / {asset.media_type}
              </figcaption>
              <p>
                Inline preview unavailable for {asset.media_type}. Geometry and
                semantic mappings are not inferred.
              </p>
              <a href={url} target="_blank" rel="noreferrer">
                Open variant asset {asset.asset_id}
              </a>
            </figure>
          );
        return (
          <Preview
            key={key}
            api={api}
            asset={asset}
            url={url}
            protectedAsset={protectedAsset}
            inline={previewMedia.has(asset.media_type.toLowerCase())}
            onRefreshLinks={onRefreshLinks}
          />
        );
      })}
    </>
  );
}
