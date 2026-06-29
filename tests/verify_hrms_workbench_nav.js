const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const hooksPath = path.join(root, "hrms", "hooks.py");
const redirectPath = path.join(root, "hrms", "public", "js", "hrms_home_redirect_v6.js");
const topNavPath = path.join(root, "hrms", "public", "js", "hrms_top_nav.js");
const topNavCssPath = path.join(root, "hrms", "public", "css", "hrms_top_nav.css");
const workbenchPath = path.join(root, "hrms", "hr", "workspace", "hr_setup", "hr_setup.json");
const workbenchSidebarPath = path.join(root, "hrms", "workspace_sidebar", "hr_setup.json");
const personnelPath = path.join(root, "hrms", "hr", "workspace", "personnel", "personnel.json");
const personnelSidebarPath = path.join(root, "hrms", "workspace_sidebar", "personnel.json");

const hooksSource = fs.readFileSync(hooksPath, "utf8");
const redirectSource = fs.readFileSync(redirectPath, "utf8");
const topNavSource = fs.readFileSync(topNavPath, "utf8");
const topNavCssSource = fs.readFileSync(topNavCssPath, "utf8");
const workbench = JSON.parse(fs.readFileSync(workbenchPath, "utf8"));
const workbenchSidebar = JSON.parse(fs.readFileSync(workbenchSidebarPath, "utf8"));
const personnel = JSON.parse(fs.readFileSync(personnelPath, "utf8"));
const personnelSidebar = JSON.parse(fs.readFileSync(personnelSidebarPath, "utf8"));

for (const marker of ['app_home = "/desk/hr-setup"', '"route": "/desk/hr-setup"']) {
	if (!hooksSource.includes(marker)) {
		throw new Error(`HRMS app entry must point to the workbench workspace: ${marker}`);
	}
}

if (!redirectSource.includes("/desk/hr-setup") || redirectSource.includes("/desk/hrms-workbench")) {
	throw new Error("Desktop redirect must point to /desk/hr-setup and not the old custom page.");
}

for (const marker of ["/assets/hrms/js/hrms_top_nav.js", "/assets/hrms/css/hrms_top_nav.css"]) {
	if (!hooksSource.includes(marker)) {
		throw new Error(`hooks.py must include the Frappe-style module nav asset: ${marker}`);
	}
}

for (const marker of ["工作台", "人事", "/desk/hr-setup", "/desk/personnel"]) {
	if (!topNavSource.includes(marker)) {
		throw new Error(`Top navigation is missing marker: ${marker}`);
	}
}

if (topNavCssSource.includes("#057a55") || topNavCssSource.includes("color: #fff")) {
	throw new Error("Top navigation must use the neutral Frappe style, not the old green copied style.");
}

if (!topNavCssSource.includes("var(--fg-color") || !topNavCssSource.includes("var(--primary")) {
	throw new Error("Top navigation should be styled with Frappe theme variables.");
}

for (const marker of ["position: fixed", "width: 100vw", "body:has(#hrms-top-module-nav)", "height: calc(100vh - 46px)"]) {
	if (!topNavCssSource.includes(marker)) {
		throw new Error(`Top navigation layout CSS is missing marker: ${marker}`);
	}
}

if (workbench.title !== "工作台") {
	throw new Error(`Workbench title should be 工作台, got ${workbench.title}`);
}

for (const label of ["快捷入口", "今日事项", "人事提醒", "人事概况", "常用报表"]) {
	if (!workbench.links.some((link) => link.type === "Card Break" && link.label === label)) {
		throw new Error(`Workbench is missing card group: ${label}`);
	}
}

if (!workbenchSidebar.items.some((item) => item.type === "Link" && item.label === "人事" && item.link_to === "Personnel")) {
	throw new Error("Workbench sidebar must link to the Personnel workspace.");
}

if (personnel.title !== "人事") {
	throw new Error(`Personnel workspace title should be 人事, got ${personnel.title}`);
}

for (const label of ["员工管理", "员工关系"]) {
	if (!personnel.links.some((link) => link.type === "Card Break" && link.label === label)) {
		throw new Error(`Personnel workspace is missing card group: ${label}`);
	}
	if (!personnelSidebar.items.some((item) => item.type === "Section Break" && item.label === label)) {
		throw new Error(`Personnel sidebar is missing collapsible section: ${label}`);
	}
}

for (const [label, linkTo, linkType] of [
	["员工花名册", "Employee", "DocType"],
	["员工档案库", "Employee", "DocType"],
	["入职管理", "Employee Onboarding", "DocType"],
	["转正管理", "Employee Promotion", "DocType"],
	["离职管理", "Employee Separation", "DocType"],
	["人事异动", "Employee Transfer", "DocType"],
]) {
	if (!personnel.links.some((link) => link.type === "Link" && link.label === label && link.link_to === linkTo && link.link_type === linkType)) {
		throw new Error(`Personnel workspace has no real route for ${label} -> ${linkType}:${linkTo}`);
	}
	if (!personnelSidebar.items.some((item) => item.type === "Link" && item.label === label && item.link_to === linkTo && item.link_type === linkType)) {
		throw new Error(`Personnel sidebar has no real route for ${label} -> ${linkType}:${linkTo}`);
	}
}

console.log("HRMS workbench and Personnel workspace use native Frappe routes.");
