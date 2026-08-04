const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const employeeList = fs.readFileSync(
	path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"),
	"utf8",
);
const employeeApi = fs.readFileSync(
	path.join(root, "hrms", "api", "employee_field_template.py"),
	"utf8",
);

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) {
		throw new Error(message || `Missing marker: ${marker}`);
	}
}

for (const marker of [
	"bind_natural_employee_code_sorting(listview)",
	"sort_roster_by_employee_code(this)",
	'sort_by !== "custom_employee_code"',
	'numeric: true',
	"populated.concat(blank)",
]) {
	mustInclude(employeeList, marker, `标准员工花名册缺少工号自然排序契约：${marker}`);
}

for (const marker of [
	"def _employee_business_code_sort_key(row):",
	"def _sort_employee_roster_by_business_code(rows, sort_order):",
	're.split(r"(\\d+)", value)',
	'if sort_field == "custom_employee_code":',
	"_sort_employee_roster_by_business_code(all_rows, sort_order)",
]) {
	mustInclude(employeeApi, marker, `员工档案库接口缺少工号自然排序契约：${marker}`);
}

const sample = ["260613", "260707", "2636", "43", "4228", "87", "281"];
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
const ascending = [...sample].sort(collator.compare);
const descending = [...ascending].reverse();

if (ascending.join(",") !== "43,87,281,2636,4228,260613,260707") {
	throw new Error(`工号升序必须按数字自然顺序，当前为：${ascending.join(",")}`);
}
if (descending.join(",") !== "260707,260613,4228,2636,281,87,43") {
	throw new Error(`工号降序必须按数字自然顺序，当前为：${descending.join(",")}`);
}

console.log("Employee roster business-code sorting verification passed.");
