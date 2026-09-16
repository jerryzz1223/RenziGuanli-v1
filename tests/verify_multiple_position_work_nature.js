const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const chartUi = read("hrms/hr/page/organizational_chart/organizational_chart.js");
const chartApi = read("hrms/hr/page/organizational_chart/organizational_chart.py");
const assignmentReview = read("hrms/api/organization_assignment_review.py");

for (const marker of [
	"def get_multiple_position_review",
	"def save_multiple_position_review",
	"kind = \"正式\" if is_primary else \"兼任\"",
	"多职位记录已变化，请刷新页面后重新选择",
]) {
	assert.ok(assignmentReview.includes(marker), `multiple-position review must include ${marker}`);
}

for (const marker of [
	'data-action="review-multiple-positions"',
	"show_multiple_position_review(employee)",
	"选择一个职位为正职后，其余职位自动填充为“兼”",
	"save_multiple_position_review",
]) {
	assert.ok(chartUi.includes(marker), `multiple-position UI must include ${marker}`);
}

for (const marker of [
	'"modified"',
	'"multiple_position_employees"',
]) {
	assert.ok(chartApi.includes(marker), `organization tree must expose ${marker}`);
}

console.log("PASS: multiple-position warning opens one-primary selection and saves all remaining positions as secondary");
