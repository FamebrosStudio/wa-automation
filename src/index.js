const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
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

const LEAD_STATUSES = ['Qualified', 'Non-confirmed', 'Non-qualified'];
function normalizeLeadStatus(lead) {
  if (lead && !LEAD_STATUSES.includes(lead.status)) lead.status = null;
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
    nonConfirmed: allLeads.filter(l => l.status === 'Non-confirmed').length,
    nonQualified: allLeads.filter(l => l.status === 'Non-qualified').length,
    leads: allLeads.slice().reverse().map((lead) => {
      const id = firestore.recordId(lead.phone);
      const crm = leadCrm.get(id) || localCrm.get(id) || {};
      return { ...lead, id, tags: crm.tags || (lead.service ? [lead.service] : []), owner: crm.owner || lead.assignedTeam || '', phone: undefined };
    }),
  });
});

app.get('/dashboard', dashboardAuth, (req, res) => {
  res.type('html').send(fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'));
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
    console.log(`[server] webhook URL: http://localhost:${config.port}/webhook`);
    console.log(`[server] dashboard URL: http://localhost:${config.port}/dashboard`);
  });
}

module.exports = app;
