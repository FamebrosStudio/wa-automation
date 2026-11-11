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
  assert.equal(leads.getLead(phone).status, null);
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
  leads.restoreOne({ phone: restored, lead: { phone: restored, status: leads.STATUS.NON_QUALIFIED, messageCount: 1 }, history: [{ role: 'user', content: 'persisted', ts: 1 }] });
  assert.equal(leads.getHistory(retained).at(-1).content, 'keep me');
  assert.equal(leads.getHistory(restored)[0].content, 'persisted');
});

test('social media service asks one detail at a time, validates Instagram URLs, and saves details as collected', () => {
  const phone = `service-social-${Date.now()}`;
  const first = flow.startServiceFlow(phone, 'social');
  assert.match(first.intro, /complete Social Media Management/);
  assert.deepEqual(first.options, ['I own a business']);
  assert.equal(flow.getCurrentStep(phone).step, 'businessOwner');
  flow.processFlowResponse(phone, '1');
  assert.equal(flow.getCurrentStep(phone).step, 'clientName');
  assert.equal(flow.getCurrentStep(phone).question, 'What is your name?');
  flow.processFlowResponse(phone, 'Priya Sharma');
  assert.equal(flow.getCurrentStep(phone).step, 'category');
  assert.equal(leads.getLead(phone).name, 'Priya Sharma');
  assert.deepEqual(flow.getCurrentStep(phone).options, [
    'Food & Beverage', 'Fashion & Beauty', 'Health & Fitness', 'Home & Real Estate',
    'Retail & E-commerce', 'Education', 'Professional Services', 'Other',
  ]);
  flow.processFlowResponse(phone, '1');
  assert.equal(flow.getCurrentStep(phone).step, 'instagram');
  const invalid = flow.processFlowResponse(phone, 'not a url');
  assert.equal(invalid.invalid, true);
  assert.equal(flow.getCurrentStep(phone).step, 'instagram', 'invalid input must keep asking for the Instagram link');
  assert.equal(leads.getLead(phone).instagram, undefined);
  const complete = flow.processFlowResponse(phone, 'https://www.instagram.com/example/');
  assert.equal(complete.done, true);
  assert.equal(leads.getLead(phone).service, 'Social Media Management');
  assert.equal(leads.getLead(phone).assignedTeam, null);
  assert.equal(leads.getLead(phone).status, null);
  assert.equal(leads.getLead(phone).name, 'Priya Sharma');
  assert.equal(leads.getLead(phone).category, 'Food & Beverage');
  assert.equal(leads.getLead(phone).serviceDetails.instagram, 'https://www.instagram.com/example/');
});

test('legacy social flows resume at the first newly required detail', () => {
  const phone = `service-social-legacy-${Date.now()}`;
  flow.restoreFlow(phone, { service: 'social', step: 'instagram', data: { customerType: 'I own a business' }, history: ['identity'] });
  assert.equal(flow.getCurrentStep(phone).step, 'clientName');
  assert.equal(flow.processFlowResponse(phone, 'Priya').step, 'category');
});

test('Instagram link validation accepts only profile URLs on Instagram', () => {
  assert.equal(flow.normalizeInstagramProfileUrl('instagram.com/shop.name'), 'https://www.instagram.com/shop.name/');
  for (const invalid of [
    'example.com/shop', 'https://instagram.com.evil.example/shop', 'https://instagram.com/p/abc',
    'https://instagram.com/explore', 'javascript:alert(1)', 'https://instagram.com/a/b', '@shop',
  ]) assert.equal(flow.normalizeInstagramProfileUrl(invalid), null, invalid);
});

test('Meta Ads captures business details and goal without auto-assigning the lead', () => {
  const phone = `service-ads-${Date.now()}`;
  flow.startServiceFlow(phone, 'ads');
  flow.processFlowResponse(phone, 'Fame Bakery');
  flow.processFlowResponse(phone, 'Mumbai');
  flow.processFlowResponse(phone, 'Cakes');
  flow.processFlowResponse(phone, 'https://instagram.com/famebakery');
  const complete = flow.processFlowResponse(phone, '1');
  assert.equal(complete.done, true);
  assert.equal(leads.getLead(phone).assignedTeam, null);
  assert.equal(leads.getLead(phone).status, null);
  assert.equal(leads.getLead(phone).business, 'Fame Bakery');
  assert.equal(leads.getLead(phone).serviceDetails.goal, 'WhatsApp Enquiries');
});
