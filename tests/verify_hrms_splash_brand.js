const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const branding = fs.readFileSync(path.join(root, "hrms", "branding.py"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms", "public", "css", "hrms_top_nav.css"), "utf8");
const hooks = fs.readFileSync(path.join(root, "hrms", "hooks.py"), "utf8");
const splashAsset = path.join(root, "hrms", "public", "images", "yongxin-brand-mark.png");

if (!fs.existsSync(splashAsset)) {
	throw new Error("The Desk splash brand asset is missing.");
}

for (const marker of [
	'DEFAULT_SPLASH_BRAND_ASSET = "/assets/hrms/images/yongxin-brand-mark.png"',
	'"splash_image": DEFAULT_SPLASH_BRAND_ASSET',
]) {
	if (!branding.includes(marker)) {
		throw new Error(`Branding must configure the Yongxin splash image: ${marker}`);
	}
}

for (const marker of [
	'.splash img[src*="/assets/hrms/images/yongxin-brand-mark.png"]',
	"animation: hrms-splash-brand-spin 1.2s linear infinite;",
	"filter: grayscale(1);",
	"opacity: 0.42;",
	"@keyframes hrms-splash-brand-spin",
	"@media (prefers-reduced-motion: reduce)",
]) {
	if (!css.includes(marker)) {
		throw new Error(`Splash styling must preserve the grey, reduced-motion-safe loader: ${marker}`);
	}
}

if (!hooks.includes('/assets/hrms/css/hrms_top_nav.css?v=20260903a')) {
	throw new Error("The splash CSS change must use a new cache version.");
}

console.log("Yongxin splash branding is configured with a lightweight, accessible animation.");
