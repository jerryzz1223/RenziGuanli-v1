const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const api = read("hrms/api/employee_form_entry.py");
const submitPage = read("hrms/public/js/hrms_employee_form_entry.js");
const navigation = read("hrms/public/js/hrms_home_redirect_v6.js");
const talkPage = read("hrms/hr/page/employee_talk_form/employee_talk_form.js");
const dutyPage = read("hrms/hr/page/employee_duty_change/employee_duty_change.js");
const rewardPage = read("hrms/hr/page/employee_reward_form/employee_reward_form.js");
const detail = read("hrms/api/employee_field_template.py");
const detailPage = read("hrms/hr/page/employee_detail/employee_detail.js");
const sidebar = JSON.parse(read("hrms/workspace_sidebar/personnel.json"));
const topNav = read("hrms/public/js/hrms_top_nav.js");
const home = read("hrms/public/js/hrms_home_redirect_v6.js");

assert(!fs.existsSync(path.join(root, "hrms/hr/page/employee_form_entry/employee_form_entry.js")), "员工表单录入首页不应继续保留。");
assert(!fs.existsSync(path.join(root, "hrms/hr/page/employee_form_entry/employee_form_entry.json")), "员工表单录入首页 Page 不应继续保留。");
const dutyPageJson = JSON.parse(read("hrms/hr/page/employee_duty_change/employee_duty_change.json"));
assert.strictEqual(dutyPageJson.page_name, "employee-duty-change");
assert(api.includes("find_employee_matches"));
assert(api.includes("custom_employee_code"));
assert(api.includes('"image"'), "Employee matching must return the current employee photo.");
assert(api.includes("employee_name"));
assert(api.includes('filters={**filters, "custom_employee_code": query}'), "Employee code matching must be exact.");
assert(api.includes('{"employee_name": ["like", f"%{query}%"]}'), "Employee name matching should remain fuzzy.");
assert(!api.includes('{"custom_employee_code": ["like",'), "Employee code must not use substring matching.");
assert(api.includes("archive_employee_form_attachment"));
assert(api.includes("EMPLOYEE_ATTACHMENT_TITLE_FIELD"), "Form attachment titles must have a durable File field.");
assert(api.includes("title: str = \"\""), "Form attachment archiving must accept a title.");
assert(api.includes("list_employee_form_entries"));
assert(api.includes("get_employee_form_entry_summaries"), "The entry landing page must load each employee's latest form material.");
assert(api.includes('"designation", "status"'), "Form records must include the employee's current position and status.");
assert(api.includes("EMPLOYEE_MATERIAL_FIELD_PREFIX"), "Form attachments must use the canonical roster material field prefix.");
assert(api.includes('"attached_to_field": ["in", [material_field, form_entry["material_type"]]]'), "Form records must read both canonical and legacy attachment fields.");
assert(api.includes("search_text: str = \"\""), "Form records must support a name or department filter.");
assert(api.includes("row.employee_name") && api.includes("row.department"), "Form record filtering must cover employee name and department.");
assert(detail.includes('"submitted_by_name"'), "Roster material payload must include the submitter.");
assert(detail.includes('"owner"'), "Roster material payload must read the attachment owner.");
assert(detail.includes("员工表单资料"), "Roster must include the three employee form materials.");
assert(submitPage.includes("提交人"), "Employee form records must show the submitter.");
assert(submitPage.includes("提交时间"), "Employee form records must show the submission time.");
assert(submitPage.includes("当前职务") && submitPage.includes("当前状态"), "Employee form records must show current employee information.");
assert(submitPage.includes("请输入员工姓名或部门"), "Employee form records must provide a name or department filter.");
assert(submitPage.includes("data-action=\"record-reset\""), "Employee form records must provide a reset action.");
assert(submitPage.includes("render_employee_photo"), "Employee form submit pages must render the current employee photo.");
for (const title of ["谈话标题", "调动标题", "奖惩标题"]) {
	assert(submitPage.includes(title), `Missing employee form title input: ${title}`);
}
assert(submitPage.includes("data-role=\"form-title\""), "Employee form pages must collect the title before upload.");
assert(submitPage.includes("row.title"), "Employee form records must show the attachment title.");
assert(submitPage.includes("hrms-employee-form-submit__photo-empty"), "Employee form submit pages must show an empty-photo state.");
assert(submitPage.includes('size: "extra-large"'), "Record image preview should use a large dialog.");
assert(submitPage.includes("hrms-employee-form-record-preview-dialog"), "Record image preview should use its large-dialog wrapper class.");
assert(detailPage.includes("提交人"), "Roster employee materials must show the submitter.");
assert(detailPage.includes("提交时间"), "Roster employee materials must show the submission time.");
assert(detailPage.includes("get_material_title_label"), "Roster material uploads must collect form titles.");
assert(detailPage.includes("file.title"), "Roster employee materials must show the attachment title.");
for (const label of ["员工谈话表", "员工职务调动申请表", "奖惩提报单"]) {
	assert(api.includes(label), `Missing API form type: ${label}`);
	assert(detail.includes(label), `Missing employee material type: ${label}`);
}
for (const marker of ["allow_take_photo", "disable_file_browser", "find_employee_matches", "archive_employee_form_attachment", "list_employee_form_entries", "submitted_by_name", "data-preview-src", "employee-detail", "材料附件", "录入记录"]) {
	assert(submitPage.includes(marker), `Missing employee form entry behavior: ${marker}`);
}
for (const route of ["employee-talk-form", "employee-duty-change", "employee-reward-form"]) {
	assert(submitPage.includes(`"${route}"`), `Missing submit page route: ${route}`);
}
for (const [source, route] of [[talkPage, "employee-talk-form"], [dutyPage, "employee-duty-change"], [rewardPage, "employee-reward-form"]]) {
	assert(source.includes(`frappe.pages["${route}"].on_page_show`), `Route changes must refresh ${route}.`);
}
assert(sidebar.items.some((item) => item.label === "员工表单录入" && item.type === "Section Break"));
assert(!sidebar.items.some((item) => item.link_to === "employee-form-entry"), "左侧菜单不应保留员工表单录入首页。");
assert(detail.includes('"employee-form-entry"'), "迁移清理必须识别旧的员工表单录入首页。");
assert(detail.includes('"Cross Department Support Capability", "employee-form-entry"'), "部署后的侧栏同步必须清理旧首页入口。");
for (const [label, route] of [["员工谈话表", "employee-talk-form"], ["员工职务调动申请表", "employee-duty-change"], ["奖惩提报单", "employee-reward-form"]]) {
	assert(sidebar.items.some((item) => item.label === label && item.link_to === route), `Missing sidebar entry: ${label}`);
}
assert(!topNav.includes('"employee-form-entry"'), "顶部导航不应保留员工表单录入首页。");
assert(topNav.includes('label: "人事"'));
assert(!home.includes('employee-transfer-form'));
assert(home.includes('label: "员工表单录入"'));
assert(!home.includes('employee-form-entry'), "自定义人事导航不应保留员工表单录入首页。");
for (const route of ["employee-talk-form", "employee-duty-change", "employee-reward-form"]) {
	assert(submitPage.includes(`\"${route}\"`), `Missing submit page route mapping: ${route}`);
	assert(home.includes(`route: "/desk/${route}"`), `Missing custom sidebar route: ${route}`);
}
assert(!submitPage.includes('set_secondary_action(__("返回人事首页")'), "员工表单页不应显示冗余的返回人事首页按钮。");
assert(submitPage.includes('this.page.set_title(__(`${this.form.label}录入记录`))'), "录入记录页标题应包含当前表单名称。");
assert(navigation.includes('return normalize_slug(route[0] + "/" + route[1]);'), "员工表单录入记录路由应保留二级路径。");

console.log("employee form entry contract passed");
