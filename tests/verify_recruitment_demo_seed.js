const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const seedPath = path.join(root, "hrms", "api", "recruitment_demo_seed.py");

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

assert(fs.existsSync(seedPath), "招聘试用种子脚本必须存在。");
const source = fs.readFileSync(seedPath, "utf8");

for (const marker of [
	'COMPANY = "TEST-HRMS"',
	"def seed_recruitment_demo",
	"def _require_test_company",
	"Job Opening Template",
	"Interview Type",
	"Job Offer Term Template",
	"Staffing Plan",
	"Job Requisition",
	"Job Opening",
	"Job Applicant",
	"Interview Feedback",
	"Job Offer",
	"生产操作员",
	"质量检验员",
	"HR 初筛",
	"部门技术面",
	"Awaiting Response",
	"Accepted",
]) {
	assert(source.includes(marker), `招聘试用种子缺少必要契约: ${marker}`);
}

assert(source.includes('if company != COMPANY:'), "种子必须拒绝非 TEST-HRMS 公司。");
assert(source.includes('frappe.db.exists("Company", COMPANY)'), "种子必须先验证 TEST-HRMS 公司存在。");
assert(!source.includes("frappe.delete_doc"), "招聘试用种子不得删除既有数据。");
assert(!source.includes('"永新"'), "招聘试用种子不得引用真实公司永新。");

const interviewTypeSeed = source
	.split("def _ensure_interview_type", 2)[1]
	.split("def _ensure_offer_template", 2)[0];
assert(
	interviewTypeSeed.includes('doc = frappe.new_doc("Interview Type")'),
	"Interview Type 的必填 expected_skill_set 必须在新建文档首次 insert 前写入。"
);

const interviewSeed = source
	.split("def _ensure_interview(", 2)[1]
	.split("def _ensure_feedback", 2)[0];
assert(
	interviewSeed.indexOf("doc.reload()") < interviewSeed.indexOf("doc.submit()"),
	"Interview 的 set-only-once 时间字段必须在 submit 前 reload，避免首次 insert 的类型转换冲突。"
);

const applicantSeed = source
	.split("def _ensure_applicant", 2)[1]
	.split("def _ensure_interview(", 2)[0];
assert(
	applicantSeed.includes('existing_values.pop("status")'),
	"重复执行种子不得把已接受 Offer 的候选人重置回 Shortlisted。"
);

console.log("Recruitment demo seed contract is valid.");
