const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts", "hrms-local.sh");

if (!fs.existsSync(scriptPath)) {
	throw new Error("Missing file: scripts/hrms-local.sh");
}

const script = fs.readFileSync(scriptPath, "utf8");

function mustInclude(marker) {
	if (!script.includes(marker)) {
		throw new Error(`HRMS local launcher is missing marker: ${marker}`);
	}
}

for (const marker of [
	"start)",
	"stop)",
	"status)",
	"logs)",
	"migrate)",
	"seed)",
	"seed-dry-run)",
	"seed-payroll)",
	"seed-status)",
	"seed-records)",
	"seed-reset-payroll)",
	"db-shell)",
	"console)",
	"shell)",
	'docker compose -f "${COMPOSE_FILE}" up -d',
	'docker compose -f "${COMPOSE_FILE}" down',
	"bench --site hrms.localhost migrate",
	"hrms.api.demo_seed.seed_test_hrms_demo",
	"hrms.api.demo_seed.get_test_hrms_demo_records",
	"hrms.api.demo_seed.reset_test_hrms_payroll_seed",
	"http://localhost:8000",
]) {
	mustInclude(marker);
}

if (script.includes("down -v") || script.includes("docker volume rm")) {
	throw new Error("HRMS local launcher must not delete local Docker volumes");
}

const mode = fs.statSync(scriptPath).mode;
if (!(mode & 0o100)) {
	throw new Error("HRMS local launcher must be executable");
}

console.log("HRMS local launcher contract passed.");
