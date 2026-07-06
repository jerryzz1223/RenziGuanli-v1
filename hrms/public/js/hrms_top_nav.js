(function () {
	const NAV_ID = "hrms-top-module-nav";
	const ACCOUNT_ID = "hrms-account-menu";

	const modules = [
		{ label: "工作台", route: "/desk/hrms-workbench", keys: ["hrms-workbench"] },
		{
			label: "人事",
			route: "/desk/personnel",
			keys: [
				"personnel",
				"employee",
				"employee-detail",
				"employee-archive",
				"employee-roster-import",
				"employee-roster-export",
				"personnel-reports",
				"staff-attribute-settings",
				"employee-onboarding",
				"employee-promotion",
				"employee-separation",
				"employee-transfer",
				"employee-property-history",
				"employee-skill-map",
				"employee-grievance",
				"exit-interview",
			],
		},
		{
			label: "组织",
			route: "/desk/department",
			keys: ["department", "organizational-chart", "staffing-plan"],
		},
		{
			label: "招聘",
			route: "/desk/recruitment",
			keys: ["recruitment", "job-opening", "job-applicant", "interview", "job-offer", "employee-referral"],
		},
		{
			label: "考勤假期",
			route: "/desk/attendance-import-center",
			keys: [
				"attendance-import-center",
				"shift-&-attendance",
				"attendance",
				"attendance-request",
				"employee-checkin",
				"shift-type",
				"leave-application",
				"leave-allocation",
				"leave-policy",
				"monthly-attendance-sheet",
			],
		},
		{
			label: "薪酬",
			route: "/desk/payroll-input-center",
			keys: [
				"payroll-input-center",
				"payroll",
				"salary-slip",
				"salary-structure",
				"salary-structure-assignment",
				"payroll-entry",
				"additional-salary",
				"payroll-settings",
			],
		},
		{
			label: "审批",
			route: "/desk/workflow",
			keys: ["workflow", "workflow-action", "expense-claim", "travel-request"],
		},
		{
			label: "培训学习",
			route: "/desk/training-program",
			keys: ["training-program", "training-event", "training-result", "training-feedback", "employee-skill-map"],
		},
		{
			label: "绩效",
			route: "/desk/performance",
			keys: ["performance", "appraisal", "appraisal-cycle", "appraisal-template", "appraisal-goal"],
		},
	];

	const moreItems = [
		{ label: "费用", route: "/desk/expenses" },
		{ label: "社保个税", route: "/desk/tax-&-benefits" },
		{ label: "HR 设置", route: "/desk/hr-settings" },
	];

	let accountInfo = null;
	let accountInfoLoading = false;
	let accountEventsBound = false;

	const WORKSPACE_ROUTE_SLUGS = {
		"工作台": "hrms-workbench",
		"人事": "personnel",
		"组织": "department",
		"招聘": "recruitment",
		"考勤假期": "attendance-import-center",
		"薪酬": "payroll-input-center",
		"审批": "workflow",
		"培训学习": "training-program",
		"绩效": "performance",
		"更多": "hr-settings-center",
		"HR Setup": "hrms-workbench",
		"Personnel": "personnel",
	};

	function normalizeSlug(value) {
		return String(value || "").toLowerCase().replace(/\s+/g, "-");
	}

	function escapeHtml(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function isDeskPage() {
		return window.location.pathname === "/desk" || window.location.pathname.indexOf("/desk/") === 0;
	}

	function routeSlug() {
		if (window.frappe && frappe.get_route) {
			const route = frappe.get_route();
			if (route && route.length) {
				if (route[0] === "Workspaces") return WORKSPACE_ROUTE_SLUGS[route[1]] || normalizeSlug(route[1] || route[0]);
				if (route[0] === "List" || route[0] === "Form") return String(route[1] || route[0]).toLowerCase().replace(/\s+/g, "-");
				if (route[0] === "query-report") return String(route[1] || route[0]).toLowerCase().replace(/\s+/g, "-");
				return route.join("/").toLowerCase().replace(/\s+/g, "-");
			}
		}
		const path = window.location.pathname.replace(/^\/desk\/?/, "").replace(/\/$/, "");
		const queryRoute = new URLSearchParams(window.location.search).get("route");
		return (queryRoute || path || "hrms-workbench").toLowerCase();
	}

	function activeLabel() {
		const slug = routeSlug();
		if (slug === "hrms-workbench") return "工作台";
		if (slug === "personnel") return "人事";
		const match = modules.find((module) => module.keys.some((key) => slug === key || slug.indexOf(`${key}/`) === 0));
		return match ? match.label : "";
	}

	function navigate(route) {
		if (window.frappe && frappe.set_route && route.indexOf("/desk/") === 0) {
			window.dispatchEvent(new CustomEvent("hrms:route-change", { detail: { route } }));
			const routeParts = route.replace(/^\/desk\/?/, "").split("/").filter(Boolean);
			const deskRoute = routeParts.join("/");
			if (["hr-settings-center", "employee-detail", "employee-archive", "employee-roster-import", "employee-roster-export", "personnel-reports", "employee-property-history", "attendance-import-center", "payroll-input-center"].includes(deskRoute)) {
				frappe
					.call("hrms.api.employee_field_template.ensure_personnel_pages")
					.always(() => frappe.set_route(...routeParts));
				return;
			}
			frappe.set_route(...routeParts);
			return;
		}
		window.location.href = route;
	}

	function openSettingsModule(module) {
		window.sessionStorage.setItem("hrms_settings_center_active_module", module);
		navigate("/desk/hr-settings-center");
	}

	function currentUserId() {
		return accountInfo?.name || window.frappe?.session?.user || "";
	}

	function bootUserInfo() {
		const user = window.frappe?.session?.user;
		const bootInfo = user && window.frappe?.boot?.user_info ? frappe.boot.user_info[user] : null;
		return {
			name: user,
			full_name: bootInfo?.fullname || bootInfo?.full_name || window.frappe?.session?.user_fullname || user || "",
			first_name: bootInfo?.first_name || "",
			user_image: bootInfo?.image || bootInfo?.user_image || "",
			roles: window.frappe?.boot?.user?.roles || [],
		};
	}

	function loadCurrentUser() {
		if (accountInfo || accountInfoLoading || !window.frappe || !frappe.session || frappe.session.user === "Guest") {
			return;
		}
		accountInfo = bootUserInfo();
		if (!frappe.call) {
			return;
		}
		accountInfoLoading = true;
		frappe
			.call("hrms.api.get_current_user_info")
			.then((r) => {
				accountInfo = Object.assign({}, accountInfo || {}, r.message || {});
			})
			.always(() => {
				accountInfoLoading = false;
				scheduleRender();
			});
	}

	function displayName() {
		const user = accountInfo || bootUserInfo();
		return user.full_name || user.first_name || user.name || "我的账号";
	}

	function initials(name) {
		const compact = String(name || "").trim();
		return compact ? compact.slice(0, 1).toUpperCase() : "我";
	}

	function renderAvatar() {
		const user = accountInfo || bootUserInfo();
		if (user.user_image) {
			return `<img src="${escapeHtml(user.user_image)}" alt="">`;
		}
		return `<span>${escapeHtml(initials(displayName()))}</span>`;
	}

	function accountAction(action) {
		const user = currentUserId();
		if (action === "profile" && user && window.frappe?.set_route) {
			frappe.set_route("Form", "User", user);
			return;
		}
		if (action === "change-password") {
			window.location.href = "/update-password";
			return;
		}
		if (action === "settings") {
			openSettingsModule("字段管理中心");
			return;
		}
		if (action === "user-permissions") {
			openSettingsModule("用户与权限");
			return;
		}
		if (action === "users" && window.frappe?.set_route) {
			frappe.set_route("List", "User");
			return;
		}
		if (action === "roles" && window.frappe?.set_route) {
			frappe.set_route("List", "Role");
			return;
		}
		if (action === "user-permission-list" && window.frappe?.set_route) {
			frappe.set_route("List", "User Permission");
			return;
		}
		if (action === "logout") {
			if (window.frappe?.app?.logout) {
				frappe.app.logout();
			} else {
				window.location.href = "/?cmd=web_logout";
			}
		}
	}

	function button(label, route, active) {
		const element = document.createElement("button");
		element.type = "button";
		element.className = `hrms-top-module-nav__item${active ? " is-active" : ""}`;
		element.textContent = label;
		element.addEventListener("click", () => navigate(route));
		return element;
	}

	function renderMore(active) {
		const wrapper = document.createElement("div");
		wrapper.className = "hrms-top-module-nav__more";

		const trigger = document.createElement("button");
		trigger.type = "button";
		trigger.className = `hrms-top-module-nav__item hrms-top-module-nav__more-trigger${active ? " is-active" : ""}`;
		trigger.setAttribute("aria-haspopup", "menu");
		trigger.textContent = "更多";

		const menu = document.createElement("div");
		menu.className = "hrms-top-module-nav__menu";
		menu.setAttribute("role", "menu");
		moreItems.forEach((item) => {
			const menuItem = document.createElement("button");
			menuItem.type = "button";
			menuItem.className = "hrms-top-module-nav__menu-item";
			menuItem.textContent = item.label;
			menuItem.addEventListener("click", () => navigate(item.route));
			menu.appendChild(menuItem);
		});

		wrapper.appendChild(trigger);
		wrapper.appendChild(menu);
		return wrapper;
	}

	function bindAccountDocumentEvents() {
		if (accountEventsBound) return;
		document.addEventListener("click", (event) => {
			const account = document.getElementById(ACCOUNT_ID);
			if (account && !account.contains(event.target)) {
				account.classList.remove("is-open");
			}
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				document.getElementById(ACCOUNT_ID)?.classList.remove("is-open");
			}
		});
		accountEventsBound = true;
	}

	function renderAccountMenu() {
		loadCurrentUser();
		const wrapper = document.createElement("div");
		wrapper.id = ACCOUNT_ID;
		wrapper.className = "hrms-account-menu";

		const trigger = document.createElement("button");
		trigger.type = "button";
		trigger.className = "hrms-account-menu__trigger";
		trigger.setAttribute("aria-haspopup", "menu");
		trigger.innerHTML = `
			<span class="hrms-account-menu__avatar">${renderAvatar()}</span>
			<span class="hrms-account-menu__name">${escapeHtml(displayName())}</span>
		`;
		trigger.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			wrapper.classList.toggle("is-open");
		});

		const menu = document.createElement("div");
		menu.className = "hrms-account-menu__dropdown";
		menu.setAttribute("role", "menu");
		[
			{ label: "个人资料", action: "profile" },
			{ label: "修改密码", action: "change-password" },
			{ label: "设置中心", action: "settings" },
			{ label: "用户与权限", action: "user-permissions" },
			{ label: "用户管理", action: "users" },
			{ label: "角色管理", action: "roles" },
			{ label: "用户权限", action: "user-permission-list" },
			{ label: "退出登录", action: "logout", danger: true },
		].forEach((item) => {
			const menuItem = document.createElement("button");
			menuItem.type = "button";
			menuItem.className = `hrms-account-menu__item${item.danger ? " is-danger" : ""}`;
			menuItem.textContent = item.label;
			menuItem.addEventListener("click", () => accountAction(item.action));
			menu.appendChild(menuItem);
		});

		wrapper.appendChild(trigger);
		wrapper.appendChild(menu);
		bindAccountDocumentEvents();
		return wrapper;
	}

	function mountPoint() {
		return document.querySelector(".page-container") || document.querySelector(".layout-main") || document.body;
	}

	function render() {
		if (!isDeskPage() || document.body.classList.contains("login")) {
			document.getElementById(NAV_ID)?.remove();
			return;
		}

		const target = mountPoint();
		if (!target) return;

		let nav = document.getElementById(NAV_ID);
		if (!nav) {
			nav = document.createElement("nav");
			nav.id = NAV_ID;
			nav.className = "hrms-top-module-nav";
			target.insertBefore(nav, target.firstChild);
		}

		const active = activeLabel();
		nav.replaceChildren();

		const brand = document.createElement("button");
		brand.type = "button";
		brand.className = "hrms-top-module-nav__brand";
		brand.textContent = "人资管理系统";
		brand.addEventListener("click", () => navigate("/desk/hrms-workbench"));
		nav.appendChild(brand);

		const moduleList = document.createElement("div");
		moduleList.className = "hrms-top-module-nav__list";
		modules.forEach((module) => {
			moduleList.appendChild(button(module.label, module.route, module.label === active));
		});
		moduleList.appendChild(renderMore(!active && routeSlug() !== "hrms-workbench"));
		nav.appendChild(moduleList);
		nav.appendChild(renderAccountMenu());
	}

	function scheduleRender() {
		window.requestAnimationFrame(render);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", scheduleRender);
	} else {
		scheduleRender();
	}

	window.addEventListener("hashchange", scheduleRender);
	window.addEventListener("popstate", scheduleRender);

	if (window.frappe && frappe.router && frappe.router.on) {
		frappe.router.on("change", scheduleRender);
	}

	new MutationObserver(() => {
		if (isDeskPage() && !document.getElementById(NAV_ID)) {
			scheduleRender();
		}
	}).observe(document.documentElement, { childList: true, subtree: true });
})();
