(function () {
	const NAV_ID = "hrms-top-module-nav";
	const ACCOUNT_ID = "hrms-account-menu";
	const COMPANY_CONTEXT_ID = "hrms-top-company-context";
	const COMPANY_CONTEXT_EVENT = "hrms:company-context-changed";
	const COMPANY_CONTEXT_STORAGE_PREFIX = "hrms_company_context";
	const PREFERRED_COMPANY = "永新";
	// 永新当前按单公司模式运行。Company 仍是 Frappe/ERPNext 的数据隔离
	// 主键，不能删除；这里只隐藏历史/测试公司，避免日常操作误切数据空间。
	const SINGLE_COMPANY_OPERATION_MODE = true;
	const HR_SETTINGS_MANAGER_ROLES = ["HR Manager", "System Manager"];
	const SYSTEM_ADMIN_ROLES = ["System Manager"];
	let renderFrame = null;
	const CONTEXTUAL_ADMIN_PAGES = {
		doctype: {
			title: "数据模型管理",
			description: "用于新建独立业务单据和字段结构。员工属性请回设置中心维护。",
			parent: "开发中心",
			route: "hrms-developer-center",
		},
		page: {
			title: "页面与工作区管理",
			description: "用于维护页面和导航。业务入口应优先指向对应的业务中心。",
			parent: "开发中心",
			route: "hrms-developer-center",
		},
		"permission-manager": {
			title: "权限矩阵",
			description: "为角色配置各业务单据的读、写、创建、提交等权限。",
			parent: "账户与权限中心",
			route: "hrms-access-center",
		},
		user: {
			title: "用户管理",
			description: "创建、停用或重置登录账号；角色与数据范围在账户与权限中心统一梳理。",
			parent: "账户与权限中心",
			route: "hrms-access-center",
		},
		role: {
			title: "角色管理",
			description: "定义岗位可使用的功能集合，再到权限矩阵配置具体单据权限。",
			parent: "账户与权限中心",
			route: "hrms-access-center",
		},
		"user-permission": {
			title: "数据范围限制",
			description: "按公司、员工等对象限制用户可见的数据；这不是账户或角色列表。",
			parent: "账户与权限中心",
			route: "hrms-access-center",
		},
	};

	const modules = [
		{ label: "工作台", route: "/desk/hrms-workbench", keys: ["hrms-workbench"] },
		{
			label: "人事",
			route: "/desk/personnel",
			keys: [
				"personnel",
				"employee",
				"employee-detail",
				"employee-roster-import",
				"employee-roster-export",
				"personnel-reports",
				"staff-attribute-settings",
				"employee-onboarding",
				"employee-promotion",
				"employee-separation",
				"employee-separation-records",
				"employee-transfer",
				"employee-property-history",
				"employee-skill-map",
				"employee-grievance",
				"exit-interview",
			],
		},
		{
			label: "部门",
			route: "/desk/department",
			keys: ["department", "organizational-chart"],
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

	// More is reserved for low-frequency, cross-module HR services. Settings
	// and system administration live in the account menu instead.
	const moreItems = [
		{
			label: "社保个税",
			description: "社保、公积金及个人所得税服务",
			route: "/desk/tax-&-benefits",
		},
		{
			label: "电子合同（未开放）",
			description: "高效签约服务暂未开放",
			unavailable: true,
			notice: "电子合同功能暂未开放。当前可在员工档案中查看合同信息。",
		},
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
		"部门": "department",
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

	function isPreferredCompany(company) {
		return company?.name === PREFERRED_COMPANY || company?.company_name === PREFERRED_COMPANY;
	}

	function preferredCompany(companies) {
		return (companies || []).find(isPreferredCompany) || null;
	}

	function companiesForDailyOperation(companies) {
		const primary = preferredCompany(companies);
		// Keep a clean fallback for a brand-new developer site that has not yet
		// created 永新. Once 永新 exists, no legacy/test company is selectable.
		return SINGLE_COMPANY_OPERATION_MODE && primary ? [primary] : companies;
	}

	function resolveInitialCompany(companies) {
		const primary = preferredCompany(companies);
		if (SINGLE_COMPANY_OPERATION_MODE && primary) return primary.name;
		const available = new Set(companies.map((company) => company.name));
		const stored = readStoredCompany();
		if (stored && available.has(stored)) return stored;
		if (primary) return primary.name;
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
				const allCompanies = (rows || [])
					.map((row) => ({
						name: String(row.name || "").trim(),
						company_name: String(row.company_name || row.name || "").trim(),
						abbr: String(row.abbr || "").trim(),
					}))
					.filter((row) => row.name);
				companyContext.companies = companiesForDailyOperation(allCompanies);
				companyContext.current = resolveInitialCompany(companyContext.companies);
				if (companyContext.current) storeCompany(companyContext.current);
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
		reload: reloadCompanyContext,
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
		return hasAnyRole(SYSTEM_ADMIN_ROLES);
	}

	function currentUserRoles() {
		const roles = window.frappe?.user_roles || window.frappe?.boot?.user?.roles || [];
		return Array.isArray(roles) ? roles : [];
	}

	function hasAnyRole(allowedRoles) {
		return currentUserRoles().some((role) => allowedRoles.includes(role));
	}

	function showAccessDenied() {
		if (window.frappe?.msgprint) {
			frappe.msgprint(__("此功能仅对人资管理员或系统管理员开放。"));
		}
	}

	function showFeatureUnavailable(message) {
		const text = __(message || "该功能暂未开放。");
		if (window.frappe?.show_alert) {
			frappe.show_alert({ message: text, indicator: "orange" });
			return;
		}
		window.alert(text);
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
		// The session is the authority for profile navigation. accountInfo is
		// loaded asynchronously and can briefly belong to an earlier Desk session.
		return window.frappe?.session?.user || "";
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
		if (!window.frappe || !frappe.session || frappe.session.user === "Guest") {
			return;
		}
		const requestedUser = frappe.session.user;
		if (accountInfo?.name && accountInfo.name !== requestedUser) {
			accountInfo = null;
		}
		if (accountInfo || accountInfoLoading) return;

		accountInfo = bootUserInfo();
		if (!frappe.call) {
			return;
		}
		accountInfoLoading = true;
		frappe
			.call("hrms.api.get_current_user_info")
			.then((r) => {
				if (frappe.session.user !== requestedUser) return;
				accountInfo = Object.assign({}, accountInfo || {}, r.message || {}, { name: requestedUser });
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
		const requiredRoles = {
			settings: HR_SETTINGS_MANAGER_ROLES,
			"user-permissions": SYSTEM_ADMIN_ROLES,
			users: SYSTEM_ADMIN_ROLES,
			roles: SYSTEM_ADMIN_ROLES,
			"user-permission-list": SYSTEM_ADMIN_ROLES,
			"developer-tools": SYSTEM_ADMIN_ROLES,
		};
		if (requiredRoles[action] && !hasAnyRole(requiredRoles[action])) {
			showAccessDenied();
			return;
		}
		if (action === "profile" && user && user !== "Guest" && window.frappe?.set_route) {
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
			frappe.set_route("hrms-access-center");
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
		if (action === "developer-tools" && window.frappe?.set_route) {
			frappe.set_route("hrms-developer-center");
			return;
		}
		if (action === "data-operations" && window.frappe?.set_route) {
			frappe.set_route("hrms-data-operations");
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
		return hasAnyRole(item.roles);
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
		trigger.innerHTML = `<span>更多</span><span class="hrms-top-module-nav__more-caret" aria-hidden="true"></span>`;

		const menu = document.createElement("div");
		menu.className = "hrms-top-module-nav__menu";
		menu.setAttribute("role", "menu");
		menu.setAttribute("aria-label", __("更多服务"));

		const title = document.createElement("div");
		title.className = "hrms-top-module-nav__menu-title";
		title.textContent = __("更多服务");
		menu.appendChild(title);

		const menuList = document.createElement("div");
		menuList.className = "hrms-top-module-nav__menu-list";
		moreItems.filter(canViewMoreItem).forEach((item) => {
			const menuItem = document.createElement("button");
			menuItem.type = "button";
			menuItem.className = `hrms-top-module-nav__menu-item${item.unavailable ? " is-unavailable" : ""}`;
			menuItem.innerHTML = `<span class="hrms-top-module-nav__menu-item-title">${escapeHtml(item.label)}</span><span class="hrms-top-module-nav__menu-item-description">${escapeHtml(item.description || "")}</span>`;
			if (item.unavailable) {
				menuItem.setAttribute("aria-disabled", "true");
				menuItem.title = item.notice || __("该功能暂未开放。");
			}
			menuItem.addEventListener("click", () => {
				if (item.unavailable) {
					showFeatureUnavailable(item.notice);
					return;
				}
				closeMoreMenus();
				navigate(item.route);
			});
			menuList.appendChild(menuItem);
		});
		menu.appendChild(menuList);

		function positionMenu() {
			const triggerBounds = trigger.getBoundingClientRect();
			const menuWidth = Math.min(360, Math.max(240, window.innerWidth - 24));
			const left = Math.max(12, Math.min(triggerBounds.right - menuWidth, window.innerWidth - menuWidth - 12));
			menu.style.left = `${Math.round(left)}px`;
			menu.style.top = `${Math.round(triggerBounds.bottom + 8)}px`;
		}

		trigger.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const opening = !wrapper.classList.contains("is-open");
			closeMoreMenus(wrapper);
			wrapper.classList.toggle("is-open", opening);
			trigger.setAttribute("aria-expanded", String(opening));
			if (opening) {
				positionMenu();
				menu.querySelector("button")?.focus();
			}
		});
		trigger.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowDown") return;
			event.preventDefault();
			wrapper.classList.add("is-open");
			trigger.setAttribute("aria-expanded", "true");
			positionMenu();
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
			{ label: "设置中心", action: "settings", roles: HR_SETTINGS_MANAGER_ROLES },
			{ label: "用户与权限", action: "user-permissions", roles: SYSTEM_ADMIN_ROLES },
			{ label: "用户管理", action: "users", roles: SYSTEM_ADMIN_ROLES },
			{ label: "角色管理", action: "roles", roles: SYSTEM_ADMIN_ROLES },
			{ label: "用户权限", action: "user-permission-list", roles: SYSTEM_ADMIN_ROLES },
			{ label: "开发工具（开发环境）", action: "developer-tools", roles: SYSTEM_ADMIN_ROLES },
			{ label: "数据处理中心", action: "data-operations", roles: SYSTEM_ADMIN_ROLES },
			{ label: "退出登录", action: "logout", danger: true },
		]
			.filter((item) => !item.roles?.length || hasAnyRole(item.roles))
			.forEach((item) => {
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
			if (companies.length === 1) {
				selector.disabled = true;
				selector.title = __("当前系统按永新单公司运行；公司管理仅系统管理员可用。");
			} else {
				selector.addEventListener("change", () => setCurrentCompany(selector.value));
			}
		}
		wrapper.appendChild(selector);

		if (companies.length && canManageCompanyIdentity()) {
			const editButton = document.createElement("button");
			editButton.type = "button";
			editButton.className = "hrms-top-company-context__edit";
			editButton.textContent = __("管理");
			editButton.title = __("打开公司管理");
			editButton.setAttribute("aria-label", __("打开公司管理"));
			editButton.addEventListener("click", (event) => {
				event.preventDefault();
				window.frappe?.set_route?.("company-management");
			});
			wrapper.appendChild(editButton);
		}
		return wrapper;
	}

	function mountPoint() {
		// Frappe replaces .page-container while switching to native list/form pages.
		// Mounting on body keeps the fixed top navigation outside that replacement
		// boundary, so a route refresh cannot make it disappear.
		return document.body;
	}

	function contextualPageKey() {
		const path = window.location.pathname.replace(/^\/desk\/?/, "").split("/").filter(Boolean)[0];
		if (CONTEXTUAL_ADMIN_PAGES[path]) return path;
		const slug = routeSlug().split("/")[0];
		return CONTEXTUAL_ADMIN_PAGES[slug] ? slug : "";
	}

	function renderContextualAdminBar() {
		const key = contextualPageKey();
		const context = CONTEXTUAL_ADMIN_PAGES[key];
		const existing = document.getElementById("hrms-contextual-admin-bar");
		if (!context || !isDeskPage()) {
			existing?.remove();
			return;
		}

		const pageHead = document.querySelector(".page-head");
		if (!pageHead || !pageHead.parentElement) return;
		const bar = existing || document.createElement("section");
		bar.id = "hrms-contextual-admin-bar";
		bar.className = "hrms-contextual-admin-bar";
		bar.innerHTML = `
			<div class="hrms-contextual-admin-bar__copy">
				<strong>${escapeHtml(context.title)}</strong>
				<span>${escapeHtml(context.description)}</span>
			</div>
			<div class="hrms-contextual-admin-bar__actions">
				<button type="button" class="btn btn-default btn-sm" data-admin-back>${escapeHtml("← 返回上一页")}</button>
				<button type="button" class="btn btn-default btn-sm" data-admin-parent>${escapeHtml(`返回${context.parent}`)}</button>
			</div>
		`;
		if (!existing) pageHead.parentElement.insertBefore(bar, pageHead.nextSibling);
		bar.querySelector("[data-admin-back]").onclick = () => {
			if (window.history.length > 1) window.history.back();
			else navigate(`/desk/${context.route}`);
		};
		bar.querySelector("[data-admin-parent]").onclick = () => navigate(`/desk/${context.route}`);
	}

	function render() {
		if (!isDeskPage() || document.body.classList.contains("login")) {
			document.getElementById(NAV_ID)?.remove();
			document.getElementById("hrms-contextual-admin-bar")?.remove();
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
		} else if (nav.parentElement !== target) {
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
		renderContextualAdminBar();
	}

	function scheduleRender() {
		if (renderFrame) return;
		renderFrame = window.requestAnimationFrame(() => {
			renderFrame = null;
			render();
		});
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
	window.addEventListener("focus", scheduleRender);
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) scheduleRender();
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
		if (!isDeskPage()) return;
		if (!document.getElementById(NAV_ID) || (contextualPageKey() && !document.getElementById("hrms-contextual-admin-bar"))) {
			scheduleRender();
		}
	}).observe(document.documentElement, { childList: true, subtree: true });

	loadCompanyContext().then(() => {
		scheduleRender();
		scheduleCompanyFilterSync();
	});
})();
