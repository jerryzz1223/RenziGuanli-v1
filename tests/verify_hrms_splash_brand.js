const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const branding = fs.readFileSync(path.join(root, "hrms", "branding.py"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms", "public", "css", "hrms_loading.css"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");
const splashAsset = path.join(root, "hrms", "public", "images", "yongxin-brand-mark-red.png");

if (!fs.existsSync(splashAsset)) {
	throw new Error("The Desk splash brand asset is missing.");
}

for (const marker of [
	'DEFAULT_SPLASH_BRAND_ASSET = "/assets/hrms/images/yongxin-brand-mark-red.png"',
	'"splash_image": DEFAULT_SPLASH_BRAND_ASSET',
]) {
	if (!branding.includes(marker)) {
		throw new Error(`Branding must configure the Yongxin splash image: ${marker}`);
	}
}

for (const marker of [
	'.splash img',
	'content: url("/assets/hrms/images/yongxin-brand-mark-red.png")',
	"animation: hrms-splash-brand-spin 1.2s linear infinite;",
	"filter: none !important;",
	"opacity: 1 !important;",
	"@keyframes hrms-splash-brand-spin",
	"@media (prefers-reduced-motion: reduce)",
]) {
	if (!css.includes(marker)) {
		throw new Error(`Splash styling must preserve the black/red, reduced-motion-safe loader: ${marker}`);
	}
}

for (const hook of ["app_include_css", "web_include_css"]) {
	const block = hooks.match(new RegExp(`${hook} = \\[([\\s\\S]*?)\\]`));
	if (!block || !block[1].includes('/assets/hrms/css/hrms_loading.css?v=')) {
		throw new Error(`Shared splash styling must load through ${hook}.`);
	}
}

console.log("Yongxin splash branding is configured with a lightweight, accessible animation.");
