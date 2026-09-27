import { randomUUID } from 'node:crypto';

async function ingestIds(store, gmail, ids, generation) {
  for (const id of new Set(ids)) {
    if (!store.message(id)?.raw_hash) {
      try {
        const message = await gmail.raw(id);
        if (!message.raw || !Number.isFinite(Number(message.internalDate))) throw new Error('invalid_gmail_message');
        store.ingest(id, Buffer.from(message.raw, 'base64url'), { received: Number(message.internalDate), threadId: message.threadId, labels: message.labelIds || [], origin: 'gmail' });
      } catch (error) {
        if (error.status !== 404) throw error;
        store.ingest(id, null, { received: 0, origin: 'gmail' });
      }
    }
    if (generation) store.db.prepare('INSERT INTO scan_seen VALUES (?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation').run(id, generation);
  }
}

export async function startBackfill(store, gmail) {
  const profile = await gmail.profile();
  const state = { mode: 'backfill', generation: randomUUID(), baselineHistoryId: profile.historyId, pageToken: null,
    listed: 0, profileCountAtStart: profile.messagesTotal, startedAt: new Date().toISOString(), failures: 0 };
  store.set('sync', state);
  store.set('coverage', { enumerationCompleted: false, startedAt: state.startedAt });
  return state;
}

/** One durable page per call; checkpoints advance only after every listed ID is accounted for. */
export async function syncStep(store, gmail, { full = false } = {}) {
  let state = store.get('sync');
  if (!state || full) state = await startBackfill(store, gmail);
  if (state.retryAt && state.retryAt > Date.now()) return state;
  if (state.mode === 'idle') state = { ...state, mode: 'delta', pageToken: null };
  try {
    if (state.mode === 'backfill') {
      let page;
      try { page = await gmail.list(state.pageToken); }
      catch (error) {
        if (error.status === 400 && state.pageToken) return startBackfill(store, gmail);
        throw error;
      }
      const ids = (page.messages || []).map(message => message.id);
      await ingestIds(store, gmail, ids, state.generation);
      state.listed = store.db.prepare('SELECT count(*) AS n FROM scan_seen WHERE generation=?').get(state.generation).n;
      state.pageToken = page.nextPageToken || null;
      if (!state.pageToken) {
        state.mode = 'delta'; state.historyId = state.baselineHistoryId; state.finishingBackfill = true;
      }
    } else {
      let page;
      try { page = await gmail.history(state.historyId, state.pageToken); }
      catch (error) {
        // Expired history requires a FULL rescan, including mail imported with old internal dates.
        if (error.status === 404 || (error.status === 400 && state.pageToken)) return startBackfill(store, gmail);
        throw error;
      }
      await ingestIds(store, gmail, (page.history || []).flatMap(event => (event.messagesAdded || []).map(added => added.message.id)));
      state.pageToken = page.nextPageToken || null;
      if (!state.pageToken) {
        if (!page.historyId) throw new Error('missing_history_cursor');
        state.historyId = page.historyId; state.mode = 'idle'; state.lastSyncAt = new Date().toISOString();
        const profile = await gmail.profile();
        store.set('coverage', { enumerationCompleted: true, lastSyncAt: state.lastSyncAt, startedAt: state.startedAt,
          scanListed: state.listed, profileCountAtStart: state.profileCountAtStart, profileCountNow: profile.messagesTotal,
          note: 'Mailbox counts are a sanity check, not an atomic snapshot. Changes/deletions can cause differences.' });
        state.finishingBackfill = false;
      }
    }
    state.failures = 0; state.retryAt = null; state.lastError = null; state.lastErrorReason = null;
    store.set('sync', state);
    return state;
  } catch (error) {
    state.failures = (state.failures || 0) + 1;
    state.lastError = error.status ? `remote_http_${error.status}` : 'sync_failed';
    state.lastErrorReason = /^[a-zA-Z_]{1,80}$/.test(error.code || '') ? error.code : null;
    state.retryAt = Date.now() + Math.max(error.retryAfter || 0, Math.min(900000, 1000 * 2 ** Math.min(state.failures, 10)));
    store.set('sync', state);
    store.log('sync.retry', { status: error.status || null, attempt: state.failures });
    throw error;
  }
}
