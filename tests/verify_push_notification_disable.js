const fs = require("fs");
const path = require("path");
const vm = require("vm");

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function createStorage(initialValues = {}) {
	const store = new Map(Object.entries(initialValues));
	return {
		getItem(key) {
			return store.has(key) ? store.get(key) : null;
		},
		setItem(key, value) {
			store.set(key, String(value));
		},
		removeItem(key) {
			store.delete(key);
		},
		has(key) {
			return store.has(key);
		},
	};
}

function loadPushNotificationClass(filePath, localStorage, consoleErrors) {
	let source = fs.readFileSync(filePath, "utf8");
	source = source.replace('import { initializeApp } from "firebase/app"\n', "");
	source = source.replace(/import\s*\{[\s\S]*?\}\s*from "firebase\/messaging"\n/, "");
	source = source.replace("export default FrappePushNotification\n", "module.exports = FrappePushNotification\n");

	const context = {
		module: { exports: {} },
		exports: {},
		window: { frappe: { boot: { push_relay_server_url: "https://relay.example" } } },
		localStorage,
		console: {
			error(value) {
				consoleErrors.push(value);
			},
		},
		initializeApp() {
			return {};
		},
		getMessaging() {
			return {};
		},
		getToken: async () => "new-token",
		isSupported: async () => true,
		deleteToken: async () => {},
		onFCMMessage() {},
		fetch: async () => ({ status: 200, json: async () => ({}) }),
		Notification: { requestPermission: async () => "granted" },
		encodeURIComponent,
		JSON,
	};

	vm.runInNewContext(source, context, { filename: filePath });
	return context.module.exports;
}

async function main() {
	const root = path.resolve(__dirname, "..");
	const filePath = path.join(root, "frontend", "public", "frappe-push-notification.js");
	const localStorage = createStorage({ firebase_token_hrms: "stored-token" });
	const consoleErrors = [];
	const FrappePushNotification = loadPushNotificationClass(filePath, localStorage, consoleErrors);
	const notification = new FrappePushNotification("hrms");
	const unregisterError = new Error("unsubscribe failed");

	notification.messaging = { swRegistration: true };
	notification.unregisterTokenHandler = async () => {
		throw unregisterError;
	};

	let thrownError = null;
	try {
		await notification.disableNotification();
	} catch (error) {
		thrownError = error;
	}

	assert(!thrownError, `disableNotification should swallow unregister failures, got: ${thrownError?.message}`);
	assert(notification.token === null, "disableNotification should clear the cached token.");
	assert(!localStorage.has("firebase_token_hrms"), "disableNotification should remove the stored token.");
	assert(
		consoleErrors.includes("Failed to unsubscribe from push notification"),
		"disableNotification should log the unsubscribe failure."
	);
	assert(
		consoleErrors.includes(unregisterError),
		"disableNotification should log the original unsubscribe error object."
	);

	console.log("Push notification disable flow handles unsubscribe failures.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
