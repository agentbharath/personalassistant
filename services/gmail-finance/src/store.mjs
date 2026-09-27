import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');

export class Store {
  constructor(directory, key) {
    this.key = Buffer.from(key, 'hex');
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    mkdirSync(join(directory, 'blobs'), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'finance.sqlite'));
    chmodSync(join(directory, 'finance.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, received INTEGER NOT NULL, raw_hash TEXT,
        disposition TEXT NOT NULL DEFAULT 'pending', payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_disposition ON messages(disposition, received);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
        version TEXT NOT NULL, payload TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS current_documents (
        message_id TEXT PRIMARY KEY REFERENCES messages(id), document_id TEXT NOT NULL REFERENCES documents(id));
      CREATE TABLE IF NOT EXISTS overrides (id TEXT PRIMARY KEY REFERENCES messages(id), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_queue (
        message_id TEXT PRIMARY KEY REFERENCES messages(id), priority INTEGER NOT NULL,
        retry_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id),
        reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, kind TEXT NOT NULL, date TEXT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, created TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scan_seen (id TEXT PRIMARY KEY REFERENCES messages(id), generation TEXT NOT NULL);`);
    try {
      const check = this.get('key-check');
      if (check !== null && check !== 'gmail-finance-v1') throw new Error('Wrong encryption key');
    } catch (error) { this.db.close(); throw error; }
    this.set('key-check', 'gmail-finance-v1');
  }
  seal(value, context) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  open(value, context) {
    const bytes = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  }
  get(id) {
    const row = this.db.prepare('SELECT payload FROM settings WHERE id=?').get(id);
    return row ? this.open(row.payload, `settings:${id}`) : null;
  }
  set(id, value) {
    this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
      .run(id, this.seal(value, `settings:${id}`));
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  raw(id, bytes) {
    const digest = hash(bytes);
    const path = join(this.directory, 'blobs', digest);
    if (!existsSync(path)) writeFileSync(path, this.seal(bytes.toString('base64'), `raw:${digest}`), { mode: 0o600, flag: 'wx' });
    return digest;
  }
  readRaw(digest) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid blob digest');
    const bytes = Buffer.from(this.open(readFileSync(join(this.directory, 'blobs', digest), 'utf8'), `raw:${digest}`), 'base64');
    if (hash(bytes) !== digest) throw new Error('Raw source integrity failure');
    return bytes;
  }
  message(id) {
    const row = this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    return row ? { ...row, ...this.open(row.payload, `messages:${id}`), payload: undefined } : null;
  }
  ingest(id, raw, metadata) {
    const existing = this.message(id);
    if (existing?.raw_hash) return existing;
    const digest = raw ? this.raw(id, raw) : null;
    this.db.prepare(`INSERT INTO messages VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      received=excluded.received,raw_hash=excluded.raw_hash,disposition=excluded.disposition,payload=excluded.payload`)
      .run(id, metadata.received || 0, digest, raw ? 'pending' : 'unavailable', this.seal(metadata, `messages:${id}`));
    if (!raw) this.review(id, 'source_unavailable', { detail: 'Listed by Gmail but unavailable when fetched.' });
    return this.message(id);
  }
  saveDocument(id, document) {
    const documentId = hash(`${id}:${JSON.stringify(document)}`);
    this.atomic(() => {
      this.db.prepare('INSERT OR IGNORE INTO documents VALUES (?,?,?,?,?)').run(documentId, id, document.version,
        this.seal(document, `documents:${documentId}`), new Date().toISOString());
      this.db.prepare(`INSERT INTO current_documents VALUES (?,?) ON CONFLICT(message_id) DO UPDATE SET document_id=excluded.document_id`).run(id, documentId);
      this.db.prepare('UPDATE messages SET disposition=? WHERE id=?').run(document.disposition, id);
      if (document.disposition === 'awaiting_model') {
        this.db.prepare(`INSERT INTO model_queue(message_id,priority) VALUES (?,?)
          ON CONFLICT(message_id) DO UPDATE SET priority=excluded.priority`).run(id, document.modelPriority || 0);
      } else this.db.prepare('DELETE FROM model_queue WHERE message_id=?').run(id);
      this.db.prepare("UPDATE reviews SET status='superseded' WHERE message_id=? AND reason LIKE 'processing:%' AND status='open'").run(id);
      for (const reason of document.issues) this.review(id, `processing:${reason}`, {});
    });
    return documentId;
  }
  document(id) {
    const row = this.db.prepare(`SELECT d.id,d.payload FROM current_documents c JOIN documents d ON d.id=c.document_id WHERE c.message_id=?`).get(id);
    return row ? { ...this.open(row.payload, `documents:${row.id}`), id: row.id, messageId: id } : null;
  }
  documents() {
    return this.db.prepare('SELECT message_id FROM current_documents ORDER BY message_id').all().map(row => this.document(row.message_id));
  }
  review(messageId, reason, detail) {
    const id = hash(`${messageId}:${reason}`);
    this.db.prepare(`INSERT INTO reviews VALUES (?,?,?,'open',?) ON CONFLICT(id) DO UPDATE SET status='open',payload=excluded.payload`)
      .run(id, messageId, reason, this.seal(detail, `reviews:${id}`));
    return id;
  }
  reviews() {
    return this.db.prepare("SELECT * FROM reviews WHERE status='open' ORDER BY message_id,reason").all()
      .map(row => ({ ...this.open(row.payload, `reviews:${row.id}`), ...row, payload: undefined }));
  }
  override(id) {
    const row = this.db.prepare('SELECT payload FROM overrides WHERE id=?').get(id);
    return row ? this.open(row.payload, `overrides:${id}`) : null;
  }
  putOverride(id, value) {
    this.atomic(() => {
      this.log('review.override', { messageId: id, before: this.override(id), after: value });
      this.db.prepare('INSERT INTO overrides VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id, this.seal(value, `overrides:${id}`));
    });
  }
  log(action, detail) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO audit VALUES (?,?,?)').run(id, new Date().toISOString(), this.seal({ action, ...detail }, `audit:${id}`));
  }
  ledger() {
    return this.db.prepare('SELECT * FROM ledger ORDER BY date,id').all().map(row => this.open(row.payload, `ledger:${row.id}`));
  }
  replaceLedger(records) {
    this.atomic(() => {
      this.db.exec('DELETE FROM ledger');
      for (const record of records) this.db.prepare('INSERT INTO ledger VALUES (?,?,?,?)').run(record.id, record.kind, record.date || null, this.seal(record, `ledger:${record.id}`));
    });
  }
  close() { this.db.close(); }
}
