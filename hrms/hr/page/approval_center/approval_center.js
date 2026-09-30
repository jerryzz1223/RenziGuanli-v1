frappe.pages["approval-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("审批管理"), single_column: true });
	const root = $(page.main).html('<div class="hrms-approval-center"></div>').find(".hrms-approval-center")[0];
	let requestId = 0;
	let shownRows = [];
	const escape = (value) => frappe.utils.escape_html(String(value ?? ""));
	const view = () => (frappe.get_route?.()[1] === "approved" ? "approved" : "pending");

	function render(rows, kind, hasMore) {
		const approved = kind === "approved";
		const head = approved
			? ["审批事项", "审批结果", "审批人", "审批日期", "操作"]
			: ["待审批事项", "状态", "提交时间", "操作"];
		const body = rows.map((row, index) => `<tr>
			<td><strong>${escape(row.title || row.name)}</strong><div class="text-muted">${escape(row.type)} · ${escape(row.name)}</div></td>
			<td>${escape(row.status)}</td>
			${approved
				? `<td>${escape(row.approved_by_name || row.approved_by || "未记录")}</td><td>${escape(row.approved_on || "未记录")}</td>`
				: `<td>${escape(row.submitted_on || "—")}</td>`}
			<td><button type="button" class="btn btn-default btn-sm" data-approval-open="${index}">${approved ? "查看记录" : "前往审批"}</button></td>
		</tr>`).join("");
		root.innerHTML = `<div class="hrms-approval-center__top">
			<div><h2>审批管理</h2><p>集中查看当前账号可访问的审批事项。</p></div>
			<button type="button" class="btn btn-default btn-sm" data-approval-refresh>刷新</button>
		</div><div class="hrms-approval-center__tabs">
			<a class="${approved ? "" : "active"}" href="/desk/approval-center/pending">待办审批</a>
			<a class="${approved ? "active" : ""}" href="/desk/approval-center/approved">已审批</a>
		</div><div class="hrms-approval-center__summary">已显示${approved ? "通过记录" : "待办事项"} ${rows.length} 条${hasMore ? "，可继续加载" : ""}</div>
		<div class="table-responsive"><table class="table table-hover"><thead><tr>${head.map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>
		${body || `<tr><td colspan="${head.length}" class="text-muted hrms-approval-center__empty">${approved ? "暂无已通过的审批记录。" : "暂无待审批事项。"}</td></tr>`}
		</tbody></table></div>${hasMore ? '<div class="hrms-approval-center__more"><button type="button" class="btn btn-default" data-approval-more>加载更多</button></div>' : ""}`;
		root.querySelector("[data-approval-refresh]").addEventListener("click", () => load());
		root.querySelector("[data-approval-more]")?.addEventListener("click", () => load(false));
		root.querySelectorAll("[data-approval-open]").forEach((button) => button.addEventListener("click", () => {
			const route = rows[Number(button.dataset.approvalOpen)]?.route;
			if (Array.isArray(route) && route.length) frappe.set_route(...route);
		}));
	}

	function load(reset = true) {
		const current = ++requestId;
		const kind = view();
		const pageStart = reset ? 0 : shownRows.length;
		page.set_title(kind === "approved" ? __("已审批") : __("待办审批"));
		if (reset) {
			shownRows = [];
			root.innerHTML = '<div class="hrms-approval-center__state">正在读取审批事项…</div>';
		} else {
			const button = root.querySelector("[data-approval-more]");
			if (button) { button.disabled = true; button.textContent = "正在加载…"; }
		}
		Promise.resolve().then(() => frappe.call({
			method: "hrms.api.approval_center.list_approvals", args: { view: kind, page_length: 50, page_start: pageStart },
		})).then((response) => {
			if (current !== requestId) return;
			const data = response.message || {};
			shownRows = shownRows.concat(data.items || []);
			render(shownRows, kind, Boolean(data.has_more));
		}).catch(() => {
			if (current !== requestId) return;
			if (reset) root.innerHTML = '<div class="alert alert-danger">审批记录读取失败，请重新打开页面重试。</div>';
			else { frappe.show_alert?.({ message: __("更多审批记录读取失败，请重试。"), indicator: "orange" }); render(shownRows, kind, true); }
		});
	}

	wrapper.hrms_approval_center = { load };
	load();
};

frappe.pages["approval-center"].on_page_show = function (wrapper) {
	wrapper.hrms_approval_center?.load();
};
