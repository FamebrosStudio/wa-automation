const express = require('express');
const config = require('./config');
const { handleIncoming } = require('./handlers/messageHandler');
const leads = require('./services/leads');
const firestore = require('./services/firestore');
const localCrm = new Map();

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-famebros-bot' });
});

// Webhook verification (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.verifyToken) {
    console.log('[webhook] verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.sendStatus(200);
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const messages = value.messages || [];
        for (const msg of messages) {
          const from = msg.from;
          if (!from) continue;
          if (msg.type === 'unknown') continue;
          console.log(`[webhook] incoming from ${from} type=${msg.type}`);
          await handleIncoming(msg, from);
        }
      }
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] processing error:', err.message);
    return res.sendStatus(503);
  }
});

function dashboardAuth(req, res, next) {
  if (!config.dashboardPassword) return res.status(503).send('Dashboard disabled: set DASHBOARD_PASSWORD to enable it.');
  const expected = `Basic ${Buffer.from(`${config.dashboardUser}:${config.dashboardPassword}`).toString('base64')}`;
  if (req.headers.authorization !== expected) {
    res.set('WWW-Authenticate', 'Basic realm="Lead dashboard"');
    return res.sendStatus(401);
  }
  next();
}

const LEAD_STATUSES = ['Qualified', 'Non-qualified'];
function normalizeLeadStatus(lead) {
  if (lead && lead.status !== 'Qualified') lead.status = 'Non-qualified';
  return lead;
}
function safeRecordId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

app.get('/leads/:id', dashboardAuth, async (req, res) => {
  if (!safeRecordId(req.params.id)) return res.sendStatus(400);
  try {
    const record = firestore.isConfigured()
      ? await firestore.getLead(req.params.id)
      : leads.snapshot().find((item) => firestore.recordId(item.phone) === req.params.id);
    if (!record) return res.sendStatus(404);
    const lead = normalizeLeadStatus(record.lead);
    res.json({ id: req.params.id, phone: lead.phone, lead, history: record.history || [], crm: record.crm || localCrm.get(req.params.id) || { owner: lead.assignedTeam || '', tags: lead.service ? [lead.service] : [], notes: JSON.stringify(lead.serviceDetails || {}) } });
  } catch (error) {
    console.error('[firestore] lead detail failed:', error.message);
    res.status(503).json({ error: 'Lead storage unavailable' });
  }
});

app.patch('/leads/:id', dashboardAuth, async (req, res) => {
  if (!safeRecordId(req.params.id)) return res.sendStatus(400);
  const { status, notes, tags, owner } = req.body || {};
  if (status !== undefined && !LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid lead status' });
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)) return res.status(400).json({ error: 'Notes must be text up to 5000 characters' });
  if (owner !== undefined && (typeof owner !== 'string' || owner.length > 120)) return res.status(400).json({ error: 'Owner must be text up to 120 characters' });
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 30 || tags.some((tag) => typeof tag !== 'string' || tag.length > 40))) {
    return res.status(400).json({ error: 'Tags must be up to 30 text labels (40 characters each)' });
  }
  try {
    let record;
    if (firestore.isConfigured()) record = await firestore.getLead(req.params.id);
    else record = leads.snapshot().find((item) => firestore.recordId(item.phone) === req.params.id);
    if (!record) return res.sendStatus(404);
    const crm = { ...(record.crm || {}) };
    if (notes !== undefined) crm.notes = notes;
    if (owner !== undefined) crm.owner = owner.trim();
    if (tags !== undefined) crm.tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    if (status !== undefined) record.lead.status = status;
    if (firestore.isConfigured()) await firestore.save([{ ...record, crm }]);
    else {
      record.crm = crm;
      localCrm.set(req.params.id, crm);
      leads.restore(leads.snapshot().map((item) => item.phone === record.phone ? record : item));
    }
    return res.json({ saved: true, status: record.lead.status, crm });
  } catch (error) {
    console.error('[firestore] lead update failed:', error.message);
    return res.status(503).json({ error: 'Lead storage unavailable' });
  }
});

