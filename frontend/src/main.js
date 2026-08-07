import { createApp } from "vue"
import App from "./App.vue"
import router from "./router"
import { initSocket } from "./socket"

import {
	Button,
	Input,
	setConfig,
	frappeRequest,
	resourcesPlugin,
	FormControl,
} from "frappe-ui"
import { translationsPlugin } from "./plugins/translationsPlugin.js"
import EmptyState from "@/components/EmptyState.vue"

import { IonicVue } from "@ionic/vue"

import { session } from "@/data/session"
import { userResource } from "@/data/user"
import { employeeResource } from "@/data/employee"

import dayjs from "@/utils/dayjs"
import getIonicConfig from "@/utils/ionicConfig"
import { showNotification } from "@/utils/pushNotifications"

/* Core CSS required for Ionic components to work properly */
import "@ionic/vue/css/core.css"

/* Theme variables */
import "./theme/variables.css"

import "./main.css"

const app = createApp(App)
const socket = initSocket()
const AUTH_REFRESH_INTERVAL = 60_000
let lastUserRefreshAt = 0
let userRefreshPromise = null

setConfig("resourceFetcher", frappeRequest)
app.use(resourcesPlugin)
app.use(translationsPlugin)

app.component("Button", Button)
app.component("Input", Input)
app.component("FormControl", FormControl)
app.component("EmptyState", EmptyState)

app.use(router)
app.use(IonicVue, getIonicConfig())

if (session?.isLoggedIn && !employeeResource?.data) {
	employeeResource.reload()
}

app.provide("$session", session)
app.provide("$user", userResource)
app.provide("$employee", employeeResource)
app.provide("$socket", socket)
app.provide("$dayjs", dayjs)

const registerServiceWorker = async () => {
	if (!("serviceWorker" in navigator)) {
		console.error("Service worker not enabled/supported by the browser")
		return
	}

	const baseServiceWorkerURL = "/assets/hrms/frontend/sw.js"
	const relayServerURL = window.frappe?.boot?.push_relay_server_url
	if (!relayServerURL) {
		// Static precaching remains useful even when Firebase is not configured.
		try {
			await navigator.serviceWorker.register(baseServiceWorkerURL, { type: "classic" })
		} catch (err) {
			console.error("Failed to register service worker", err)
		}
		return
	}

	try {
		// Firebase is not needed to render or navigate the app. Loading it lazily
		// keeps the notification SDK out of the critical startup bundle.
		const { default: FrappePushNotification } = await import(
			"../public/frappe-push-notification"
		)
		window.frappePushNotification = new FrappePushNotification("hrms")
		window.frappePushNotification.onMessage(showNotification)
		const config = await window.frappePushNotification.fetchWebConfig()
		const serviceWorkerURL = `${baseServiceWorkerURL}?config=${encodeURIComponent(
			JSON.stringify(config)
		)}`
		const registration = await navigator.serviceWorker.register(serviceWorkerURL, {
			type: "classic",
		})
		await window.frappePushNotification.initialize(registration)
	} catch (err) {
		console.error("Failed to initialize service worker or push notifications", err)
	}
}

const refreshCurrentUser = async () => {
	if (
		userResource.data &&
		Date.now() - lastUserRefreshAt < AUTH_REFRESH_INTERVAL
	) {
		return userResource.data
	}
	if (!userRefreshPromise) {
		userRefreshPromise = Promise.resolve(userResource.reload())
			.then((data) => {
				lastUserRefreshAt = Date.now()
				return data
			})
			.finally(() => {
				userRefreshPromise = null
			})
	}
	return userRefreshPromise
}

router.isReady().then(async () => {
	if (import.meta.env.DEV) {
		await frappeRequest({
			url: "/api/method/hrms.www.hrms.get_context_for_dev",
		}).then(async (values) => {
			if (!window.frappe) window.frappe = {}
			window.frappe.boot = values
		})
	}

	await translationsPlugin.isReady();
	registerServiceWorker()
	app.mount("#app")
})

router.beforeEach(async (to, _, next) => {
	let isLoggedIn = session.isLoggedIn

	try {
		if (isLoggedIn) await refreshCurrentUser()
	} catch (error) {
		isLoggedIn = false
	}

	if (!isLoggedIn) {
		// password reset page is outside the PWA scope
		if (to.path === "/update-password") {
			return next(false)
		} else if (!["Login", "ForgotPassword"].includes(to.name)) {
			return next({ name: "Login" })
		}
	}

	if (isLoggedIn && to.name !== "InvalidEmployee") {
		await employeeResource.promise
		// user should be an employee to access the app
		// since all views are employee specific
		if (
			!employeeResource?.data ||
			employeeResource?.data?.user_id !== userResource.data.name
		) {
			next({ name: "InvalidEmployee" })
		} else if (["Login", "ForgotPassword"].includes(to.name)) {
			next({ name: "Home" })
		} else {
			next()
		}
	} else {
		next()
	}
})
