import { useEffect, useState } from 'react';
import App from './App';
import Journey from './collection/Journey.jsx';
import { models } from './collection/journeyData.js';
import type { Api } from './api/contracts';

type Model = (typeof models)[number];
export default function FrontendApp({ api }: { api?: Api }) {
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
    {!workspace && <Journey onOpen={open} />}
    {opened && <div hidden={!workspace}>
      <App api={api} initialModel={selected} onBack={back} />
    </div>}
  </>;
}
