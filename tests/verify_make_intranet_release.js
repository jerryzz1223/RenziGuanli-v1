const fs = require("fs");
const path = require("path");

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "scripts", "make_intranet_release.sh");

assert(fs.existsSync(scriptPath), "Missing file: scripts/make_intranet_release.sh");

const script = fs.readFileSync(scriptPath, "utf8");

for (const marker of [
	'HRMS_ALLOW_DIRTY:-0',
	"git diff --quiet --ignore-submodules --",
	"git diff --cached --quiet --ignore-submodules --",
	"Refusing to build an intranet release from a dirty worktree.",
	"Commit/stash your changes first",
	"git archive --worktree-attributes --format=zip",
]) {
	assert(script.includes(marker), `make_intranet_release.sh is missing marker: ${marker}`);
}

console.log("Intranet release script protects against dirty worktrees.");
