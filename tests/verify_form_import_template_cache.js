const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../hrms/public/js/hrms_contextual_form_import.js'), 'utf8');
const getTemplate = source.slice(source.indexOf('\tfunction get_template(template_key) {'), source.indexOf('\n\tfunction download_template('));
let calls = 0;
let now = 1;
const context = {
  templatesPromise: null,
  templatesLoadedAt: 0,
  Date: { now: () => now },
  Promise,
  API: 'hrms.api.form_data_intake',
  frappe: {
    call: () => { calls++; return Promise.resolve({ message: [{ key: 'a' }, { key: 'b' }] }); },
    throw: message => { throw Error(message); },
  },
  __: text => text,
};
vm.createContext(context);
vm.runInContext(getTemplate, context);

(async () => {
  const [a, b] = await Promise.all([context.get_template('a'), context.get_template('b')]);
  assert.equal(a.key, 'a');
  assert.equal(b.key, 'b');
  assert.equal(calls, 1, 'simultaneous import buttons share the template request');
  await context.get_template('a');
  assert.equal(calls, 1, 'a recent template response is reused');
  now += 30_001;
  await context.get_template('a');
  assert.equal(calls, 2, 'the registry refreshes after its short TTL');
  console.log('Form import template requests are reused and refreshed after 30 seconds.');
})().catch(error => { console.error(error); process.exitCode = 1; });
