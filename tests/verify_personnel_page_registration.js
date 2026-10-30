const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const hooks = read("hrms/hooks.py");
const setup = read("hrms/setup.py");
const pageTemplate = read("hrms/api/employee_field_template.py");
const pageJson = JSON.parse(read("hrms/hr/page/employee_property_history/employee_property_history.json"));

assert(
	hooks.includes('after_migrate = "hrms.setup.after_migrate"'),
	"人员页面必须在部署迁移后统一注册，不能依赖用户先点顶部导航。",
);
assert(setup.includes("def after_migrate():"), "缺少部署后页面注册入口。");
assert(setup.includes("ensure_personnel_pages()"), "部署后必须调用人员页面注册。 ");
assert(
	pageTemplate.includes('{"name": "employee-property-history", "title": "异动记录"'),
	"任职记录必须在人员页面定义中注册。",
);
assert(
	pageJson.name === "employee-property-history" && pageJson.page_name === "employee-property-history",
	"任职记录页面路由与页面定义不一致。",
);

console.log("personnel page registration contract passed");

const dingtalkPage = JSON.parse(read("hrms/hr/page/dingtalk_roster_review/dingtalk_roster_review.json"));
assert(pageTemplate.includes('{"name": "dingtalk-roster-review", "title": "钉钉资料核对"'), "钉钉核对页面必须进入统一迁移注册清单。");
assert(dingtalkPage.name === "dingtalk-roster-review" && dingtalkPage.page_name === "dingtalk-roster-review", "钉钉核对页路由必须与注册清单一致。");
console.log("DingTalk review migration registration passed");
