(() => {
	"use strict";

	const BLANK_ICON = "/assets/hrms/images/blank-brand.svg?v=20260805a";

	function isLoginPage() {
		return window.location.pathname.replace(/\/+$/, "") === "/login";
	}

	function setBlankFavicon() {
		let iconLinks = Array.from(document.querySelectorAll("link[rel~='icon']"));
		if (!iconLinks.length) {
			const iconLink = document.createElement("link");
			iconLink.rel = "icon";
			document.head.appendChild(iconLink);
			iconLinks = [iconLink];
		}
		iconLinks.forEach((iconLink) => {
			iconLink.href = BLANK_ICON;
		});
	}

	function customizeLoginPage() {
		if (!isLoginPage()) return;

		document.body.classList.add("hrms-login-page");
		document.title = "登录";
		setBlankFavicon();

		const username = document.getElementById("login_email");
		const password = document.getElementById("login_password");
		const usernameLabel = document.querySelector("label[for='login_email']");
		const passwordLabel = document.querySelector("label[for='login_password']");
		const loginButton = document.querySelector(".form-login button[type='submit']");

		if (usernameLabel) usernameLabel.textContent = "用户名";
		if (passwordLabel) passwordLabel.textContent = "密码";
		if (loginButton) loginButton.textContent = "登录";
		if (username) {
			username.placeholder = "";
			username.setAttribute("aria-label", "用户名");
		}
		if (password) {
			password.placeholder = "";
			password.setAttribute("aria-label", "密码");
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", customizeLoginPage, { once: true });
	} else {
		customizeLoginPage();
	}
})();
