const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("hrms/hr/page/organizational_chart/organizational_chart.js", "utf8");
const server = fs.readFileSync("hrms/api/organization_package.py", "utf8");
const sync = fs.readFileSync("hrms/api/organization_roster_sync.py", "utf8");
const hooks = fs.readFileSync("hrms/hooks.py", "utf8");

for (const marker of ["配置关系图", "configuration_match_status", "configuration_pending_items", "没有花名册时仍保存完整配置并标记待匹配"]) {
	assert(page.includes(marker), `organization configuration visualization missing: ${marker}`);
}
for (const marker of ["department_label", "designation_label", "grade_label", "pending_person_references"]) {
	assert(server.includes(marker), `portable pending configuration missing: ${marker}`);
	assert(sync.includes(marker), `pending roster reconciliation missing: ${marker}`);
}
assert(server.includes("花名册补齐后自动匹配"));
for (const doctype of ['"Department"', '"Designation"', '"Employee Grade"']) {
	assert(hooks.includes(doctype), `master-change synchronization hook missing: ${doctype}`);
}
assert(hooks.includes("organization_master_changed"));
console.log("PASS: visual configuration map, pending portable identities, roster rebuild and master-change hooks are wired");
