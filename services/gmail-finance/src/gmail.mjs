import { randomBytes, createHash } from 'node:crypto';

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export class RemoteError extends Error {
  constructor(service, status, code = '') { super(`${service}_http_${status}`); this.status = status; this.code = code; }
}

export async function requestJson(url, init = {}, fetcher = fetch, sleeper = ms => new Promise(r => setTimeout(r, ms))) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let response;
    try { response = await fetcher(url, { ...init, signal: AbortSignal.timeout(45000) }); }
    catch (error) {
      if (attempt === 4) throw new RemoteError('network', 0);
      await sleeper(500 * 2 ** attempt); continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return payload;
    const code = typeof payload.error === 'string' ? payload.error : payload.error?.errors?.[0]?.reason || '';
    const retryable = response.status === 429 || response.status >= 500 || (response.status === 403 && ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(code));
    if (retryable && attempt < 4) {
      const retryAfter = response.headers.get('retry-after');
      const requested = retryAfter ? /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
      // Longer provider delays are persisted by the worker rather than blocking the process.
      if (requested > 60000) { const error = new RemoteError('remote', response.status, code); error.retryAfter = requested; throw error; }
      await sleeper(Math.max(requested || 0, 500 * 2 ** attempt + Math.random() * 250)); continue;
    }
    throw new RemoteError('remote', response.status, code);
  }
}

export function beginOAuth(config, store) {
  if (!config.googleClientId || !config.googleClientSecret || !config.allowedEmail) throw new Error('google_oauth_configuration_required');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const binding = randomBytes(32).toString('base64url');
  store.set('oauth', { state, verifier, binding, expires: Date.now() + 600000 });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.googleClientId, redirect_uri: config.redirectUri,
    response_type: 'code', scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent',
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    login_hint: config.allowedEmail }).toString();
  return { url: url.toString(), binding };
}

export async function finishOAuth(config, store, query, binding, fetcher = fetch) {
  const pending = store.get('oauth');
  if (!pending || pending.expires < Date.now() || query.get('state') !== pending.state || binding !== pending.binding) throw new Error('invalid_oauth_state');
  store.set('oauth', null); // Single use, including denied/failed callbacks.
  if (query.get('error') || !query.get('code')) throw new Error('oauth_denied');
  const token = await requestJson('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret,
      redirect_uri: config.redirectUri, code: query.get('code'), code_verifier: pending.verifier, grant_type: 'authorization_code' }).toString(),
  }, fetcher);
  if (!token.access_token || !token.refresh_token || !token.scope?.split(' ').includes(GMAIL_SCOPE)) throw new Error('gmail_readonly_offline_grant_required');
  const profile = await requestJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${token.access_token}` } }, fetcher);
  if (profile.emailAddress.toLowerCase() !== config.allowedEmail) throw new Error('mailbox_does_not_match_configured_owner');
  const previous = store.get('mailbox');
  if (previous?.email && previous.email !== profile.emailAddress.toLowerCase()) throw new Error('different_mailbox_requires_new_data_directory');
  store.set('mailbox', { email: profile.emailAddress.toLowerCase(), connectedAt: new Date().toISOString() });
  store.set('tokens', { refreshToken: token.refresh_token });
  store.set('connection', { status: 'connected' });
  store.log('gmail.connected', {});
  return profile;
}

export class Gmail {
  constructor(config, store, fetcher = fetch) { this.config = config; this.store = store; this.fetcher = fetcher; this.access = null; }
  async accessToken() {
    if (this.store.get('connection')?.status !== 'connected') throw new Error('gmail_not_connected');
    if (this.access && this.access.expires > Date.now()) return this.access.token;
    const refresh = this.store.get('tokens')?.refreshToken;
    if (!refresh) throw new Error('gmail_not_connected');
    try {
      const token = await requestJson('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.config.googleClientId, client_secret: this.config.googleClientSecret,
          refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
      }, this.fetcher);
      if (!token.access_token) throw new Error('invalid_token_response');
      this.access = { token: token.access_token, expires: Date.now() + (Number(token.expires_in || 3600) - 60) * 1000 };
      return this.access.token;
    } catch (error) {
      if (error.code === 'invalid_grant') { this.store.set('connection', { status: 'reauth_required' }); this.store.log('gmail.reauth_required', {}); }
      throw error;
    }
  }
  async get(path, query = {}, retry401 = true) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
    url.search = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== null && value !== undefined)).toString();
    try { return await requestJson(url, { headers: { authorization: `Bearer ${await this.accessToken()}` } }, this.fetcher); }
    catch (error) {
      if (error.status === 401 && retry401) { this.access = null; return this.get(path, query, false); }
      throw error;
    }
  }
  profile() { return this.get('profile'); }
  list(pageToken) { return this.get('messages', { maxResults: '100', includeSpamTrash: 'true', pageToken }); }
  raw(id) { return this.get(`messages/${encodeURIComponent(id)}`, { format: 'raw' }); }
  history(historyId, pageToken) { return this.get('history', { startHistoryId: historyId, historyTypes: 'messageAdded', maxResults: '100', pageToken }); }
}
