import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadConfig } from './config.mjs';
import { Store, hash } from './store.mjs';
import { processPending } from './pipeline.mjs';
import { coverage } from './coverage.mjs';
import { csv, rebuild } from './ledger.mjs';
import { start } from './server.mjs';

process.umask(0o077);
const command = process.argv[2];
if (command === 'init') {
  if (existsSync('.env')) throw new Error('.env already exists; keep its encryption key to preserve access to your archive.');
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    .replace('SERVICE_API_KEY=\n', `SERVICE_API_KEY=${randomBytes(32).toString('hex')}\n`)
    .replace('ENCRYPTION_KEY=\n', `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`);
  writeFileSync('.env', template, { mode: 0o600, flag: 'wx' });
  console.log('Created .env with random service/encryption keys. Add your Google OAuth credentials and Gmail address, then run npm start.');
} else if (command === 'demo') {
  const { samples } = await import('../test/fixtures.mjs');
  mkdirSync('demo-data', { recursive: true, mode: 0o700 });
  const envFile = resolve('demo-data/demo.env');
  if (!existsSync(envFile)) writeFileSync(envFile, `PORT=4320\nDATA_DIR=./demo-data\nSERVICE_API_KEY=${randomBytes(32).toString('hex')}\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nGOOGLE_REDIRECT_URI=http://127.0.0.1:4320/oauth/callback\nTIME_ZONE=America/Los_Angeles\n`, { mode: 0o600, flag: 'wx' });
  const env = Object.fromEntries(readFileSync(envFile,'utf8').trim().split('\n').map(line=>[line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
  const config = loadConfig(env); // Demo never uses live Gmail/model credentials from the parent environment.
  const store = new Store(config.dataDir, config.encryptionKey);
  for (const [name, raw] of samples) store.ingest(`eml_${name}`, raw, { received: Date.parse('2026-09-26T17:00:00Z'), origin: 'demo' });
  while (await processPending(store, config, 20)) { /* Drain fixture queue. */ }
  rebuild(store);
  console.log(JSON.stringify(coverage(store), null, 2));
  writeFileSync('demo-data/transactions.csv', csv(store.ledger().filter(row=>row.quality==='accepted'&&!['obligation','statement'].includes(row.kind))));
  store.close();
  console.log(`Demo API key is in ${envFile}. Open http://127.0.0.1:4320 and paste SERVICE_API_KEY. Demo uses synthetic mail only.`);
  if (!process.argv.includes('--no-server')) await start(config);
} else if (command === 'import') {
  const paths = process.argv.slice(3);
  if (!paths.length) throw new Error('Usage: npm run import -- file.eml [more.eml ...]');
  const config = loadConfig(); const store = new Store(config.dataDir, config.encryptionKey);
  try {
    for (const path of paths) {
      const raw = readFileSync(path);
      // Received metadata cannot be reconstructed reliably from arbitrary files. Require explicit review.
      store.ingest(`eml_${hash(raw)}`, raw, { received: 0, origin: 'eml' });
    }
    while (await processPending(store, config, 20)) {}
    console.log(JSON.stringify(coverage(store), null, 2));
  } finally { store.close(); }
} else {
  console.error('Commands: init | demo [--no-server] | import file.eml [more.eml]'); process.exitCode = 1;
}
