const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const page of [
  'form_data_intake', 'attendance_import_center', 'payroll_input_center',
  'employee_property_history', 'employee_separation_records',
]) {
  const source = fs.readFileSync(path.join(__dirname, `../hrms/hr/page/${page}/${page}.js`), 'utf8');
  const start = source.indexOf('\tis_active() {');
  const end = source.indexOf('\n\tactivate(', start);
  assert(start >= 0 && end > start, `${page} must expose a page activity check`);
  const active = vm.runInNewContext(`({${source.slice(start, end)}}).is_active`);
  const visible = { getClientRects: () => [{}], classList: { contains: () => false } };
  const hidden = { getClientRects: () => [], classList: { contains: () => true } };
  assert.equal(active.call({ wrapper: { closest: () => visible } }), true, `${page} must accept a visible Frappe page without an active class`);
  assert.equal(active.call({ wrapper: { closest: () => hidden } }), false, `${page} must ignore a hidden cached page`);
}

console.log('Visible Frappe pages remain active without an active CSS class.');
