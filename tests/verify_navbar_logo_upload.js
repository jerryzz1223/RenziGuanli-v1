const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");
const script = fs.readFileSync(path.join(root, "hrms", "public", "js", "navbar_settings.js"), "utf8");

assert.match(
	hooks,
	/"Navbar Settings": "public\/js\/navbar_settings\.js"/,
	"Navbar Settings must load the HRMS logo upload enhancement.",
);
assert.match(script, /frappe\.ui\.form\.on\("Navbar Settings"/, "The enhancement must be scoped to Navbar Settings.");
assert.match(script, /querySelector\("\.btn-attach"\)/, "The existing Frappe attachment uploader must be reused.");
assert.match(script, /button\.style\.display === "none"/, "The upload button must be restored when a logo already exists.");
assert.match(script, /更换图片/, "An existing logo must expose a clear replacement action.");
assert.match(script, /上传图片/, "An empty logo field must expose an upload action.");
assert.match(script, /section_break_2/, "The dropdown settings section must be hidden on the branding-only page.");
assert.match(script, /announcements_section/, "The announcements section must be hidden on the branding-only page.");
assert.match(script, /\.form-footer/, "Comments and activity must be hidden on the branding-only page.");
assert.match(script, /\.layout-side-section/, "The document sidebar must be hidden on the branding-only page.");
assert.match(script, /#full-search-button/, "The page search control must be hidden so Save is the only right-side action.");
assert.match(script, /\.menu-more-button/, "The page overflow menu must be hidden so Save is the only right-side action.");

console.log("Navbar Settings is reduced to logo upload and Save.");
