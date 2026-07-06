const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function mustExist(file) {
	const full = path.join(root, file);
	if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
	return full;
}

function read(file) {
	return fs.readFileSync(mustExist(file), "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

const api = read("hrms/api/payroll_input.py");
for (const marker of [
	"WELFARE_SOURCE_DOCTYPE",
	"WELFARE_SOURCE_RULES",
	"WELFARE_SOURCE_VARIABLE_TYPE_MAP",
	"list_payroll_welfare_source_rules",
	"upsert_payroll_welfare_source_record",
	"list_payroll_welfare_source_records",
	"sync_welfare_sources_to_payroll_variables",
	"学历补贴",
	"租房补贴",
	"宿舍住宿费",
	"宿舍水电费",
	"社保个人",
	"公积金个人",
	"社保公司",
	"公积金公司",
	"提案改善奖",
	"继续服务奖",
	"所得税",
	"水电费及扣款",
]) {
	mustInclude(api, marker, `Welfare source API is missing marker: ${marker}`);
}

const pageJs = read("hrms/hr/page/payroll_input_center/payroll_input_center.js");
for (const marker of [
	"welfare-sources",
	"福利扣款",
	"福利扣款来源中心",
	"新增来源",
	"同步到薪资变量",
	"list_payroll_welfare_source_rules",
	"upsert_payroll_welfare_source_record",
	"list_payroll_welfare_source_records",
	"sync_welfare_sources_to_payroll_variables",
	"学历补贴资格与月报",
	"租房补贴申请/登记/月度明细",
	"宿舍入住/退宿/水电住宿费",
	"社保公积金个人/公司承担",
]) {
	mustInclude(pageJs, marker, `Payroll center page is missing welfare marker: ${marker}`);
}

const workbenchJs = read("hrms/hr/page/hrms_workbench/hrms_workbench.js");
const workbenchPy = read("hrms/hr/page/hrms_workbench/hrms_workbench.py");
for (const marker of ["福利扣款", "welfare-sources", "福利扣款来源中心"]) {
	mustInclude(workbenchJs + workbenchPy, marker, `Workbench is missing welfare source marker: ${marker}`);
}

const sourceJson = read("hrms/hr/doctype/hrms_payroll_welfare_source_record/hrms_payroll_welfare_source_record.json");
const sourcePy = read("hrms/hr/doctype/hrms_payroll_welfare_source_record/hrms_payroll_welfare_source_record.py");
for (const marker of [
	"HRMS Payroll Welfare Source Record",
	"福利扣款来源记录",
	"payroll_month",
	"source_type",
	"variable_type",
	"direction",
	"amount",
	"eligibility_status",
	"confirmation_status",
	"source_reference",
	"rule_snapshot",
]) {
	mustInclude(sourceJson, marker, `Welfare source DocType is missing marker: ${marker}`);
}
mustInclude(sourcePy, "Document", "Welfare source controller must extend Document.");

console.log("Payroll welfare source center contract passed.");