// In-memory analytics are per process/instance, not durable or globally real-time.
app.get('/leads', dashboardAuth, async (req, res) => {
  let allLeads;
  let leadCrm = new Map();
  try {
    const records = await firestore.loadAll();
    allLeads = records ? records.map((record) => {
      const id = firestore.recordId(record.phone);
      leadCrm.set(id, record.crm || {});
      return normalizeLeadStatus(record.lead);
    }) : leads.getAllLeads();
  } catch (error) {
    console.error('[firestore] dashboard read failed:', error.message);
    return res.status(503).json({ error: 'Lead storage unavailable' });
  }
  res.json({
    total: allLeads.length,
    qualified: allLeads.filter(l => l.status === 'Qualified').length,
    nonQualified: allLeads.filter(l => l.status === 'Non-qualified').length,
    leads: allLeads.slice(-50).reverse().map((lead) => {
      const id = firestore.recordId(lead.phone);
      const crm = leadCrm.get(id) || localCrm.get(id) || {};
      return { ...lead, id, tags: crm.tags || (lead.service ? [lead.service] : []), owner: crm.owner || lead.assignedTeam || '', phone: undefined };
    }),
  });
});

// Minimal dashboard
app.get('/dashboard', dashboardAuth, (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leads</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;padding:20px}
.wrap{max-width:1000px;margin:0 auto}
h1{font-size:18px;font-weight:600;margin-bottom:16px;color:#fff}
.stats{display:flex;gap:12px;margin-bottom:20px}
.stat{flex:1;background:#1a1a1a;padding:16px;border-radius:8px;text-align:center}
.stat .n{font-size:24px;font-weight:700;color:#25D366}
.stat .l{font-size:12px;color:#888;margin-top:4px}
.card{background:#1a1a1a;border-radius:8px;overflow:hidden}
.row{padding:12px 16px;border-bottom:1px solid #2a2a2a;display:flex;justify-content:space-between;align-items:center}
.row:last-child{border-bottom:none}
.row .phone{font-weight:500;color:#fff}
.row .meta{font-size:12px;color:#888;margin-top:2px}
.badge{font-size:11px;padding:2px 8px;border-radius:4px;font-weight:500}
.q{background:#1a3a2a;color:#4ade80}
.nc{background:#3a3a1a;color:#facc15}
.nq{background:#3a1a1a;color:#f87171}
.empty{padding:40px;text-align:center;color:#555}
.refresh{margin-top:16px;text-align:center}
.refresh button{background:#25D366;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px}
.refresh button:hover{background:#1da851}
input,select,textarea{background:#111;color:#eee;border:1px solid #383838;border-radius:6px;padding:9px;font:inherit}
.filters{display:flex;gap:8px;margin:12px 0}.filters input{flex:1}
.layout{display:grid;grid-template-columns:1fr 1fr;gap:16px}.row{cursor:pointer}.row:hover{background:#222}
.panel{background:#1a1a1a;border-radius:8px;padding:16px;min-height:250px}.panel h2{font-size:16px;margin-bottom:10px}.panel label{display:block;font-size:12px;color:#aaa;margin:10px 0 5px}.panel input,.panel select,.panel textarea{width:100%}.panel textarea{min-height:72px;resize:vertical}.history{max-height:220px;overflow:auto;font-size:13px}.msg{padding:8px;border-bottom:1px solid #303030;white-space:pre-wrap;overflow-wrap:anywhere}.msg small{display:block;color:#888}.save{margin-top:12px;background:#25D366;color:#111;border:0;padding:9px 16px;border-radius:6px;cursor:pointer}
@media(max-width:700px){.layout{grid-template-columns:1fr}.filters{flex-direction:column}}
</style>
</head>
<body>
<div class="wrap">
<h1>Leads</h1>
<div class="stats">
<div class="stat"><div class="n" id="t">-</div><div class="l">Total</div></div>
<div class="stat"><div class="n" id="q">-</div><div class="l">Qualified</div></div>
<div class="stat"><div class="n" id="nq">-</div><div class="l">Non-qualified</div></div>
</div>
<p class="meta">New enquiries start as Non-qualified. Review their details, call them, then choose Qualified or Non-qualified and assign an owner/team.</p>
<div class="filters"><input id="search" placeholder="Search name, business, service, owner or tag"><select id="statusFilter"><option value="">All leads</option><option>Qualified</option><option>Non-qualified</option></select></div>
<div class="layout"><div class="card" id="list"><div class="empty">Loading...</div></div><section class="panel" id="detail"><div class="empty">Select a lead to view details</div></section></div>
<div class="refresh"><button onclick="load()">Refresh</button></div>
</div>
<script>
let leads=[];let selected=null;
async function load(){
try{
const r=await fetch('/leads');if(!r.ok)throw new Error('Dashboard data unavailable ('+r.status+')');const d=await r.json();
document.getElementById('t').textContent=d.total;
document.getElementById('q').textContent=d.qualified;
document.getElementById('nq').textContent=d.nonQualified;
leads=d.leads||[];renderList();
}catch(e){document.getElementById('list').replaceChildren(empty('Error: '+e.message))}
}
function renderList(){
const term=document.getElementById('search').value.toLowerCase();const status=document.getElementById('statusFilter').value;
  const shown=leads.filter(l=>(!status||l.status===status)&&(!term||[l.name,l.business,l.service,l.assignedTeam,l.status,...(l.interests||[]),...(l.tags||[]),l.owner].join(' ').toLowerCase().includes(term)));
const el=document.getElementById('list');
 if(!shown.length){el.replaceChildren(empty(leads.length?'No matching leads':'No leads yet'));return}
 el.replaceChildren(...shown.map(l=>{
  const row=document.createElement('div');row.className='row';
 const details=document.createElement('div');
  const name=document.createElement('div');name.className='phone';name.textContent=l.name||l.business||'Lead';
   const meta=document.createElement('div');meta.className='meta';meta.textContent=(l.service||'General enquiry')+' · '+(l.owner||'Unassigned')+' · '+(l.messageCount||0)+' msgs · '+(l.lastSeen||'');
 details.append(name,meta);
  const badge=document.createElement('span');badge.className='badge '+(l.status==='Qualified'?'q':'nq');badge.textContent=l.status||'';
  row.append(details,badge);row.onclick=()=>openLead(l.id);return row;
  }));
}
async function openLead(id){selected=id;const p=document.getElementById('detail');p.textContent='Loading…';try{const r=await fetch('/leads/'+encodeURIComponent(id));if(!r.ok)throw new Error('Could not load lead');const d=await r.json();const lead=d.lead,crm=d.crm||{};p.innerHTML='';
const title=document.createElement('h2');title.textContent=lead.name||lead.business||'Lead details';p.append(title);
const summary=document.createElement('div');summary.className='msg';summary.textContent='Service: '+(lead.service||'General enquiry')+' · Assigned: '+(crm.owner||lead.assignedTeam||'Unassigned')+' · Status: '+(lead.status||'Non-qualified');p.append(summary);
const facts=lead.serviceDetails||{};Object.entries(facts).forEach(([key,value])=>{const item=document.createElement('div');item.className='msg';item.textContent=key.replace(/([A-Z])/g,' $1')+': '+(typeof value==='string'?value:JSON.stringify(value));p.append(item)});
const phone=document.createElement('div');phone.className='meta';phone.textContent='Phone: '+d.phone;p.append(phone);
const history=document.createElement('div');history.className='history';(d.history||[]).forEach(m=>{const item=document.createElement('div');item.className='msg';const who=document.createElement('small');who.textContent=m.role+' · '+new Date(m.ts).toLocaleString();item.append(who,document.createTextNode(m.content));history.append(item)});p.append(history);
const field=(label,id,value,type='text')=>{const l=document.createElement('label');l.textContent=label;const i=document.createElement(type==='textarea'?'textarea':'input');i.id=id;i.value=value||'';p.append(l,i)};
const sl=document.createElement('label');sl.textContent='Lead status';const sel=document.createElement('select');sel.id='editStatus';['Qualified','Non-qualified'].forEach(v=>{const o=document.createElement('option');o.textContent=v;o.selected=lead.status===v;sel.append(o)});p.append(sl,sel);
field('Sales owner / assigned team','owner',crm.owner||lead.assignedTeam);field('Internal notes','notes',crm.notes,'textarea');field('Tags (comma separated)','tags',(crm.tags||[]).join(', '));
const btn=document.createElement('button');btn.className='save';btn.textContent='Save changes';btn.onclick=saveLead;p.append(btn);
}catch(e){p.textContent=e.message}}
async function saveLead(){const payload={status:document.getElementById('editStatus').value,notes:document.getElementById('notes').value,tags:document.getElementById('tags').value.split(',').map(x=>x.trim()).filter(Boolean),owner:document.getElementById('owner').value};const r=await fetch('/leads/'+encodeURIComponent(selected),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok){alert('Save failed ('+r.status+')');return}await load();await openLead(selected)}
function empty(text){const node=document.createElement('div');node.className='empty';node.textContent=text;return node}
document.getElementById('search').addEventListener('input',renderList);document.getElementById('statusFilter').addEventListener('change',renderList);load();setInterval(load,30000);
</script>
</body>
</html>`;
  res.type('html').send(html);
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
    console.log(`[server] webhook URL: http://localhost:${config.port}/webhook`);
    console.log(`[server] dashboard URL: http://localhost:${config.port}/dashboard`);
  });
}

module.exports = app;
