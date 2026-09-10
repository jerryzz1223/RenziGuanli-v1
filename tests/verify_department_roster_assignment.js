const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const setup = fs.readFileSync(path.join(root, "hrms", "setup.py"), "utf8");
const department = fs.readFileSync(path.join(root, "hrms", "overrides", "department_identity.py"), "utf8");
const form = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "department.js"), "utf8");
const employeeTemplate = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

mustInclude(setup, '"default": "0"', "Other companies must keep the original default.");
mustInclude(setup, "def ensure_yongxin_departments_roster_assignable():", "Yongxin departments must be backfilled.");
mustInclude(setup, 'filters={"company": "永新"}', "Every Yongxin department node may be backfilled.");
mustInclude(setup, "ensure_yongxin_departments_roster_assignable()", "Migration must apply the Yongxin-only rule.");
mustInclude(department, 'self.company == "永新"', "Department saves must leave other companies unchanged.");
mustInclude(department, "self.hrms_roster_assignable = 1", "Yongxin folder departments must remain assignable.");
mustInclude(form, 'const isYongxin = frm.doc.company === "永新"', "The form must restrict the rule to Yongxin.");
mustInclude(form, "function enforce_yongxin_roster_assignment(frm)", "The form must keep all Yongxin nodes assignable.");
mustInclude(form, "文件夹部门：可承载下级部门，也可作为花名册归属。", "Folder departments must be presented as roster destinations.");
mustInclude(employeeTemplate, "def _resolve_roster_department(value, company, create=False, base_records=None):", "Imports must resolve roster departments.");
if (employeeTemplate.includes("花名册只能选择最末级组织")) throw new Error("Folder departments must not be rejected by roster import.");

console.log("Yongxin department roster assignment invariant verified");
