const $ = id => document.getElementById(id);
const types = ['purchase_receipt','order_update','refund','subscription_charge','renewal_notice','trial_ending','subscription_cancelled','bill_issued','bill_reminder','payment_confirmation','autopay_scheduled','payment_failed','card_statement','bank_statement','loan_statement','brokerage_statement','transaction_alert','transfer_sent','transfer_received','income','installment_plan_created','installment_paid','installment_due','installment_failed','installment_late_fee','installment_plan_adjusted','installment_plan_paid_off','fee_or_interest','tax_document','insurance_premium','travel_booking','travel_change','promo','non_financial','unknown'];
const roles = ['charged','paid','refunded','amount_due','plan_total','installment_amount','minimum_due','fee','interest','subtotal','tax','shipping','discount','tip','offer_price','balance','future_renewal','received'];
let key = '', tab = 'ledger', offset = 0, nextOffset = null, selected = null, reviews = [];
let lastCoverage = null, loadSequence = 0, refreshing = false;
const human = value => value.replaceAll('_',' ');
const notify = text => { $('status').textContent = text; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${key}`, 'content-type':'application/json', ...options.headers } });
  if (!response.ok) { const error = await response.json(); throw new Error(human(error.error || 'Request failed')); }
  return path.includes('export.csv') || path.endsWith('/source') ? response.blob() : response.json();
}
const post = (path, value = {}) => api(path, { method: 'POST', body: JSON.stringify(value) });
const action = fn => async event => { event?.preventDefault(); try { await fn(event); } catch (error) { notify(error.message); } };
function option(select, value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; select.append(node); }
function download(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function refreshCoverage() {
  const value = await api('/api/coverage');
  lastCoverage = value;
  $('connection').textContent = value.mailbox ? `${value.mailbox} · ${human(value.connection)}` : 'Gmail not connected';
  $('stat-messages').textContent = value.counts.discovered.toLocaleString(); $('stat-accepted').textContent = value.ledger.accepted.toLocaleString();
  $('stat-review').textContent = value.counts.reviewItems.toLocaleString(); $('stat-pending').textContent = value.counts.pending.toLocaleString();
  $('coverage-note').textContent = value.scan?.enumerationCompleted ? `Mailbox scan finished · ${human(value.status)}` : value.sync ? `Full mailbox scan in progress · ${value.sync.listed || 0} messages listed` : 'Connect your Gmail to scan its entire retained history.';
  $('coverage-detail').textContent = JSON.stringify(value, null, 2);
  const progress = `${value.counts.processed ?? value.counts.discovered - value.counts.pending} of ${value.counts.discovered} downloaded emails processed. ${value.ledger.needsReview} financial records need review.`;
  $('processing-status').textContent = value.modelBudget?.paused
    ? `${progress} The daily model limit (${value.modelBudget.limit}) has been reached. ${value.modelBudget.resumesAt ? `Queued extraction resumes automatically at ${new Date(value.modelBudget.resumesAt).toLocaleString()}.` : 'Model calls are disabled by the configured limit.'}`
    : `${progress}${value.counts.modelPending ? ` ${value.counts.modelPending} emails await model extraction; likely financial emails run first.` : ''}`;
}
function formatMoney(row) {
  if (row.amountMinor === null || !row.currency) return 'Unknown';
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: row.currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(row.amountMinor / 10 ** digits);
}
async function load() {
  const sequence = ++loadSequence;
  const result = await api(`/api/${tab}?offset=${offset}&limit=50&includeReview=${$('include-review').checked}`);
  if (sequence !== loadSequence) return;
  nextOffset = result.nextOffset;
  $('record-count').textContent = `${result.total.toLocaleString()} ${tab === 'reviews' ? 'review items' : 'records'}`;
  $('page-label').textContent = result.total ? `${offset + 1}–${Math.min(offset + 50, result.total)} of ${result.total}` : '0 records';
  $('previous').disabled = offset === 0; $('next').disabled = nextOffset === null;
  $('empty').hidden = result.items.length > 0;
  $('empty').textContent = lastCoverage?.connection === 'connected'
    ? lastCoverage.counts.pending ? `No matching records extracted yet. ${lastCoverage.counts.pending} emails are still being processed. This list refreshes automatically.`
      : $('include-review').checked ? 'No matching records. Check the Review queue for unresolved financial emails.'
        : 'No accepted records yet. Enable “Include records needing review” to see flagged candidates.'
    : 'No records yet. Connect Gmail to start, or run the demo to explore sample emails.';
  const headers = tab === 'reviews' ? ['Email','Issue',''] : tab === 'messages' ? ['Received','Message','Outcome',''] : ['Date','Merchant / sender','Type','Amount','Status',''];
  $('table-head').replaceChildren(); const head = document.createElement('tr');
  for (const label of headers) { const th = document.createElement('th'); th.textContent = label; head.append(th); } $('table-head').append(head);
  $('table-body').replaceChildren();
  for (const row of result.items) {
    const tr = document.createElement('tr');
    const columns = tab === 'reviews' ? [row.message_id, human(row.reason.replace(/^(processing|ledger|audit):/,''))] : tab === 'messages' ? [row.received ? new Date(row.received).toLocaleDateString() : 'Unknown', row.id, human(row.disposition)] : [row.date || 'Unknown',row.merchant || 'Unknown',human(row.subtype || row.kind),formatMoney(row),human(row.status || row.quality)];
    for (const value of columns) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    const td = document.createElement('td'); const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'View source';
    button.addEventListener('click', action(() => openMessage(row.message_id || (tab === 'messages' ? row.id : row.sources[0].messageId)))); td.append(button); tr.append(td); $('table-body').append(tr);
  }
}
async function openMessage(id) {
  const value = await api(`/api/messages/${id}`);
  if (!value.document) { notify('This email has not been processed yet, or its source is unavailable.'); return; }
  selected = value;
  const { document: doc } = value; const n = doc.normalized; const ex = doc.extraction;
  if (!ex) { notify('Extraction failed. Reprocess this source before reviewing fields.'); return; }
  $('detail').hidden = false; $('detail-title').textContent = n.subject || 'Untitled email'; $('source-text').textContent = n.text;
  reviews = (await api('/api/reviews?limit=1000')).items.filter(r => r.message_id === id);
  $('detail-issues').textContent = reviews.length ? reviews.map(r => human(r.reason.replace(/^(processing|ledger|audit):/,''))).join(' · ') : 'No open review findings.';
  $('document-type').replaceChildren(); for (const type of types) option($('document-type'), type, human(type)); $('document-type').value = ex.type;
  $('amount-fields').replaceChildren();
  for (const money of n.money) {
    const label = document.createElement('label'); label.textContent = `${money.text} — ${money.context.slice(0, 100)}`;
    const select = document.createElement('select'); select.dataset.moneyIndex = money.index; option(select,'','Not used'); for (const role of roles) option(select,role,human(role));
    select.value = ex.amounts.find(a => a.moneyIndex === money.index)?.role || ''; label.append(select); $('amount-fields').append(label);
  }
  for (const [id, index] of [['transaction-date',ex.dateIndex],['due-date',ex.dueDateIndex]]) {
    $(id).replaceChildren(); option($(id),'',id === 'transaction-date' ? `Received date (${n.receivedDate || 'unknown'})` : 'Unknown / not applicable');
    for (const date of n.dates) option($(id),date.index,`${date.date} — ${n.text.slice(Math.max(0,date.start-35), date.end)}`); $(id).value = index ?? '';
  }
  $('entity-key').value = value.override?.entityKey || ''; $('review-note').value = ''; $('use-json').checked = false;
  $('extraction-json').value = JSON.stringify(ex,null,2); $('evidence-json').textContent = JSON.stringify({ money:n.money,dates:n.dates },null,2);
  $('acknowledgements').replaceChildren(); const legend = document.createElement('legend'); legend.textContent = 'Explicitly accept a limitation (requires a note)'; $('acknowledgements').append(legend);
  const items = [...n.issues.map(reason => ({reason,kind:'issue'})),...reviews.filter(r=>r.reason.startsWith('ledger:')).map(r=>({reason:r.reason.slice(7),kind:'check'}))];
  for (const item of items) { const label = document.createElement('label'); const input = document.createElement('input'); input.type='checkbox'; input.dataset.kind=item.kind; input.value=item.reason; label.append(input,` ${human(item.reason)}`); $('acknowledgements').append(label); }
  $('detail').scrollIntoView({ behavior:'smooth' });
}
$('unlock-form').addEventListener('submit',action(async()=>{ key=$('api-key').value.trim(); await refreshCoverage(); $('api-key').value=''; $('unlock').hidden=true; $('workspace').hidden=false; await load(); notify('Workspace unlocked.'); }));
$('connect').addEventListener('click',action(async()=>{ const result=await post('/api/oauth/start'); window.location.assign(result.url); }));
$('sync').addEventListener('click',action(async()=>{await post('/api/sync');notify('Sync queued.');}));
$('full-sync').addEventListener('click',action(async()=>{await post('/api/sync',{full:true});notify('Full rescan queued. Existing sources are reused.');}));
$('reprocess').addEventListener('click',action(async()=>{await post('/api/reprocess');notify('Saved emails queued for reprocessing.');await refreshCoverage();}));
$('disconnect').addEventListener('click',action(async()=>{await post('/api/disconnect');await refreshCoverage();notify('Disconnected. Saved history remains available.');}));
$('export').addEventListener('click',action(async()=>{download(await api('/api/export.csv'),'transactions.csv');}));
$('download-source').addEventListener('click',action(async()=>{download(await api(`/api/messages/${selected.message.id}/source`),'source.eml');}));
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',action(async()=>{tab=button.dataset.tab;offset=0;document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));await load();})));
$('include-review').addEventListener('change',action(async()=>{offset=0;await load();}));
$('previous').addEventListener('click',action(async()=>{offset=Math.max(0,offset-50);await load();})); $('next').addEventListener('click',action(async()=>{offset=nextOffset??offset;await load();}));
$('close-detail').addEventListener('click',()=>{$('detail').hidden=true;selected=null;});
$('review-form').addEventListener('submit',action(async()=>{
  let extraction=JSON.parse($('extraction-json').value);
  if (!$('use-json').checked) {
    extraction=structuredClone(selected.document.extraction);extraction.type=$('document-type').value;
    extraction.amounts=[...$('amount-fields').querySelectorAll('select')].filter(s=>s.value).map(s=>({role:s.value,moneyIndex:Number(s.dataset.moneyIndex)}));
    extraction.dateIndex=$('transaction-date').value===''?null:Number($('transaction-date').value); extraction.dueDateIndex=$('due-date').value===''?null:Number($('due-date').value);
  }
  const checked=[...$('acknowledgements').querySelectorAll('input:checked')];
  await post(`/api/messages/${selected.message.id}/review`,{extraction,note:$('review-note').value,entityKey:$('entity-key').value||undefined,acknowledgedIssues:checked.filter(c=>c.dataset.kind==='issue').map(c=>c.value),acknowledgedChecks:checked.filter(c=>c.dataset.kind==='check').map(c=>c.value)});
  notify('Review saved. Grounding checked and ledger rebuilt.');await refreshCoverage();await load();await openMessage(selected.message.id);
}));
$('audit').addEventListener('click',action(async()=>{
  let audit=await api('/api/audit'); if(!audit||audit.sample.every(r=>r.financial!==null))audit=await post('/api/audit',{count:100});
  $('audit-items').replaceChildren();
  for(const row of audit.sample.filter(r=>r.financial===null)){const div=document.createElement('p');const source=document.createElement('button');source.className='secondary';source.textContent=`Read ${row.messageId}`;source.addEventListener('click',action(()=>openMessage(row.messageId)));div.append(source);
    for(const [financial,label]of [[true,'Financial email'],[false,'Not financial']]){const button=document.createElement('button');button.className='secondary';button.textContent=label;button.addEventListener('click',action(async()=>{await post('/api/audit/label',{messageId:row.messageId,financial});div.remove();await refreshCoverage();}));div.append(' ',button);} $('audit-items').append(div);
  } notify(`${audit.sample.length} excluded messages sampled. Read each source before labeling.`);
}));
setInterval(async()=>{
  if(!key||$('workspace').hidden||refreshing)return;
  refreshing=true;
  try {await refreshCoverage();await load();}catch(error){notify(error.message);}finally{refreshing=false;}
},10000);
