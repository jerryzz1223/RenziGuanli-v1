const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const program = JSON.parse(read("hrms", "hr", "doctype", "training_program", "training_program.json"));
const event = JSON.parse(read("hrms", "hr", "doctype", "training_event", "training_event.json"));
const resultEmployee = JSON.parse(read("hrms", "hr", "doctype", "training_result_employee", "training_result_employee.json"));
const feedback = JSON.parse(read("hrms", "hr", "doctype", "training_feedback", "training_feedback.json"));
const programList = read("hrms", "hr", "doctype", "training_program", "training_program_list.js");
const programController = read("hrms", "hr", "doctype", "training_program", "training_program.py");
const resultController = read("hrms", "hr", "doctype", "training_result", "training_result.py");
const feedbackController = read("hrms", "hr", "doctype", "training_feedback", "training_feedback.py");
const trainingCss = read("hrms", "public", "css", "hrms_training_learning.css");
const nav = read("hrms", "public", "js", "hrms_top_nav.js");
const sidebar = read("hrms", "public", "js", "hrms_home_redirect_v6.js");

for (const field of ["approval_status", "owner_department", "plan_period", "training_category", "training_mode", "is_mandatory", "objective"]) {
	assert(program.fields.some((item) => item.fieldname === field), `培训计划缺少字段：${field}`);
}
for (const field of ["training_category", "training_mode", "assessment_required", "passing_score", "retraining_due_on", "qualification_gate"]) {
	assert(event.fields.some((item) => item.fieldname === field), `培训活动缺少字段：${field}`);
}
for (const field of ["score", "assessment_result", "needs_retraining"]) assert(resultEmployee.fields.some((item) => item.fieldname === field));
assert(feedback.fields.some((item) => item.fieldname === "satisfaction_score"));
for (const marker of ["set_assessment_outcomes", "event_status = \"Completed\"", "sync_passed_training_to_skill_map", "assessment_result == \"Pass\""]) assert(resultController.includes(marker));
assert(feedbackController.includes("满意度评分必须介于 1 到 5 分之间"));
for (const marker of ["培训闭环", "培训待办", "近期培训活动", "培训计划清单", "get_training_learning_dashboard", "新建培训计划"]) assert(programList.includes(marker));
for (const marker of ["get_training_learning_dashboard", "_attendance_summary", "needs_retraining", "retraining_due_on"]) assert(programController.includes(marker));
for (const marker of [".hrms-training-learning-workspace", ".hrms-training-summary", "@media (max-width: 767px)"]) assert(trainingCss.includes(marker));
assert(nav.includes('route: "/desk/training-program"'), "培训学习必须保留原培训计划入口。");
assert(!nav.includes("training-learning-center"), "不得新增不可见的培训中心页面。");
assert(sidebar.includes('{ type: "link", label: "主页", route: "/desk/training-program", slug: "training-program" }'));
assert(sidebar.includes("function redirect_legacy_training_learning_center()"), "旧培训中心地址必须自动回到原培训计划。");
assert(sidebar.includes('frappe.set_route("List", "Training Program")'), "旧地址必须回到已有的培训计划列表。");
console.log("existing training learning workflow verified");
