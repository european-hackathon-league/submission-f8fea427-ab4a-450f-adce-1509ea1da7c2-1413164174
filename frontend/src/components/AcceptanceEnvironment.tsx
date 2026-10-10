export default function AcceptanceEnvironment({
  enabled = import.meta.env.VITE_CONTRACT_HARNESS === "true",
}: {
  enabled?: boolean;
}) {
  if (!enabled) return null;
  return (
    <aside
      className="acceptance-environment notice"
      role="note"
      aria-label="Synthetic contract harness"
    >
      <h2>Frontend contract harness</h2>
      <p>
        Synthetic HTTP fixtures exercise the application API contract. No live
        backend acceptance. No uploaded source analysis, external research or
        generation.
      </p>
      <p>
        For this local harness only, use API access token{" "}
        <code>harness-token</code> and a shared scenario name as Workspace ID,
        for example <code>standard_autonomous</code>. These are public fixture
        identifiers, not real authentication. Do not enter real credentials in
        the harness.
      </p>
      {import.meta.env.VITE_API_MODE !== "real" && (
        <p>
          Mock transport does not establish network integration. Start the
          documented harness configuration to exercise the network API adapter.
        </p>
      )}
    </aside>
  );
}
