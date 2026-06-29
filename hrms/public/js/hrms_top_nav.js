(function () {
	const NAV_ID = "hrms-top-module-nav";

	const modules = [
		{ label: "工作台", route: "/desk/hr-setup", keys: ["hr-setup"] },
		{
			label: "人事",
			route: "/desk/personnel",
			keys: [
				"personnel",
				"employee",
				"employee-group",
				"employee-grade",
				"employee-onboarding",
				"employee-promotion",
				"employee-separation",
				"employee-transfer",
				"employee-property-history",
				"employee-training",
				"employee-grievance",
				"exit-interview",
			],
		},
		{
			label: "组织",
			route: "/desk/department",
			keys: ["company", "branch", "department", "designation", "organizational-chart", "staffing-plan"],
		},
		{
			label: "招聘",
			route: "/desk/recruitment",
			keys: ["recruitment", "job-opening", "job-applicant", "interview", "job-offer", "employee-referral"],
		},
		{
			label: "考勤假期",
			route: "/desk/shift-&-attendance",
			keys: [
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
			route: "/desk/payroll",
			keys: [
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

	function isDeskPage() {
		return window.location.pathname === "/desk" || window.location.pathname.indexOf("/desk/") === 0;
	}

	function routeSlug() {
		const path = window.location.pathname.replace(/^\/desk\/?/, "").replace(/\/$/, "");
		const queryRoute = new URLSearchParams(window.location.search).get("route");
		return (queryRoute || path || "hr-setup").toLowerCase();
	}

	function activeLabel() {
		const slug = routeSlug();
		if (slug === "hr-setup") return "工作台";
		if (slug === "personnel") return "人事";
		const match = modules.find((module) => module.keys.some((key) => slug.indexOf(key) === 0));
		return match ? match.label : "";
	}

	function navigate(route) {
		if (window.frappe && frappe.set_route && route.indexOf("/desk/") === 0) {
			frappe.set_route(route.replace(/^\/desk\/?/, ""));
			return;
		}
		window.location.href = route;
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
		brand.addEventListener("click", () => navigate("/desk/hr-setup"));
		nav.appendChild(brand);

		const moduleList = document.createElement("div");
		moduleList.className = "hrms-top-module-nav__list";
		modules.forEach((module) => {
			moduleList.appendChild(button(module.label, module.route, module.label === active));
		});
		moduleList.appendChild(renderMore(!active && routeSlug() !== "hr-setup"));
		nav.appendChild(moduleList);
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
