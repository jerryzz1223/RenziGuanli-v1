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

	function installReadOnlyRegistration(card) {
		if (!card || card.querySelector(".hrms-register-entry")) return;
		const entry = document.createElement("div");
		entry.className = "hrms-register-entry";
		entry.innerHTML = '<span>还没有账号？</span><button type="button" class="btn btn-link">注册账号</button>';
		card.appendChild(entry);

		const panel = document.createElement("section");
		panel.className = "hrms-register-panel";
		panel.hidden = true;
		panel.innerHTML = `
			<div class="hrms-register-heading"><strong>注册新账号</strong><span>本公司员工填写工号后会自动匹配花名册中的个人档案；管理员等非公司人员可不填。</span></div>
			<form class="hrms-register-form">
				<label>工号（选填）<input class="form-control" name="employee_code" autocomplete="off" maxlength="64" inputmode="numeric"></label>
				<div class="hrms-register-match" data-register-match hidden></div>
				<label>姓名（不填工号时必填）<input class="form-control" name="full_name" autocomplete="name" maxlength="140"></label>
				<label>邮箱（登录账号）<input class="form-control" name="email" type="email" autocomplete="email" required></label>
				<label>密码<input class="form-control" name="password" type="password" autocomplete="new-password" minlength="10" required></label>
				<label>确认密码<input class="form-control" name="password_confirm" type="password" autocomplete="new-password" minlength="10" required></label>
				<small>密码至少 10 位，并同时包含字母和数字。</small>
				<div class="hrms-register-status" role="status" aria-live="polite"></div>
				<button type="submit" class="btn btn-primary btn-block">创建账号</button>
				<button type="button" class="btn btn-link btn-block" data-register-back>返回登录</button>
			</form>`;
		card.appendChild(panel);

		const loginSections = Array.from(card.children).filter((child) =>
			!child.matches(".hrms-login-brand, .hrms-register-entry, .hrms-register-panel"),
		);
		const setRegistrationVisible = (visible) => {
			loginSections.forEach((section) => { section.hidden = visible; });
			entry.hidden = visible;
			panel.hidden = !visible;
			card.classList.toggle("is-registering", visible);
			if (visible) panel.querySelector("input")?.focus();
		};
		const form = panel.querySelector("form");
		const employeeCode = form.elements.employee_code;
		const fullName = form.elements.full_name;
		const match = form.querySelector("[data-register-match]");
		let lookupSequence = 0;
		const resetEmployeeMatch = () => {
			if (fullName.readOnly) fullName.value = "";
			match.hidden = true;
			match.textContent = "";
			match.className = "hrms-register-match";
			fullName.readOnly = false;
			fullName.removeAttribute("aria-readonly");
		};
		const previewEmployee = async () => {
			const code = employeeCode.value.trim();
			const sequence = ++lookupSequence;
			resetEmployeeMatch();
			if (!code || !window.frappe?.call) return;
			match.hidden = false;
			match.textContent = "正在匹配花名册…";
			try {
				const response = await frappe.call("hrms.access_control.preview_registration_employee", {
					employee_code: code,
				});
				if (sequence !== lookupSequence) return;
				const profile = response.message || {};
				if (!profile.matched) return resetEmployeeMatch();
				fullName.value = profile.employee_name || "";
				fullName.readOnly = true;
				fullName.setAttribute("aria-readonly", "true");
				match.textContent = [profile.employee_name, profile.department, profile.designation]
					.filter(Boolean).join(" · ");
				match.className = "hrms-register-match is-matched";
			} catch (error) {
				if (sequence !== lookupSequence) return;
				match.textContent = error?.message || "未匹配到花名册资料，请核对工号。";
				match.className = "hrms-register-match is-error";
			}
		};
		entry.querySelector("button").addEventListener("click", () => setRegistrationVisible(true));
		panel.querySelector("[data-register-back]").addEventListener("click", () => setRegistrationVisible(false));
		employeeCode.addEventListener("change", previewEmployee);
		employeeCode.addEventListener("input", () => { lookupSequence += 1; resetEmployeeMatch(); });
		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			const form = event.currentTarget;
			const status = form.querySelector(".hrms-register-status");
			const submit = form.querySelector("button[type='submit']");
			const values = Object.fromEntries(new FormData(form).entries());
			if (!values.employee_code.trim() && !values.full_name.trim()) {
				status.textContent = "未填工号时，请填写姓名。";
				status.className = "hrms-register-status is-error";
				return;
			}
			if (values.password !== values.password_confirm) {
				status.textContent = "两次输入的密码不一致。";
				status.className = "hrms-register-status is-error";
				return;
			}
			if (!window.frappe?.call) {
				status.textContent = "注册服务尚未就绪，请刷新后重试。";
				status.className = "hrms-register-status is-error";
				return;
			}
			submit.disabled = true;
			status.textContent = "正在创建账号…";
			status.className = "hrms-register-status";
			try {
				await frappe.call("hrms.access_control.register_read_only_account", {
					email: values.email,
					full_name: values.full_name,
					password: values.password,
					employee_code: values.employee_code,
				});
				const username = document.getElementById("login_email");
				if (username) username.value = values.email;
				setRegistrationVisible(false);
				const success = document.createElement("div");
				success.className = "hrms-register-success";
				success.textContent = values.employee_code.trim()
					? "注册成功，已匹配花名册中的个人档案，请登录。"
					: "注册成功。当前为基础只读账号，请登录。";
				card.querySelector(".for-login")?.prepend(success);
				document.getElementById("login_password")?.focus();
			} catch (error) {
				status.textContent = error?.message || "注册未完成，请检查输入或稍后重试。";
				status.className = "hrms-register-status is-error";
			} finally {
				submit.disabled = false;
			}
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
			installReadOnlyRegistration(card);
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
		document.body.classList.add("hrms-login-ready");
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", customizeLoginPage, { once: true });
	} else {
		customizeLoginPage();
	}
})();
