const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchKeyword, MAIN_MENU, WELCOME } = require('../src/data/knowledge');

test('keyword matching does not treat short substrings as intents', () => {
  assert.equal(matchKeyword('I need advice for a new campaign'), null);
  assert.equal(matchKeyword('Can you explain your workflow?'), 'process');
  assert.equal(matchKeyword('What is your pricing?'), 'packages');
});

test('generic keywords do not route ordinary questions', () => {
  assert.equal(matchKeyword('Can you help me choose a campaign?'), null);
  assert.equal(matchKeyword('Who will do the work?'), null);
  assert.equal(matchKeyword('I have a question about my business'), null);
});

test('standalone greetings and specific phrases still route', () => {
  assert.equal(matchKeyword('hi'), 'menu');
  assert.equal(matchKeyword('what is your pricing?'), 'packages');
  assert.equal(matchKeyword('who have you worked with?'), 'clients');
  assert.equal(matchKeyword('talk to a human'), 'human');
});

test('welcome shows clickable service choices with the expected route IDs', () => {
  const rows = MAIN_MENU.sections.flatMap((section) => section.rows);
  assert.match(WELCOME, /Hi! 👋 Welcome to Famebros Studio/);
  assert.deepEqual(rows.map((row) => row.id), [
    'service_social', 'service_ads', 'service_photo', 'service_website', 'service_other', 'service_team',
  ]);
  assert.match(rows[1].description, /Facebook and Instagram lead campaigns/);
  assert.notEqual(rows[2].title, rows[2].description, 'menu title and description should not repeat each other');
  assert.match(rows[2].description, /Product, food/);
});
