const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJsonPath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

const expectedWorkspaces = ["frontend", "roster", "frappe-ui"];

assert(Array.isArray(packageJson.workspaces), "Root package.json must define a workspaces array.");
assert(
	JSON.stringify(packageJson.workspaces) === JSON.stringify(expectedWorkspaces),
	`Root workspaces must be ${expectedWorkspaces.join(", ")}.`
);

for (const workspace of expectedWorkspaces) {
	assert(fs.existsSync(path.join(root, workspace)), `Workspace directory is missing: ${workspace}`);
}

for (const [scriptName, workspace] of [
	["install-pwa-deps", "frontend"],
	["install-roster-deps", "roster"],
	["build-pwa", "frontend"],
	["build-roster", "roster"],
]) {
	const script = packageJson.scripts?.[scriptName] || "";
	assert(script.includes(`cd ${workspace}`), `${scriptName} must target the ${workspace} workspace.`);
}

console.log("Root workspace config contract passed.");
