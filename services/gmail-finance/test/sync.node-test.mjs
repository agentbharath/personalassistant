import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { eml } from './fixtures.mjs';
import { syncStep } from '../src/sync.mjs';
import { requestJson, Gmail, beginOAuth, finishOAuth, GMAIL_SCOPE, RemoteError } from '../src/gmail.mjs';

function fakeGmail() {
  const fetched=[];return { fetched,profile:async()=>({historyId:'100',messagesTotal:3}),
    list:async token=>token?{messages:[{id:'c'}]}:{messages:[{id:'a'},{id:'b'}],nextPageToken:'page-2'},
    raw:async id=>{fetched.push(id);return{raw:eml('Receipt',`Order ID: ORD-${id}\nTotal: USD 10.00`).toString('base64url'),internalDate:String(Date.now())};},
    history:async()=>({historyId:'102',history:[{messagesAdded:[{message:{id:'d'}}]}]})};
}
test('backfill pages all mail, replays captured baseline and advances only after storing',async t=>{
  const {store}=setup(t);const gmail=fakeGmail();await syncStep(store,gmail);
  assert.equal(store.get('sync').pageToken,'page-2');assert.equal(store.get('sync').baselineHistoryId,'100');
  await syncStep(store,gmail);assert.equal(store.get('sync').mode,'delta');assert.equal(store.get('sync').historyId,'100');
  await syncStep(store,gmail);assert.equal(store.get('sync').historyId,'102');assert.equal(store.get('sync').mode,'idle');assert.ok(store.message('d'));
  assert.equal(store.get('coverage').enumerationCompleted,true);
});
test('partial-page failure replays without re-fetching committed messages',async t=>{
  const {store}=setup(t);const gmail=fakeGmail();const original=gmail.raw;let failed=false;
  gmail.raw=async id=>{if(id==='b'&&!failed){failed=true;throw new RemoteError('gmail',503);}return original(id);};
  await assert.rejects(()=>syncStep(store,gmail));assert.equal(store.get('sync').pageToken,null);assert.ok(store.message('a'));
  store.set('sync',{...store.get('sync'),retryAt:0});await syncStep(store,gmail);
  assert.deepEqual(gmail.fetched,['a','b']);assert.equal(store.get('sync').listed,2);
});
test('expired history triggers full rescan including old imported mail',async t=>{
  const {store}=setup(t);const gmail=fakeGmail();store.set('sync',{mode:'idle',historyId:'1'});
  gmail.history=async()=>{throw new RemoteError('gmail',404);};await syncStep(store,gmail);
  assert.equal(store.get('sync').mode,'backfill');assert.equal(store.get('sync').pageToken,null);assert.equal(store.get('coverage').enumerationCompleted,false);
});
test('unavailable listed mail receives explicit disposition and review',async t=>{
  const {store}=setup(t);const gmail=fakeGmail();gmail.raw=async()=>{throw new RemoteError('gmail',404);};await syncStep(store,gmail);
  assert.equal(store.message('a').disposition,'unavailable');assert.equal(store.reviews().length,2);assert.equal(store.get('sync').listed,2);
});
test('Gmail listing includes spam/trash and has no restrictive query',async t=>{
  const {store,config}=setup(t);store.set('connection',{status:'connected'});
  const fake=async url=>{const parsed=new URL(url);assert.equal(parsed.searchParams.get('includeSpamTrash'),'true');assert.equal(parsed.searchParams.has('q'),false);return new Response('{}');};
  const gmail=new Gmail(config,store,fake);gmail.access={token:'fake',expires:Date.now()+100000};await gmail.list();
});
test('retries 429 and honors Retry-After',async()=>{
  let calls=0;const waits=[];const result=await requestJson('https://example.com',{},async()=>++calls===1?new Response('{}',{status:429,headers:{'retry-after':'2'}}):new Response('{"ok":true}'),async ms=>waits.push(ms));
  assert.equal(result.ok,true);assert.ok(waits[0]>=2000);assert.equal(calls,2);
});
test('revoked refresh token pauses connection without deleting history',async t=>{
  const {store,config}=setup(t);store.set('connection',{status:'connected'});store.set('tokens',{refreshToken:'fake'});
  const gmail=new Gmail(config,store,async()=>new Response('{"error":"invalid_grant"}',{status:400}));
  await assert.rejects(()=>gmail.accessToken());assert.equal(store.get('connection').status,'reauth_required');
});
test('OAuth binds state to browser, uses PKCE/read-only and rejects replay',async t=>{
  const {store,config}=setup(t);const begin=beginOAuth(config,store);const url=new URL(begin.url);
  assert.equal(url.searchParams.get('scope'),GMAIL_SCOPE);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const query=new URLSearchParams({state:url.searchParams.get('state'),code:'fake'});
  await assert.rejects(()=>finishOAuth(config,store,query,'wrong'),/invalid_oauth_state/);
  let calls=0;const fetcher=async(url,init)=>{calls++;if(String(url).includes('/token')){assert.ok(new URLSearchParams(init.body).get('code_verifier'));return new Response(JSON.stringify({access_token:'access',refresh_token:'refresh',scope:GMAIL_SCOPE}));}return new Response('{"emailAddress":"owner@example.com"}');};
  await finishOAuth(config,store,query,begin.binding,fetcher);assert.equal(store.get('connection').status,'connected');assert.equal(calls,2);
  await assert.rejects(()=>finishOAuth(config,store,query,begin.binding,fetcher),/invalid_oauth_state/);
});
test('OAuth refuses a mailbox other than the configured owner',async t=>{
  const {store,config}=setup(t);const begin=beginOAuth(config,store);const query=new URLSearchParams({state:new URL(begin.url).searchParams.get('state'),code:'fake'});
  const fetcher=async url=>new Response(JSON.stringify(String(url).includes('/token')?{access_token:'a',refresh_token:'r',scope:GMAIL_SCOPE}:{emailAddress:'stranger@example.com'}));
  await assert.rejects(()=>finishOAuth(config,store,query,begin.binding,fetcher),/mailbox_does_not_match/);assert.equal(store.get('tokens'),null);
});
