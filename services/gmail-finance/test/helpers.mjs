import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.mjs';

export function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gmail-finance-test-'));
  const config = { encryptionKey: randomBytes(32).toString('hex'), apiKey: randomBytes(32).toString('hex'),
    dataDir: directory, homeCurrency: 'USD', timeZone: 'America/Los_Angeles', modelKey: '', model: '',
    modelDailyLimit: 100, pollSeconds: 900, port: 4318, host: '127.0.0.1', allowedEmail: 'owner@example.com',
    googleClientId: 'test-client', googleClientSecret: 'test-secret', redirectUri: 'http://127.0.0.1:4318/oauth/callback' };
  const store = new Store(directory, config.encryptionKey);
  t.after(() => { try { store.close(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  return { config, store, directory };
}
