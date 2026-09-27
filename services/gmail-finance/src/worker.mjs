import { syncStep } from './sync.mjs';
import { processPending, processModelPending } from './pipeline.mjs';

// Each stage is serial within itself, but network waits never block another stage.
export function createWorker(store, config, gmail, dependencies = {}) {
  const sync = dependencies.syncStep || syncStep;
  const normalize = dependencies.processPending || processPending;
  const extract = dependencies.processModelPending || processModelPending;
  const interval = dependencies.intervalMs ?? 1000;
  const phases = { ingestion: false, normalization: false, extraction: false };
  const timers = new Set(); const active = new Set();
  let stopped = true, requested = false, full = false;
  const handlers = {
    ingestion: async () => {
      if (store.get('connection')?.status !== 'connected') return;
      const state = store.get('sync');
      const due = !state?.lastSyncAt || Date.now() - Date.parse(state.lastSyncAt) >= config.pollSeconds * 1000;
      if (requested || due || state?.mode !== 'idle') {
        const rescan = full; requested = false; full = false;
        await sync(store, gmail, { full: rescan });
      }
    },
    normalization: () => normalize(store, config, 25, { deferModel: true }),
    extraction: () => extract(store, config),
  };
  function run(name) {
    if (stopped) return;
    const task = (async () => {
      phases[name] = true;
      try { await handlers[name](); }
      catch { store.set(`worker-error:${name}`, { code: `${name}_failed`, at: new Date().toISOString() }); }
      finally { phases[name] = false; }
    })();
    active.add(task);
    void task.finally(() => {
      active.delete(task);
      if (!stopped) {
        const timer = setTimeout(() => { timers.delete(timer); run(name); }, interval);
        timers.add(timer);
      }
    });
  }
  return {
    get phases() { return { ...phases }; },
    get running() { return Object.values(phases).some(Boolean); },
    requestSync(rescan = false) { requested = true; full ||= rescan; },
    start() { if (!stopped) return; stopped = false; for (const name of Object.keys(handlers)) run(name); },
    async stop() { stopped = true; for (const timer of timers) clearTimeout(timer); timers.clear(); await Promise.allSettled([...active]); },
  };
}
