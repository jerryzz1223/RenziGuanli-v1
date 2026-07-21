const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const seed = fs.readFileSync(path.join(root, "hrms/api/form_import_demo_seed.py"), "utf8");

for (const marker of [
	'"docstatus": 1, "status": "Accepted"',
	'draft_offer_name = frappe.db.get_value(',
	'{"job_applicant": applicant.name, "company": TEST_COMPANY, "docstatus": 0}',
	'offer.status = "Accepted"',
	"offer.submit()",
]) {
	if (!seed.includes(marker)) throw new Error(`Onboarding seed safety guard missing: ${marker}`);
}

console.log("onboarding import seed contract passed");
