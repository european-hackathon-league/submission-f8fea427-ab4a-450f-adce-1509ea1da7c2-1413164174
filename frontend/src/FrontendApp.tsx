import { useEffect, useState } from 'react';
import App from './App';
import Journey from './collection/Journey.jsx';
import { models } from './collection/journeyData.js';
import type { Api } from './api/contracts';
import { createMockApi, createRealApi } from './api/client';

type Model = (typeof models)[number];

// Demo mode: skip the manual API-connect screen and go straight from
// Explore -> Workshop using seeded development access. Explicit `api`
// props (tests, harnesses) still win; mock mode still uses the synthetic API.
function demoApi(): Api {
  if (import.meta.env.VITE_API_MODE === 'mock') {
    return createMockApi(import.meta.env.VITE_MOCK_SCENARIO);
  }
  const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  const workspace = import.meta.env.VITE_DEMO_WORKSPACE_ID || 'workspace_demo';
  const token = import.meta.env.VITE_DEMO_API_TOKEN || 'development:pm_demo';
  const headers = { Authorization: `Bearer ${token}`, 'X-Workspace-ID': workspace };
  return createRealApi(base, { headers: () => headers, sessionNamespace: `${base}|${workspace}` });
}
export default function FrontendApp({ api }: { api?: Api }) {
  const [fallbackApi] = useState<Api>(() => api ?? demoApi());
  const resolvedApi = api ?? fallbackApi;
  const [workspace, setWorkspace] = useState(() => window.location.hash === '#workspace');
  const [selected, setSelected] = useState<Model | null>(() =>
    models.find(model => model.id === window.sessionStorage.getItem('collection-model')) ?? null,
  );
  const [opened, setOpened] = useState(workspace);
  useEffect(() => {
    const sync = () => {
      const show = window.location.hash === '#workspace';
      setWorkspace(show);
      if (show) setOpened(true);
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  function open(model: Model | null) {
    if (model && model.id !== selected?.id) {
      setSelected(model);
      window.sessionStorage.setItem('collection-model', model.id);
    }
    window.history.pushState(null, '', '#workspace');
    setOpened(true);
    setWorkspace(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function back() {
    window.history.pushState(null, '', window.location.pathname + window.location.search);
    setWorkspace(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return <>
    {!workspace && <Journey onOpen={open} initialModel={selected} />}
    {opened && <div hidden={!workspace}>
      <App api={resolvedApi} initialModel={selected} onBack={back} />
    </div>}
  </>;
}
