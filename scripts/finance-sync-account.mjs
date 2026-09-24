// Operational worker for an explicitly selected account; this is not an evaluation.
// node --env-file=.env.local scripts/finance-sync-account.mjs <conversation-id> [--watch]
import { createServer } from 'vite';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const conversationId = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(conversationId ?? '')) throw new Error('Pass an existing conversation UUID for the account to process');
const server = await createServer({configFile:false, server:{middlewareMode:true}, resolve:{alias:{'@':resolve('src')}}});
try {
 const {createAdminClient} = await server.ssrLoadModule('/src/lib/supabase/admin.ts');
 const {queueSync, enabled} = await server.ssrLoadModule('/src/lib/finance-sync/store.ts');
 const {advanceFinanceSync} = await server.ssrLoadModule('/src/lib/finance-sync/runner.ts');
 const {withRequestContext} = await server.ssrLoadModule('/src/lib/runtime/request-context.ts');
 if (!enabled()) throw new Error('FINANCE_SYNC_ENABLED must be true');
 const {data:chat,error} = await createAdminClient().from('conversations').select('user_id').eq('id',conversationId).single();
 if(error || !chat) throw new Error('Account lookup failed');
 await queueSync(chat.user_id, undefined, 'all');
 do {
  const state = await withRequestContext({userId:chat.user_id,requestId:randomUUID(),startedAt:Date.now(),deadlineAt:Date.now()+60000,costLimitUsd:0.15},()=>advanceFinanceSync(chat.user_id,45000));
  console.log(JSON.stringify({status:state?.status,checked:state?.checked,lastError:state?.last_error}));
  if(!process.argv.includes('--watch') || !state || !['queued','running'].includes(state.status)) break;
  await new Promise(resolve=>setTimeout(resolve,state.last_error?.includes("budget") ? 900000 : 60000));
 } while(true);
} finally {await server.close();}
