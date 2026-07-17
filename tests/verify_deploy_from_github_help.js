const fs = require("fs");
const path = require("path");

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts", "deploy_from_github.sh");

assert(fs.existsSync(scriptPath), "Missing file: scripts/deploy_from_github.sh");

const script = fs.readFileSync(scriptPath, "utf8");
const helpGuard = 'if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then';
const ownerMarker = 'OWNER="${1:?缺少仓库 owner，例如 jerryzz1223}"';

assert(script.includes(helpGuard), "deploy_from_github.sh must handle --help before required args.");
assert(script.includes(ownerMarker), "deploy_from_github.sh must still require an owner for real deployments.");
assert(
	script.indexOf(helpGuard) < script.indexOf(ownerMarker),
	"deploy_from_github.sh must check --help before expanding required arguments."
);

console.log("deploy_from_github.sh help flow is reachable before required args.");
