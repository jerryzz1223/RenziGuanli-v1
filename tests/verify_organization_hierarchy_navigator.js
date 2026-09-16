const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const js = read("hrms", "hr", "page", "organizational_chart", "organizational_chart.js");
const css = read("hrms", "hr", "page", "organizational_chart", "organizational_chart.css");
const py = read("hrms", "hr", "page", "organizational_chart", "organizational_chart.py");
const roster = read("hrms", "api", "organization_roster.py");
const template = read("hrms", "api", "organization_template.py");

function includes(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

for (const marker of [
	"层级通讯录",
	"树状架构图",
	"render_employee_avatar",
	"safe_avatar_url",
	"上级组织",
	"本级包含",
	"包含 {0} 人 · {1} 个直属下级",
	"hrms-org-roster-person",
	"hrms-org-avatar--roster",
]) includes(js, marker, "Organization navigator is missing the reviewed hierarchy or avatar behavior.");

for (const marker of [
	".hrms-org-relation-summary",
	".hrms-org-list-identity",
	".hrms-org-containment",
	".hrms-org-roster-list",
	".hrms-org-avatar img",
]) includes(css, marker, "Organization navigator styles are incomplete.");

for (const source of [py, roster]) {
	includes(source, '"image"', "Roster-backed organization responses must include employee avatars.");
	includes(source, '"reports_to"', "Roster-backed organization responses must preserve supervisor references.");
}
includes(template, '"image": person.get("image")', "Organization card people must carry employee avatars.");

if (!/\^\(\?:https\?:\\\/\\\/\|\\\/[\s\S]*\)\/i\.test\(url\)/.test(js)) {
	throw new Error("Employee avatars must reject non-HTTP and non-site-relative URLs.");
}

console.log("PASS: hierarchy navigator exposes parent/containment context and roster-backed employee avatars");
