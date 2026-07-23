(function () {
	const NAV_ID = "hrms-top-module-nav";
	const ACCOUNT_ID = "hrms-account-menu";
	const COMPANY_CONTEXT_ID = "hrms-top-company-context";
	const COMPANY_CONTEXT_EVENT = "hrms:company-context-changed";
	const COMPANY_CONTEXT_STORAGE_PREFIX = "hrms_company_context";
	const PREFERRED_COMPANY = "永新";

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

	// Keep cross-module and administration functions here.  Day-to-day imports
	// remain on their own module pages; this menu is the discoverable fallback
	// for HR administrators and the audit centre.
	const moreItems = [
		{ label: "数据导入中心", route: "/desk/form-data-intake", roles: ["HR Manager", "System Manager"] },
		{ label: "数据处理中心", route: "/desk/hrms-data-operations", roles: ["System Manager"] },
		{ label: "系统运行状态", route: "/desk/system-health-report", roles: ["System Manager"] },
		{ label: "费用", route: "/desk/expenses" },
		{ label: "社保个税", route: "/desk/tax-&-benefits" },
		{ label: "HR 设置", route: "/desk/hr-settings" },
	];

	let accountInfo = null;
	let accountInfoLoading = false;
	let accountEventsBound = false;
	let moreEventsBound = false;
	let companyContextPromise = null;
	let companyFilterSyncTimer = null;
	const companyContext = {
		companies: [],
		current: "",
	};

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

	function companyContextStorageKey() {
		const user = window.frappe?.session?.user || "anonymous";
		return `${COMPANY_CONTEXT_STORAGE_PREFIX}:${user}`;
	}

	function readStoredCompany() {
		try {
			return window.localStorage?.getItem(companyContextStorageKey()) || "";
		} catch (error) {
			return "";
		}
	}

	function storeCompany(company) {
		try {
			window.localStorage?.setItem(companyContextStorageKey(), company);
		} catch (error) {
			// Private browsing or a restricted browser must not block the HRMS UI.
		}
	}

	function userDefaultCompany() {
		return (
			window.frappe?.defaults?.get_user_default?.("company") ||
			window.frappe?.boot?.user?.defaults?.company ||
			window.frappe?.boot?.sysdefaults?.company ||
			""
		);
	}

	function resolveInitialCompany(companies) {
		const available = new Set(companies.map((company) => company.name));
		const stored = readStoredCompany();
		if (stored && available.has(stored)) return stored;
		if (available.has(PREFERRED_COMPANY)) return PREFERRED_COMPANY;
		const userDefault = userDefaultCompany();
		if (userDefault && available.has(userDefault)) return userDefault;
		return companies[0] || "";
	}

	function loadCompanyContext() {
		if (companyContextPromise) return companyContextPromise;
		const getCompanies = window.frappe?.db?.get_list
			? frappe.db.get_list("Company", { fields: ["name", "company_name", "abbr"], order_by: "name asc", limit_page_length: 500 })
			: Promise.resolve([]);
		companyContextPromise = Promise.resolve(getCompanies)
			.then((rows) => {
				companyContext.companies = (rows || [])
					.map((row) => ({
						name: String(row.name || "").trim(),
						company_name: String(row.company_name || row.name || "").trim(),
						abbr: String(row.abbr || "").trim(),
					}))
					.filter((row) => row.name);
				companyContext.current = resolveInitialCompany(companyContext.companies);
				return companyContext.current;
			})
			.catch(() => {
				companyContext.companies = [];
				companyContext.current = userDefaultCompany();
				return companyContext.current;
			});
		return companyContextPromise;
	}

	function getCurrentCompany() {
		return companyContext.current || userDefaultCompany();
	}

	function setCurrentCompany(company) {
		const nextCompany = String(company || "").trim();
		if (!nextCompany || (companyContext.companies.length && !companyContext.companies.some((company) => company.name === nextCompany))) {
			return getCurrentCompany();
		}
		if (nextCompany === companyContext.current) return nextCompany;
		companyContext.current = nextCompany;
		storeCompany(nextCompany);
		window.dispatchEvent(new CustomEvent(COMPANY_CONTEXT_EVENT, { detail: { company: nextCompany } }));
		return nextCompany;
	}

	function listSupportsCompanyFilter(listView) {
		if (!listView?.doctype || !listView?.filter_area) return false;
		const meta = listView.meta || window.frappe?.get_meta?.(listView.doctype);
		return Boolean((meta?.fields || []).some((field) => field.fieldname === "company"));
	}

	function applyCompanyFilterToActiveList(company) {
		const listView = window.cur_list;
		if (!company || !listSupportsCompanyFilter(listView)) return;

		const existingFilters = listView.filter_area.get?.() || [];
		const currentCompanyFilter = existingFilters.find((filter) => filter?.[1] === "company" && filter?.[2] === "=");
		if (currentCompanyFilter?.[3] === company) return;

		// The global company selector is authoritative. Remove a saved or stale
		// Company filter first, then apply the selected company to the Frappe list.
		Promise.resolve(listView.filter_area.remove("company"))
			.then(() => listView.filter_area.add(listView.doctype, "company", "=", company))
			.catch(() => {
				// A non-standard page may expose a partial List API; custom HRMS pages
				// listen to the company-context event separately.
			});
	}

	function scheduleCompanyFilterSync(company = getCurrentCompany()) {
		window.clearTimeout(companyFilterSyncTimer);
		companyFilterSyncTimer = window.setTimeout(() => applyCompanyFilterToActiveList(company), 120);
	}

	window.hrmsCompanyContext = {
		ready: loadCompanyContext,
		getCurrentCompany,
		setCurrentCompany,
		getCompanies: () => companyContext.companies.map((company) => company.name),
		getCompanyOptions: () => companyContext.companies.map((company) => ({ ...company })),
	};

	function companyOptionLabel(company) {
		if (!company) return "";
		return company.company_name && company.company_name !== company.name
			? `${company.company_name}（编码：${company.name}）`
			: company.name;
	}

	function canManageCompanyIdentity() {
		const roles = window.frappe?.user_roles || window.frappe?.boot?.user?.roles || [];
		return Array.isArray(roles) && roles.includes("System Manager");
	}

	function reloadCompanyContext() {
		companyContextPromise = null;
		return loadCompanyContext().then(() => {
			scheduleRender();
			window.dispatchEvent(new CustomEvent("hrms:company-identity-updated", { detail: { company: getCurrentCompany() } }));
		});
	}

	function openCompanyIdentityDialog() {
		const company = getCurrentCompany();
		if (!company || !window.frappe?.call || !window.frappe?.ui?.Dialog) return;

		frappe.call("hrms.api.company_identity.get_company_identity", { company }).then((response) => {
			const identity = response.message || {};
			const dialog = new frappe.ui.Dialog({
				title: __("管理公司名称"),
				fields: [
					{ fieldname: "company_code", fieldtype: "Data", label: __("公司编码（不可修改）"), default: identity.name, read_only: 1 },
					{ fieldname: "company_name", fieldtype: "Data", label: __("公司显示名称"), default: identity.company_name, reqd: 1 },
					{ fieldname: "abbr", fieldtype: "Data", label: __("公司简称 / Abbr"), default: identity.abbr, reqd: 1 },
					{ fieldtype: "HTML", fieldname: "company_identity_note", options: `<div class="text-muted small">${escapeHtml(identity.note || __("显示名称用于页面展示；公司编码保持不变。"))}</div>` },
				],
				primary_action_label: __("保存名称"),
				primary_action(values) {
					frappe.call({
						method: "hrms.api.company_identity.update_company_identity",
						args: { company, company_name: values.company_name, abbr: values.abbr },
						freeze: true,
						freeze_message: __("正在保存公司名称…"),
						callback(result) {
							dialog.hide();
							reloadCompanyContext();
							frappe.show_alert({ message: result.message?.message || __("公司名称已更新"), indicator: "green" });
						},
					});
				},
			});
			dialog.show();
		});
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
			if (["hr-settings-center", "employee-detail", "employee-archive", "employee-roster-import", "employee-roster-export", "personnel-reports", "employee-property-history", "attendance-import-center", "payroll-input-center", "form-data-intake"].includes(deskRoute)) {
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

	function canViewMoreItem(item) {
		if (!item.roles?.length) return true;
		const roles = window.frappe?.user_roles || [];
		return roles.some((role) => item.roles.includes(role));
	}

	function closeMoreMenus(except = null) {
		document.querySelectorAll(".hrms-top-module-nav__more.is-open").forEach((wrapper) => {
			if (wrapper === except) return;
			wrapper.classList.remove("is-open");
			wrapper.querySelector(".hrms-top-module-nav__more-trigger")?.setAttribute("aria-expanded", "false");
		});
	}

	function bindMoreDocumentEvents() {
		if (moreEventsBound) return;
		document.addEventListener("click", (event) => {
			if (!event.target.closest(".hrms-top-module-nav__more")) closeMoreMenus();
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape") closeMoreMenus();
		});
		moreEventsBound = true;
	}

	function renderMore(active) {
		const wrapper = document.createElement("div");
		wrapper.className = "hrms-top-module-nav__more";

		const trigger = document.createElement("button");
		trigger.type = "button";
		trigger.className = `hrms-top-module-nav__item hrms-top-module-nav__more-trigger${active ? " is-active" : ""}`;
		trigger.setAttribute("aria-haspopup", "menu");
		trigger.setAttribute("aria-expanded", "false");
		trigger.textContent = "更多";

		const menu = document.createElement("div");
		menu.className = "hrms-top-module-nav__menu";
		menu.setAttribute("role", "menu");
		moreItems.filter(canViewMoreItem).forEach((item) => {
			const menuItem = document.createElement("button");
			menuItem.type = "button";
			menuItem.className = "hrms-top-module-nav__menu-item";
			menuItem.textContent = item.label;
			menuItem.addEventListener("click", () => {
				closeMoreMenus();
				navigate(item.route);
			});
			menu.appendChild(menuItem);
		});

		trigger.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const opening = !wrapper.classList.contains("is-open");
			closeMoreMenus(wrapper);
			wrapper.classList.toggle("is-open", opening);
			trigger.setAttribute("aria-expanded", String(opening));
			if (opening) menu.querySelector("button")?.focus();
		});
		trigger.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowDown") return;
			event.preventDefault();
			wrapper.classList.add("is-open");
			trigger.setAttribute("aria-expanded", "true");
			menu.querySelector("button")?.focus();
		});
		menu.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			closeMoreMenus();
			trigger.focus();
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

	function renderCompanyContext() {
		const wrapper = document.createElement("label");
		wrapper.id = COMPANY_CONTEXT_ID;
		wrapper.className = "hrms-top-company-context";
		wrapper.title = __("当前公司");

		const caption = document.createElement("span");
		caption.className = "hrms-top-company-context__label";
		caption.textContent = __("公司");
		wrapper.appendChild(caption);

		const selector = document.createElement("select");
		selector.className = "hrms-top-company-context__selector";
		selector.setAttribute("aria-label", __("当前公司"));
		const companies = companyContext.companies;
		const current = getCurrentCompany();
		if (!companies.length) {
			selector.add(new Option(current || __("加载公司中…"), current || ""));
			selector.disabled = true;
		} else {
			companies.forEach((company) => selector.add(new Option(companyOptionLabel(company), company.name, false, company.name === current)));
			selector.value = current;
			selector.addEventListener("change", () => setCurrentCompany(selector.value));
		}
		wrapper.appendChild(selector);

		if (companies.length && canManageCompanyIdentity()) {
			const editButton = document.createElement("button");
			editButton.type = "button";
			editButton.className = "hrms-top-company-context__edit";
			editButton.textContent = __("编辑");
			editButton.title = __("管理当前公司显示名称");
			editButton.setAttribute("aria-label", __("管理当前公司显示名称"));
			editButton.addEventListener("click", (event) => {
				event.preventDefault();
				openCompanyIdentityDialog();
			});
			wrapper.appendChild(editButton);
		}
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
		bindMoreDocumentEvents();
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
		const moreActive = !active && routeSlug() !== "hrms-workbench";
		moduleList.appendChild(renderMore(moreActive));
		nav.appendChild(moduleList);
		nav.appendChild(renderCompanyContext());
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

	window.addEventListener("hashchange", () => {
		scheduleRender();
		scheduleCompanyFilterSync();
	});
	window.addEventListener("popstate", () => {
		scheduleRender();
		scheduleCompanyFilterSync();
	});
	window.addEventListener(COMPANY_CONTEXT_EVENT, (event) => {
		scheduleRender();
		scheduleCompanyFilterSync(event.detail?.company);
	});

	if (window.frappe && frappe.router && frappe.router.on) {
		frappe.router.on("change", () => {
			scheduleRender();
			scheduleCompanyFilterSync();
		});
	}

	new MutationObserver(() => {
		if (isDeskPage() && !document.getElementById(NAV_ID)) {
			scheduleRender();
		}
	}).observe(document.documentElement, { childList: true, subtree: true });

	loadCompanyContext().then(() => {
		scheduleRender();
		scheduleCompanyFilterSync();
	});
})();
