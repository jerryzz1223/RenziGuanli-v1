frappe.pages["personnel-reports"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("人事报表"),
		single_column: true,
	});

	const state = {
		groups: [],
		search: "",
		collapsed: new Set(),
	};

	$(page.body).addClass("hrms-report-center");
	page.set_primary_action(__("添加报表"), () => frappe.set_route("employee-roster-export"), "add");

	function add_page_menu_item(label, action) {
		if (page.add_action_item) {
			page.add_action_item(label, action);
		} else if (page.add_menu_item) {
			page.add_menu_item(label, action);
		}
	}

	add_page_menu_item(__("邮件订阅"), show_subscription_plan);
	add_page_menu_item(__("编辑分组"), () => frappe.set_route("List", "HRMS Employee Report"));

	function load() {
		$(page.body).html(`<div class="text-muted">${__("正在加载人事报表...")}</div>`);
		return frappe
			.call("hrms.api.employee_field_template.get_employee_report_center")
			.then((r) => {
				state.groups = r.message?.groups || [];
				render();
			});
	}

	function filtered_reports(reports) {
		const keyword = state.search.trim().toLowerCase();
		if (!keyword) return reports;
		return reports.filter((report) => {
			const haystack = `${report.report_name || ""} ${report.description || ""}`.toLowerCase();
			return haystack.includes(keyword);
		});
	}

	function render() {
		$(page.body).html(`
			<div class="hrms-report-center__toolbar">
				<div class="input-group hrms-report-center__search">
					<input class="form-control" data-report-search placeholder="${__("搜索报表、报表描述")}" value="${frappe.utils.escape_html(state.search)}">
					<span class="input-group-text">${frappe.utils.icon("search", "sm")}</span>
				</div>
				<div class="hrms-report-center__actions">
					<button class="btn btn-primary" data-action="add-report">${frappe.utils.icon("add", "sm")} ${__("添加报表")}</button>
					<button class="btn btn-default" data-action="subscribe">${frappe.utils.icon("mail", "sm")} ${__("邮件订阅")}</button>
					<button class="btn btn-default" data-action="edit-groups">${frappe.utils.icon("folder-normal", "sm")} ${__("编辑分组")}</button>
				</div>
			</div>
			${render_groups()}
			<div class="hrms-report-popover d-none" data-report-popover></div>
		`);
	}

	function render_groups() {
		if (!state.groups.length) {
			return `
				<div class="hrms-report-center__empty">
					<div>${__("当前没有人事报表")}</div>
					<button class="btn btn-primary btn-sm mt-3" data-action="add-report">${__("添加报表")}</button>
				</div>`;
		}

		return state.groups
			.map((group) => {
				const reports = filtered_reports(group.reports || []);
				const is_collapsed = state.collapsed.has(group.name);
				if (!reports.length && state.search) return "";
				return `
					<section class="hrms-report-section">
						<div class="hrms-report-section__header">
							<h3>${frappe.utils.escape_html(group.name)}</h3>
							<div class="hrms-report-section__tools">
								<button class="btn btn-xs btn-default" data-action="sort-group">${frappe.utils.icon("sort", "sm")} ${__("报表排序")}</button>
								<button class="btn btn-xs btn-default" data-toggle-group="${frappe.utils.escape_html(group.name)}">
									${is_collapsed ? __("展开") : __("折叠")}
								</button>
							</div>
						</div>
						${is_collapsed ? "" : render_cards(reports)}
					</section>`;
			})
			.join("");
	}

	function render_cards(reports) {
		if (!reports.length) {
			return `<div class="text-muted mb-4">${__("没有匹配的报表")}</div>`;
		}

		return `
			<div class="hrms-report-grid">
				${reports
					.map(
						(report) => `
							<div class="hrms-report-card" data-report-id="${frappe.utils.escape_html(report.id)}">
								<div>
									<div class="hrms-report-card__title">${frappe.utils.escape_html(report.report_name)}</div>
									<div class="hrms-report-card__description">${frappe.utils.escape_html(report.description || __("员工人事信息表"))}</div>
								</div>
								<div class="hrms-report-card__actions">
									<button class="btn btn-xs btn-default" data-download-report="${frappe.utils.escape_html(report.id)}" title="${__("下载")}">
										${frappe.utils.icon("download", "sm")}
									</button>
									<button class="btn btn-xs btn-default" data-more-report="${frappe.utils.escape_html(report.id)}" title="${__("更多")}">
										${frappe.utils.icon("more-horizontal", "sm")}
									</button>
								</div>
							</div>`,
					)
					.join("")}
			</div>`;
	}

	function find_report(report_id) {
		for (const group of state.groups) {
			const report = (group.reports || []).find((item) => item.id === report_id);
			if (report) return report;
		}
	}

	function download_report(report_id) {
		window.open(
			frappe.urllib.get_full_url(
				`/api/method/hrms.api.employee_field_template.download_employee_report?report_id=${encodeURIComponent(report_id)}`,
			),
		);
	}

	function show_subscription_plan() {
		frappe.msgprint({
			title: __("邮件订阅"),
			message: __(
				"报表订阅需要先配置邮件账户和发送频率。下一步会接入 Frappe 的 Auto Email Report/Email Queue，当前可以先手动下载报表。",
			),
			indicator: "blue",
		});
	}

	function show_report_actions(report_id, target) {
		const report = find_report(report_id);
		if (!report) return;

		const popover = $("[data-report-popover]");
		const rect = target.getBoundingClientRect();
		popover
			.html(`
				<button class="btn btn-link btn-sm" data-popover-action="download" data-report-id="${frappe.utils.escape_html(report_id)}">
					${__("下载报表")}
				</button>
				<button class="btn btn-link btn-sm" data-popover-action="${report.name && !report.is_standard ? "edit" : "copy"}" data-report-id="${frappe.utils.escape_html(report_id)}">
					${report.name && !report.is_standard ? __("编辑报表配置") : __("复制为自定义报表")}
				</button>
				<button class="btn btn-link btn-sm" data-popover-action="fields">
					${__("打开字段配置")}
				</button>
			`)
			.css({
				left: `${Math.max(16, rect.left - 112)}px`,
				top: `${rect.bottom + 8}px`,
			})
			.removeClass("d-none");
	}

	$(page.body).on("input", "[data-report-search]", frappe.utils.debounce(function () {
		state.search = this.value || "";
		render();
	}, 250));

	$(page.body).on("click", "[data-action='add-report']", () => frappe.set_route("employee-roster-export"));
	$(page.body).on("click", "[data-action='subscribe']", show_subscription_plan);
	$(page.body).on("click", "[data-action='edit-groups']", () => frappe.set_route("List", "HRMS Employee Report"));
	$(page.body).on("click", "[data-action='sort-group']", () => {
		frappe.set_route("List", "HRMS Employee Report");
	});
	$(page.body).on("click", "[data-toggle-group]", function () {
		const group = this.dataset.toggleGroup;
		if (state.collapsed.has(group)) {
			state.collapsed.delete(group);
		} else {
			state.collapsed.add(group);
		}
		render();
	});
	$(page.body).on("click", "[data-download-report]", function (event) {
		event.stopPropagation();
		download_report(this.dataset.downloadReport);
	});
	$(page.body).on("click", "[data-more-report]", function (event) {
		event.stopPropagation();
		show_report_actions(this.dataset.moreReport, this);
	});
	$(document)
		.off("click.hrms-report-popover")
		.on("click.hrms-report-popover", () => $("[data-report-popover]").addClass("d-none"));
	$(page.body).on("click", "[data-report-popover]", (event) => event.stopPropagation());
	$(page.body).on("click", "[data-popover-action]", function () {
		const report_id = this.dataset.reportId;
		const action = this.dataset.popoverAction;
		const report = report_id ? find_report(report_id) : null;
		$("[data-report-popover]").addClass("d-none");
		if (action === "download") {
			download_report(report_id);
		} else if (action === "edit" && report?.name) {
			frappe.set_route("Form", "HRMS Employee Report", report.name);
		} else if (action === "copy") {
			frappe.set_route("employee-roster-export");
		} else if (action === "fields") {
			frappe.set_route("staff-attribute-settings");
		}
	});
	$(page.body).on("click", ".hrms-report-card", function () {
		download_report(this.dataset.reportId);
	});

	load();
};
