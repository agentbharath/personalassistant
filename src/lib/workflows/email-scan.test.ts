import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, fail: false, transient: 0, lostResponse: false }));
vi.mock("@/lib/security/encryption", () => ({
  encryptText: (value: string) => `encrypted:${Buffer.from(value).toString("base64")}`,
  decryptText: (value: string) => Buffer.from(value.slice(10), "base64").toString(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  let mutation: Record<string, unknown> | undefined;
  let inserting = false;
  const execute = () => {
    if (db.transient > 0) { db.transient--; return { data: null, error: { code: "", name: "TypeError" } }; }
    if (db.fail) return {data:null,error:new Error("database unavailable")};
    if (inserting) {
      if (db.rows.some(row => row.user_id === mutation?.user_id && row.request_id === mutation?.request_id)) return {data:null,error:{code:"23505"}};
      const row={id:`s${db.rows.length}`,version:1,updated_at:new Date().toISOString(),...mutation};db.rows.push(row);return {data:[row],error:null};
    }
    const found=db.rows.filter(row=>filters.every(filter=>filter(row)));
    if(mutation)for(const row of found)Object.assign(row,mutation);
    if (mutation && db.lostResponse) { db.lostResponse = false; return { data: null, error: { code: "", name: "TypeError" } }; }
    return {data:found.map(row=>({...row})),error:null};
  };
  const query = {
    select: () => query,
    eq: (key:string,value:unknown) => {filters.push(row=>row[key]===value);return query;},
    in: (key:string,values:unknown[]) => {filters.push(row=>values.includes(row[key]));return query;},
    insert: (value:Record<string,unknown>) => {mutation=value;inserting=true;return query;},
    update: (value:Record<string,unknown>) => {mutation=value;return query;},
    maybeSingle: async () => {const result=execute();return {...result,data:result.data?.[0]??null};},
    single: async () => query.maybeSingle(),
    then: (resolve:(value:unknown)=>unknown) => Promise.resolve(execute()).then(resolve),
  };
  return query;
} }) }));
import { acquireEmailScan, cancelEmailScan, saveEmailScan, emailScanContinuationNote, ScanBusyError, ScanStoppedError, requestEmailScanStop } from "./email-scan";

beforeEach(()=>{db.rows=[];db.fail=false;db.transient=0;db.lostResponse=false;});

it("persists encrypted progress and restores it within the same user and conversation", async()=>{
  const handle=(await acquireEmailScan("u","c",{remaining:["private-message"],ready:["amount"]}))!;
  expect(JSON.stringify(db.rows)).not.toContain("private-message");
  await saveEmailScan(handle,"paused");
  expect(await acquireEmailScan("other","c")).toBeNull();
  expect(await acquireEmailScan("u","different")).toBeNull();
  const restored=await acquireEmailScan<typeof handle.data>("u","c");
  expect(restored?.data).toEqual(handle.data);
  expect(restored?.version).toBeGreaterThan(handle.version);
});

it("refuses simultaneous continuations and fences out a stale writer",async()=>{
  const original=(await acquireEmailScan("u","c",{remaining:3}))!;
  await expect(acquireEmailScan("u","c")).rejects.toBeInstanceOf(ScanBusyError);
  await saveEmailScan(original,"paused");
  const next=(await acquireEmailScan("u","c"))!;
  await expect(saveEmailScan(original,"paused")).rejects.toBeInstanceOf(ScanBusyError);
  expect(db.rows[0].version).toBe(next.version);
});

it("recovers an interrupted request after its lease expires",async()=>{
  const handle=(await acquireEmailScan("u","c",{remaining:3}))!;
  db.rows[0].updated_at=new Date(Date.now()-301000).toISOString();
  expect((await acquireEmailScan("u","c"))?.data).toEqual(handle.data);
});

it("does not resume cancelled or expired scans",async()=>{
  const handle=(await acquireEmailScan("u","c",{remaining:3}))!;
  await saveEmailScan(handle,"paused");
  expect(await cancelEmailScan("other","c")).toBe(false);
  expect(await cancelEmailScan("u","c")).toBe(true);
  expect(await acquireEmailScan("u","c")).toBeNull();
  db.rows[0].state="paused";
  db.rows[0].updated_at=new Date(Date.now()-8*86400000).toISOString();
  expect(await acquireEmailScan("u","c")).toBeNull();
});

it("does not claim progress was saved when the database rejects the write",async()=>{
  const handle=(await acquireEmailScan("u","c",{remaining:3}))!;
  db.fail=true;
  await expect(saveEmailScan(handle,"paused")).rejects.toThrow("database unavailable");
});

it("keeps Continue available after a partial confirmation but not for completed scans",async()=>{
  const handle=(await acquireEmailScan("u","c",{remaining:3}))!;
  await saveEmailScan(handle,"paused");
  expect(await emailScanContinuationNote("u","c")).toContain("**Continue scan**");
  expect(await emailScanContinuationNote("other","c")).toBe("");
  await saveEmailScan(handle,"completed");
  expect(await emailScanContinuationNote("u","c")).toBe("");
});

it("retries a transient checkpoint write without losing progress", async () => {
  const handle = (await acquireEmailScan("u", "c", { checked: 19 }))!;
  db.transient = 1;
  await saveEmailScan(handle, "paused");
  expect((await acquireEmailScan("u", "c"))?.data).toEqual({ checked: 19 });
});
it("recognizes its committed checkpoint after a lost HTTP response", async () => {
  const handle = (await acquireEmailScan("u", "c", { checked: 19 }))!;
  const version = handle.version;
  db.lostResponse = true;
  await saveEmailScan(handle, "paused");
  expect(handle.version).toBe(version + 1);
  expect(db.rows[0].version).toBe(version + 1);
});

it("saves in-flight progress on Stop before releasing the lease for Continue", async () => {
  const handle = (await acquireEmailScan("u", "c", { checked: 19 }))!;
  await requestEmailScanStop("other", "c");
  expect(db.rows[0].state).toBe("running");
  await requestEmailScanStop("u", "c");
  await expect(acquireEmailScan("u", "c")).rejects.toBeInstanceOf(ScanBusyError);
  handle.data.checked = 25;
  await expect(saveEmailScan(handle)).rejects.toBeInstanceOf(ScanStoppedError);
  expect(db.rows[0].state).toBe("paused");
  expect((await acquireEmailScan("u", "c"))?.data).toEqual({ checked: 25 });
  await saveEmailScan(handle, "completed");
  expect(db.rows[0].state).toBe("running");
});
