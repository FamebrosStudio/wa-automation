const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ExcelJS = require('exceljs');

test('CRM export is an authenticated Excel workbook with lead and conversation sheets', async () => {
  process.env.DASHBOARD_USER = 'export-test';
  process.env.DASHBOARD_PASSWORD = 'export-password';
  const leads = require('../src/services/leads');
  leads.restore([]);
  const phone = '919876543210';
  leads.updateLead(phone, {
    name: 'Priya Sharma', business: 'Priya Kitchen', category: 'Food & Beverage',
    service: 'Social Media Management', status: 'Non-confirmed',
    instagram: 'https://www.instagram.com/priyakitchen/',
    serviceDetails: { customerType: 'I own a business', category: 'Food & Beverage' },
  });
  leads.addMessage(phone, 'user', 'Hi, I need social media help');

  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/index.js') && request === './services/firestore') {
      return { isConfigured: () => false, loadAll: async () => null, recordId: (value) => Buffer.from(value).toString('base64url') };
    }
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/index.js') && request === './handlers/messageHandler') {
      return { handleIncoming: async () => ({ ignored: true }) };
    }
    return realLoad.call(this, request, parent, isMain);
  };

  let server;
  try {
    delete require.cache[require.resolve('../src/index')];
    const app = require('../src/index');
    server = app.listen(0);
    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const denied = await fetch(`${root}/leads/export`);
    assert.equal(denied.status, 401);
    const auth = `Basic ${Buffer.from('export-test:export-password').toString('base64')}`;
    const response = await fetch(`${root}/leads/export`, { headers: { authorization: auth } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml\.sheet/);
    assert.match(response.headers.get('content-disposition'), /famebros-crm-\d{4}-\d{2}-\d{2}\.xlsx/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    assert.equal(workbook.worksheets.length, 2);
    const leadsSheet = workbook.getWorksheet('Leads');
    assert.equal(leadsSheet.getCell('B2').value, 'Priya Sharma');
    assert.equal(leadsSheet.getCell('E2').value, 'Food & Beverage');
    assert.equal(leadsSheet.getCell('K2').value, 'https://www.instagram.com/priyakitchen/');
    assert.equal(workbook.getWorksheet('Conversation history').getCell('F2').value, 'Hi, I need social media help');
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    Module._load = realLoad;
    delete require.cache[require.resolve('../src/index')];
    delete process.env.DASHBOARD_USER;
    delete process.env.DASHBOARD_PASSWORD;
  }
});
