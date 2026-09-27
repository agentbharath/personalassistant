import { resolve } from 'node:path';

export function config(env = process.env) {
  const port = Number(env.PORT || 4318);
  const result = {
    port, host: '127.0.0.1', dataDir: resolve(env.DATA_DIR || './data'),
    apiKey: env.SERVICE_API_KEY || '', encryptionKey: env.ENCRYPTION_KEY || '',
    googleClientId: env.GOOGLE_CLIENT_ID || '', googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${port}/oauth/callback`,
    allowedEmail: (env.GOOGLE_ALLOWED_EMAIL || '').trim().toLowerCase(),
    homeCurrency: env.HOME_CURRENCY || 'USD', timeZone: env.TIME_ZONE || 'UTC',
    modelKey: env.ANTHROPIC_API_KEY || '', model: env.ANTHROPIC_MODEL || '',
    modelDailyLimit: Number(env.MODEL_DAILY_CALL_LIMIT || 100),
    pollSeconds: Number(env.POLL_INTERVAL_SECONDS || 900),
  };
  if (result.apiKey.length < 32) throw new Error('SERVICE_API_KEY must be at least 32 characters; run npm run init.');
  if (!/^[a-f0-9]{64}$/i.test(result.encryptionKey)) throw new Error('ENCRYPTION_KEY must be 32 random bytes in hex; run npm run init.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT');
  if (!Number.isInteger(result.modelDailyLimit) || result.modelDailyLimit < 0) throw new Error('Invalid MODEL_DAILY_CALL_LIMIT');
  if (!Number.isFinite(result.pollSeconds) || result.pollSeconds < 30) throw new Error('POLL_INTERVAL_SECONDS must be at least 30');
  new Intl.DateTimeFormat('en', { timeZone: result.timeZone }).format();
  new Intl.NumberFormat('en', { style: 'currency', currency: result.homeCurrency }).format(0);
  if (!/^[A-Z]{3}$/.test(result.homeCurrency)) throw new Error('Invalid HOME_CURRENCY');
  const redirect = new URL(result.redirectUri);
  if (redirect.origin !== `http://127.0.0.1:${port}` || redirect.pathname !== '/oauth/callback') {
    throw new Error('Personal service redirect must be http://127.0.0.1:PORT/oauth/callback');
  }
  return result;
}
