const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const main = read("frontend/src/main.js");
assert(
	main.includes('await import(\n\t\t\t"../public/frappe-push-notification"'),
	"Firebase push code must be lazy-loaded outside the startup bundle",
);
assert(!main.includes('import FrappePushNotification from'), "Firebase must not be statically imported by the app entry");
assert(main.includes("AUTH_REFRESH_INTERVAL = 60_000"), "Route auth checks must reuse a recent user response");
assert(main.includes("userRefreshPromise"), "Concurrent route auth checks must share one request");
assert(main.includes("if (!relayServerURL)"), "Missing push configuration must not trigger a failed relay request");

const app = read("frontend/src/App.vue");
assert(!app.includes("onMounted"), "Push message binding must not race the lazy notification initialization");

console.log("Frontend startup, route auth, and push initialization are performance guarded.");
