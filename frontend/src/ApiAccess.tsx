import { useState } from "react";

export default function ApiAccess({ baseUrl, onConnect }: { baseUrl: string; onConnect: (base: string, headers: Record<string, string>, namespace: string) => void }) {
  const [workspace, setWorkspace] = useState("");
  const [token, setToken] = useState("");
  return <main className="run-setup">
    <h1>Connect to application API</h1>
    <p>Use an API access token from your existing identity provider and an authorized workspace ID. Access token stays in memory; enter it again after reload.</p>
    <p>API: {baseUrl}</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!workspace.trim() || !token.trim()) return;
      const headers = { Authorization: `Bearer ${token.trim()}`, "X-Workspace-ID": workspace.trim() };
      setToken("");
      onConnect(baseUrl, headers, `${baseUrl}|${workspace.trim()}`);
    }}>
      <label className="stacked-label">Workspace ID<input autoComplete="off" value={workspace} onChange={e => setWorkspace(e.target.value)} /></label>
      <label className="stacked-label">API access token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></label>
      <button disabled={!workspace.trim() || !token.trim()}>Connect to API</button>
    </form>
  </main>;
}
