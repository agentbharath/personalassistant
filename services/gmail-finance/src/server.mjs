import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config as loadConfig } from './config.mjs';
import { Store } from './store.mjs';
import { beginOAuth, finishOAuth, Gmail } from './gmail.mjs';
import { reviewDocument, repairSavedEvidence } from './pipeline.mjs';
import { createWorker } from './worker.mjs';
import { rebuild, csv } from './ledger.mjs';
import { coverage, createAudit, labelAudit } from './coverage.mjs';

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
const assets = fileURLToPath(new URL('../web/', import.meta.url));
function authorized(header, key) {
  const actual = Buffer.from(header || ''); const expected = Buffer.from(`Bearer ${key}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('json_content_type_required');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('body_too_large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new Error('invalid_json'); }
}
function page(items, url) {
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 100);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('invalid_pagination');
  return { items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null };
}

export function createApp(config, store, dependencies = {}) {
  const gmail = dependencies.gmail || new Gmail(config, store);
  const worker = createWorker(store, config, gmail, dependencies.worker);
  const server = createServer(async (req, res) => {
    const send = (status, payload, extra = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extra });
      res.end(JSON.stringify(payload));
    };
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const origin = `http://127.0.0.1:${config.port}`;
    // Block DNS rebinding and cross-origin access even on a loopback-only listener.
    if (req.headers.host !== `127.0.0.1:${config.port}` || (req.headers.origin && req.headers.origin !== origin)) return send(403, { error: 'origin_not_allowed' });
    const url = new URL(req.url, origin);
    try {
      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        res.writeHead(302, { location: '/favicon.svg' }); res.end(); return;
      }
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [file, type] = staticFiles[url.pathname];
        res.writeHead(200, { 'content-type': type }); res.end(await readFile(`${assets}${file}`)); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok', service: 'gmail-finance', version: '0.1.0' });
      if (req.method === 'GET' && url.pathname === '/oauth/callback') {
        const binding = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('gmail_oauth='))?.slice('gmail_oauth='.length);
        await finishOAuth(config, store, url.searchParams, binding);
        gmail.access = null;
        worker.requestSync();
        res.writeHead(303, { location: '/', 'set-cookie': 'gmail_oauth=; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=0' }); res.end(); return;
      }
      if (!authorized(req.headers.authorization, config.apiKey)) return send(401, { error: 'unauthorized' });
      if (req.method === 'POST' && url.pathname === '/api/oauth/start') {
        const result = beginOAuth(config, store);
        return send(200, { url: result.url }, { 'set-cookie': `gmail_oauth=${result.binding}; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600` });
      }
      if (req.method === 'GET' && url.pathname === '/api/coverage') return send(200, { ...coverage(store, config), workerRunning: worker.running,
        workerPhases: worker.phases, sync: store.get('sync'), modelEnabled: Boolean(config.modelKey && config.model), modelDailyLimit: config.modelDailyLimit });
      if (req.method === 'POST' && url.pathname === '/api/sync') {
        if (store.get('connection')?.status !== 'connected') return send(409, { error: 'connect_gmail_first' });
        const input = await body(req); worker.requestSync(input.full === true);
        return send(202, { queued: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/reprocess') {
        store.db.prepare("UPDATE messages SET disposition='pending' WHERE raw_hash IS NOT NULL").run();
        store.log('pipeline.reprocess_requested', {});
        return send(202, { queued: true, overridesPreserved: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/rebuild') { rebuild(store); return send(200, { rebuilt: true }); }
      if (req.method === 'POST' && url.pathname === '/api/disconnect') {
        if (worker.phases.ingestion) return send(409, { error: 'worker_busy_retry_disconnect' });
        store.set('connection', { status: 'disconnected' }); store.set('tokens', null); store.set('oauth', null); gmail.access = null;
        store.log('gmail.disconnected', {});
        return send(200, { disconnected: true, note: 'Stored history retained. You can also revoke access in your Google account.' });
      }
      if (req.method === 'GET' && ['/api/ledger', '/api/obligations', '/api/statements', '/api/export.csv'].includes(url.pathname)) {
        let records = store.ledger();
        if (url.searchParams.get('includeReview') !== 'true') records = records.filter(row => row.quality === 'accepted');
        const recordKind = url.pathname === '/api/obligations' ? 'obligation' : url.pathname === '/api/statements' ? 'statement' : null;
        records = recordKind ? records.filter(row => row.kind === recordKind) : records.filter(row => !['obligation', 'statement'].includes(row.kind));
        for (const key of ['kind', 'currency']) if (url.searchParams.has(key)) records = records.filter(row => row[key] === url.searchParams.get(key));
        for (const key of ['from', 'to']) if (url.searchParams.has(key) && !/^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get(key))) throw new Error('invalid_date_filter');
        if (url.searchParams.has('from')) records = records.filter(row => row.date >= url.searchParams.get('from'));
        if (url.searchParams.has('to')) records = records.filter(row => row.date <= url.searchParams.get('to'));
        if (url.pathname.endsWith('.csv')) { res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="transactions.csv"' }); res.end(csv(records)); return; }
        return send(200, page(records, url));
      }
      if (req.method === 'GET' && url.pathname === '/api/reviews') return send(200, page(store.reviews(), url));
      if (req.method === 'GET' && url.pathname === '/api/messages') {
        const items = store.db.prepare('SELECT id,received,disposition FROM messages ORDER BY received DESC,id').all();
        return send(200, page(items, url));
      }
      const message = url.pathname.match(/^\/api\/messages\/([a-zA-Z0-9_-]{1,200})(\/source|\/review)?$/);
      if (message) {
        const id = message[1];
        if (!store.message(id)) return send(404, { error: 'message_not_found' });
        if (req.method === 'GET' && message[2] === '/source') {
          const raw = store.message(id).raw_hash;
          if (!raw) return send(404, { error: 'source_unavailable' });
          res.writeHead(200, { 'content-type': 'message/rfc822', 'content-disposition': `attachment; filename="${id}.eml"` }); res.end(store.readRaw(raw)); return;
        }
        if (req.method === 'POST' && message[2] === '/review') {
          const result = await reviewDocument(store, id, await body(req), config);
          if (result.disposition === 'financial') store.db.prepare("UPDATE reviews SET status='resolved' WHERE message_id=? AND reason='audit:missed_financial_document'").run(id);
          return send(200, result);
        }
        if (req.method === 'GET' && !message[2]) return send(200, { message: store.message(id), document: store.document(id), override: store.override(id) });
      }
      if (req.method === 'GET' && url.pathname === '/api/audit') return send(200, store.get('negative-audit'));
      if (req.method === 'POST' && url.pathname === '/api/audit') return send(201, createAudit(store, (await body(req)).count || 100));
      if (req.method === 'POST' && url.pathname === '/api/audit/label') { const input = await body(req); return send(200, labelAudit(store, input.messageId, input.financial)); }
      return send(404, { error: 'not_found' });
    } catch (error) {
      // Only return controlled error identifiers; never SDK/request bodies or source content.
      const safe = /^[a-z_]+(?::[a-z_,]+)?$/.test(error.message) ? error.message : 'request_failed';
      send(400, { error: safe });
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  return {
    server,
    startWorker() { worker.start(); },
    async stop() { await worker.stop(); await new Promise(resolve => server.close(resolve)); },
  };
}

export async function start(config) {
  process.umask(0o077);
  const store = new Store(config.dataDir, config.encryptionKey);
  repairSavedEvidence(store, config);
  // Refresh derived data after a crash between document commit and derivation.
  rebuild(store);
  const app = createApp(config, store);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(config.port, config.host, resolve); });
  app.startWorker();
  console.log(`Gmail Finance: http://127.0.0.1:${config.port} (loopback only)`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await app.stop(); store.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  return { app, store, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start(loadConfig()).catch(error => { console.error(`Startup failed: ${error.message}`); process.exitCode = 1; });
}
