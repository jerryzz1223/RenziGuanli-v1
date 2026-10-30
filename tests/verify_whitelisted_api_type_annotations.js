const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiRoot = path.join(root, "hrms", "api");

function pythonFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) return pythonFiles(fullPath);
		return entry.name.endsWith(".py") ? [fullPath] : [];
	});
}

const missing = [];

function splitParameters(rawParameters) {
	const parameters = [];
	let start = 0;
	let depth = 0;
	for (let index = 0; index < rawParameters.length; index += 1) {
		const character = rawParameters[index];
		if ("([{<".includes(character)) depth += 1;
		else if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
		else if (character === "," && depth === 0) {
			parameters.push(rawParameters.slice(start, index).trim());
			start = index + 1;
		}
	}
	parameters.push(rawParameters.slice(start).trim());
	return parameters.filter(Boolean);
}

for (const file of pythonFiles(apiRoot)) {
	const source = fs.readFileSync(file, "utf8");
	const pattern = /@frappe\.whitelist\([^\n]*\)\n(?:@[^\n]+\n)*def\s+(\w+)\(([^\n]*)\):/g;
	for (const match of source.matchAll(pattern)) {
		const [, name, rawParameters] = match;
		for (const parameter of splitParameters(rawParameters)) {
			if (parameter.startsWith("*") || parameter.includes(":")) continue;
			missing.push(`${path.relative(root, file)}:${name}(${parameter})`);
		}
	}
}

if (missing.length) {
	throw new Error(`Whitelisted API parameters must be typed for Frappe RPC validation:\n${missing.join("\n")}`);
}

console.log("Whitelisted API type-annotation contract passed.");
