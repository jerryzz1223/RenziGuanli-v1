const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "hrms/public/css/hrms_top_nav.css"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms/hooks.py"), "utf8");

function expect(condition, message) {
	if (!condition) throw new Error(message);
}

const desktopDrawer = css.match(/\.hrms-top-drawer \{[\s\S]*?\n\}/)?.[0] || "";
expect(
	desktopDrawer.includes("width: 186px;"),
	"The standalone HR navigation drawer must be three quarters of its former 248px width.",
);
expect(
	css.includes("margin-left: 238px !important;") && css.includes("width: calc(100vw - 238px) !important;"),
	"Opening the compact drawer must reserve its matching desktop lane for the page content.",
);
expect(
	hooks.includes("/assets/hrms/css/hrms_top_nav.css?v=20260901d"),
	"The compact sidebar stylesheet must use a refreshed asset version.",
);

console.log("compact HRMS sidebar layout verification passed");
