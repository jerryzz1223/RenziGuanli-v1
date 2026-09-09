(() => {
	"use strict";

	const BLANK_ICON = "/assets/hrms/images/blank-brand.svg?v=20260805a";
	// Translate presentation only; Frappe retains authentication and recovery handling.
	const CHINESE_COPY = new Map(Object.entries({
		"Email is required.": "请输入用户名。",
		"Password is required.": "请输入密码。",
		"Invalid Email.": "请输入有效的邮箱地址。",
		"Please enter a valid email.": "请输入有效的邮箱地址。",
		"Both login and password required": "请输入用户名和密码。",
		"Please enter your email, we'll send you password reset link": "输入账号绑定的邮箱，获取密码重置链接。",
		"Send Link": "发送重置链接",
		"Back to sign in": "返回登录",
		"Forgot Password?": "找回密码",
		"Sign In": "登录",
		"Continue": "登录",
		"Verifying...": "正在验证…",
		"Success": "验证成功",
		"Sent": "已发送，请查收邮箱",
		"Invalid credentials, try again.": "用户名或密码不正确，请重试。",
		"Invalid login credentials": "用户名或密码不正确，请重试。",
		"Invalid Login. Try again.": "用户名或密码不正确，请重试。",
		"Oops! Something went wrong.": "操作未完成，请稍后重试。",
		"Something went wrong.": "操作未完成，请稍后重试。",
		"Too many requests. Please try again later.": "操作过于频繁，请稍后重试。",
		"Not permitted": "暂无访问权限",
		"Server Error": "服务暂时不可用",
		"Message": "提示",
		"Close": "关闭",
		"Cancel": "取消",
		"Confirm": "确认",
		"Verification": "身份验证",
		"Verification Code": "验证码",
		"Verify": "验证",
		"Login token required": "请输入验证码。",
		"Enter Code displayed in OTP App.": "请输入验证器中显示的验证码。",
		"OTP setup using OTP App was not completed. Please contact Administrator.": "验证器尚未设置完成，请联系管理员。",
		"SMS was not sent. Please contact Administrator.": "验证码短信未发送，请联系管理员。",
		"Verification code email not sent. Please contact Administrator.": "验证码邮件未发送，请联系管理员。",
		"Sign Up": "注册账号",
		"Let's setup your account.": "请填写账号信息。",
		"Full name is required.": "请输入姓名。",
		"Signups have been disabled for this website.": "当前未开放注册，请联系管理员开通账号。",
		"Signup Disabled": "暂未开放注册",
		"Home": "返回首页",
	}));

	function translateNode(root) {
		if (root.nodeType === Node.TEXT_NODE) {
			if (root.parentElement?.closest("script, style, textarea")) return;
			const source = root.textContent.trim();
			if (CHINESE_COPY.has(source)) root.textContent = CHINESE_COPY.get(source);
			return;
		}
		if (root.nodeType !== Node.ELEMENT_NODE) return;
		if (root.matches("script, style, textarea")) return;
		for (const attribute of ["placeholder", "title", "aria-label"]) {
			const source = root.getAttribute(attribute);
			if (CHINESE_COPY.has(source)) root.setAttribute(attribute, CHINESE_COPY.get(source));
		}
		Array.from(root.childNodes).forEach(translateNode);
	}

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
		document.querySelectorAll(".login-content").forEach((card) => {
			if (card.querySelector(".hrms-login-brand")) return;
			const brand = document.createElement("div");
			brand.className = "hrms-login-brand";
			brand.innerHTML = '<img src="/assets/hrms/images/yongxin-brand-mark-red.png" alt="永新电子" width="40" height="40"><div><strong>人资管理系统</strong><span>永新电子（常熟）有限公司</span></div>';
			card.prepend(brand);
		});
		const heading = document.querySelector(".for-login .page-card-head h4");
		const subtitle = document.querySelector(".for-login .page-card-subtitle");
		if (heading) heading.textContent = "账号登录";
		if (subtitle) subtitle.textContent = "请输入用户名和密码。";
		const recoveryHeading = document.querySelector(".for-forgot h4");
		const recoveryLabel = document.querySelector("label[for='forgot_email']");
		const recoveryEmail = document.getElementById("forgot_email");
		if (recoveryHeading) recoveryHeading.textContent = "找回密码";
		if (recoveryLabel) recoveryLabel.textContent = "邮箱";
		if (recoveryEmail) {
			recoveryEmail.placeholder = "请输入账号绑定的邮箱";
			recoveryEmail.setAttribute("aria-label", "邮箱");
		}
		document.querySelectorAll(".toggle-password").forEach((toggle) => {
			toggle.setAttribute("role", "button");
			toggle.setAttribute("tabindex", "0");
			toggle.setAttribute("aria-label", "显示或隐藏密码");
			toggle.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
				}
			});
		});

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
		translateNode(document.body);
		new MutationObserver((records) => {
			for (const record of records) {
				if (record.type === "characterData") translateNode(record.target);
				else record.addedNodes.forEach(translateNode);
			}
		}).observe(document.body, { childList: true, characterData: true, subtree: true });
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", customizeLoginPage, { once: true });
	} else {
		customizeLoginPage();
	}
})();
