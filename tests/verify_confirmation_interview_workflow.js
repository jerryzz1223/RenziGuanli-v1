const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const json = JSON.parse(
	fs.readFileSync(path.join(root, "hrms", "hr", "doctype", "employee_promotion", "employee_promotion.json"), "utf8"),
);
const python = fs.readFileSync(
	path.join(root, "hrms", "hr", "doctype", "employee_promotion", "employee_promotion.py"),
	"utf8",
);
const form = fs.readFileSync(
	path.join(root, "hrms", "hr", "doctype", "employee_promotion", "employee_promotion.js"),
	"utf8",
);
const detail = fs.readFileSync(
	path.join(root, "hrms", "hr", "page", "employee_detail", "employee_detail.js"),
	"utf8",
);
const roster = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

const fields = Object.fromEntries(json.fields.map((field) => [field.fieldname, field]));
for (const fieldname of [
	"custom_confirmation_interview_date",
	"custom_confirmation_interviewer",
	"custom_confirmation_interview_notes",
	"custom_confirmation_result",
	"custom_is_confirmation_interview",
]) {
	if (!fields[fieldname]) throw new Error(`转正面谈缺少字段：${fieldname}`);
}

if (fields.custom_confirmation_result.options !== "转正通过\n转正不通过") {
	throw new Error("转正结果只能为通过或不通过。");
}

mustInclude(detail, '__("转正面谈")', "试用期员工入口必须明确为转正面谈。");
mustInclude(detail, "custom_is_confirmation_interview: 1", "转正面谈入口必须保留独立流程标记。");
mustInclude(detail, '"在职 · 试用期"', "员工详情应显示在职与试用期的组合状态。");
mustInclude(roster, '"在职 · 正式"', "花名册应显示在职正式员工的组合状态。");
mustInclude(form, "转正不通过不会修改员工档案", "不通过时前端必须清理档案调整项。");
mustInclude(python, "CONFIRMATION_REJECTED", "后端必须识别转正不通过。");
mustInclude(python, "if self.custom_confirmation_result == CONFIRMATION_REJECTED:\n\t\t\treturn", "转正不通过不得更新员工档案。");
mustInclude(python, "请填写转正面谈记录", "提交前必须记录面谈内容。");

if (python.includes("待审批") || form.includes("待审批") || JSON.stringify(json).includes("待审批")) {
	throw new Error("转正流程不应出现待审批状态。");
}

console.log("confirmation interview workflow verified");
