import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({queues: {} as Record<string, unknown[]>, writes: [] as {table: string; value: Record<string, unknown>}[], filters: [] as unknown[][]}));
vi.mock("@/lib/security/encryption", () => ({encryptText: (s: string) => `enc:${s}`, decryptText: (s: string) => s.replace(/^enc:/, "")}));
vi.mock("@/lib/security/pii-hmac", () => ({piiHmac: (s: string) => `hash:${s}`}));
vi.mock("@/lib/supabase/admin", () => ({createAdminClient: () => ({from: (table: string) => {
 const q: unknown = new Proxy({}, {get: (_target, key) => {
   if (key === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(db.queues[table]?.shift() ?? {data: [], error: null}).then(resolve);
   if (key === "update" || key === "insert") return (value: Record<string, unknown>) => {db.writes.push({table, value}); return q;};
   return (...args: unknown[]) => {db.filters.push([table, key, ...args]); return q;};
 }}); return q;
}})}));
import { finishSync, claimSync, queueSync, settleSyncCandidates, type SyncState } from "./store";
const state = {user_id: "u", run_id: "run", status: "review", scan_from: "2026-09-01T00:00:00Z", scan_through: "2026-09-22T00:00:00Z", synced_through: null, covered_from: null, version: 2, lease_until: null} as SyncState;
beforeEach(() => {db.queues = {}; db.writes = []; db.filters = [];});
it.each(["pending", "blocked"])("does not advance the watermark while any %s candidate remains", async status => {
 db.queues.finance_sync_state = [{data: state}]; db.queues.finance_import_candidates = [{data: [{id: "one", status}]}];
 await finishSync("u", "run"); expect(db.writes).toEqual([]);
});
it.each(["queued", "running", "blocked"])("does not advance a %s scan even without candidates", async status => {
 db.queues.finance_sync_state = [{data: {...state, status}}];
 await finishSync("u", "run"); expect(db.writes).toEqual([]);
});
it("advances coverage only for the completed resolved run, scoped to its user", async () => {
 db.queues.finance_sync_state = [{data: state}, {error: null}];
 await finishSync("u", "run");
 expect(db.writes[0].value).toMatchObject({status: "idle", synced_through: state.scan_through, covered_from: state.scan_from});
 expect(db.filters).toContainEqual(["finance_sync_state", "eq", "user_id", "u"]);
 expect(db.filters).toContainEqual(["finance_sync_state", "eq", "run_id", "run"]);
});
it("does not advance for an obsolete run ID", async () => {
 db.queues.finance_sync_state = [{data: state}]; await finishSync("u", "old-run"); expect(db.writes).toEqual([]);
});
it("claims with a version guard and does not steal an unexpired lease", async () => {
 expect(await claimSync({...state, status: "running", lease_until: new Date(Date.now() + 60000).toISOString()})).toBeNull();
 expect(db.writes).toEqual([]);
 db.queues.finance_sync_state = [{data: {...state, status: "running"}}];
 await claimSync({...state, status: "queued"});
 expect(db.filters).toContainEqual(["finance_sync_state", "eq", "version", 2]);
 expect(db.writes[0].value.lease_id).toBeTruthy();
});
it("starts the initial full-history scan and freezes its query boundaries", async () => {
 db.queues.finance_sync_state = [{data: null}, {data: state}];
 await queueSync("u", undefined, false, Date.parse("2026-09-22T10:00:00Z"));
 const write = db.writes[0].value;
 expect(write.scan_from).toBe("1970-01-01T00:00:00.000Z");
 expect(write.scan_through).toBe("2026-09-22T10:00:00.000Z");
 expect(String(write.cursor_ciphertext)).not.toContain("after:");
 expect(String(write.cursor_ciphertext)).not.toContain("newer_than");
});
it("never replaces an unfinished scan with a requested backfill", async () => {
 db.queues.finance_sync_state = [{data: state}]; expect(await queueSync("u", undefined, true)).toEqual(state); expect(db.writes).toEqual([]);
});
it("rejects only candidate IDs covered by this user's reviewed batch", async () => {
 db.queues.finance_sync_state = [{data: state}]; db.queues.finance_import_candidates = [{error: null}, {data: [{id: "still-pending"}]}];
 await settleSyncCandidates("u", "run", ["shown"], "rejected");
 expect(db.filters).toContainEqual(["finance_import_candidates", "in", "id", ["shown"]]);
 expect(db.filters).toContainEqual(["finance_import_candidates", "eq", "run_id", "run"]);
 expect(db.filters).toContainEqual(["finance_import_candidates", "eq", "user_id", "u"]);
 expect(db.writes).toHaveLength(1);
});
it("incremental sync starts from the previous coverage with overlap",async()=>{
 db.queues.finance_sync_state=[{data:{...state,status:"idle",synced_through:"2026-09-21T10:00:00Z"}},{data:state}];
 await queueSync("u",undefined,false,Date.parse("2026-09-22T10:00:00Z"));
 expect(db.writes[0].value.scan_from).toBe("2026-09-20T10:00:00.000Z");
});
it("explicit full-history backfill has no lower Gmail date bound",async()=>{
 db.queues.finance_sync_state=[{data:{...state,status:"idle",synced_through:"2026-09-21T10:00:00Z"}},{data:state}];
 await queueSync("u",undefined,"all",Date.parse("2026-09-22T10:00:00Z"));
 expect(db.writes[0].value.scan_from).toBe("1970-01-01T00:00:00.000Z");
 expect(String(db.writes[0].value.cursor_ciphertext)).not.toContain("after:");
});
