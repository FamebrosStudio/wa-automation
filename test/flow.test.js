const { test } = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../src/services/flow');
const leads = require('../src/services/leads');

test('lead capture offers real choices and completion does not synthesize a lead message', () => {
  const phone = `flow-test-${Date.now()}`;
  flow.startFlow(phone);
  leads.classifyLead(phone, 'Alex', null);
  flow.processFlowResponse(phone, 'Alex');
  leads.classifyLead(phone, 'Bakery', null);
  const budgetPrompt = flow.processFlowResponse(phone, 'Bakery');
  assert.equal(budgetPrompt.step, 'budget');
  assert.deepEqual(budgetPrompt.options, ['Under 25K', '25K-50K', '50K-1L', '1L+']);

  leads.classifyLead(phone, 'flow_budget_1', null);
  const timelinePrompt = flow.processFlowResponse(phone, 'flow_budget_1');
  assert.equal(timelinePrompt.step, 'timeline');
  assert.deepEqual(timelinePrompt.options, ['Immediately', 'This month', 'Next month', 'Just exploring']);

  leads.classifyLead(phone, 'flow_timeline_1', null);
  const beforeComplete = leads.getLead(phone).messageCount;
  const complete = flow.processFlowResponse(phone, 'flow_timeline_1');
  assert.equal(complete.done, true);
  assert.equal(leads.getLead(phone).messageCount, beforeComplete);
  assert.equal(leads.getLead(phone).status, leads.STATUS.NON_CONFIRMED);
});

test('cancel removes the active flow', () => {
  const phone = `flow-cancel-${Date.now()}`;
  flow.startFlow(phone);
  assert.equal(flow.processFlowResponse(phone, 'cancel').cancelled, true);
  assert.equal(flow.hasActiveFlow(phone), false);
});

test('active flow can be snapshotted and restored after a cold start', () => {
  const phone = `flow-persist-${Date.now()}`;
  flow.startFlow(phone);
  flow.processFlowResponse(phone, 'Alex');
  const saved = flow.snapshotFlow(phone);
  flow.cancelFlow(phone);
  assert.equal(flow.hasActiveFlow(phone), false);
  flow.restoreFlow(phone, saved);
  assert.equal(flow.getCurrentStep(phone).step, 'business');
  assert.equal(flow.processFlowResponse(phone, 'Bakery').step, 'budget');
});

test('restoring one lead does not clear other cached leads or conversations', () => {
  const retained = `lead-retained-${Date.now()}`;
  const restored = `lead-restored-${Date.now()}`;
  leads.classifyLead(retained, 'hello', null);
  leads.addMessage(retained, 'user', 'keep me');
  leads.restoreOne({ phone: restored, lead: { phone: restored, status: leads.STATUS.NON_CONFIRMED, messageCount: 1 }, history: [{ role: 'user', content: 'persisted', ts: 1 }] });
  assert.equal(leads.getHistory(retained).at(-1).content, 'keep me');
  assert.equal(leads.getHistory(restored)[0].content, 'persisted');
});
