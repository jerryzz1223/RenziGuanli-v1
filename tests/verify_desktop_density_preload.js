const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "hrms", "public", "css", "hrms_top_nav.css"), "utf8");
const script = fs.readFileSync(path.join(root, "hrms", "public", "js", "hrms_top_nav.js"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");

assert.doesNotMatch(css, /\bzoom\s*:/);
assert.doesNotMatch(css, /html:has\(#hrms-top-module-nav\)\s*\{\s*zoom:/);
assert.doesNotMatch(css, /hrms-desktop-density/);
assert.doesNotMatch(css, /117\.6470588235/);
assert.match(css, /body > \.main-section/);
assert.doesNotMatch(script, /prepareDesktopDensity|hrms-desktop-density/);
assert.match(hooks, /hrms_top_nav\.js\?v=20260912-organization-label-v1/);
assert.match(hooks, /hrms_top_nav\.css\?v=20260909-roster-sequence/);

console.log("Desktop uses the browser's native scale before navigation mounts.");
