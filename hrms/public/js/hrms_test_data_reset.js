/* Temporary TEST-HRMS trial control.  Remove the marked hooks.py entries, this
 * asset, its CSS companion, and api/test_data_reset.py to retire the feature. */
(function () {
	const METHOD = "hrms.api.test_data_reset";
	const CONFIRMATION_TEXT = "CLEAR TEST-HRMS PAGE DATA";
	const BUTTON_CLASS = "hrms-test-data-reset";
	let lastRoute = "";
	let enabled = false;

	function route() {
		return JSON.stringify(frappe.get_route ? frappe.get_route() : []);
	}

	function removeButton() {
		document.querySelector(`.${BUTTON_CLASS}`)?.remove();
	}

	function addButton(context) {
		removeButton();
		enabled = Boolean(context?.enabled);
		const button = document.createElement("button");
		button.type = "button";
		button.className = `btn ${enabled ? "btn-danger" : "btn-default"} btn-sm ${BUTTON_CLASS}`;
		button.textContent = __("清除本页测试数据");
		button.title = enabled
			? __("仅删除 TEST-HRMS 公司当前页面的录入数据")
			: context?.message || __("当前页面没有可安全清除的测试录入数据");
		button.addEventListener("click", () => {
			if (enabled) confirmReset();
			else frappe.show_alert({ message: button.title, indicator: "blue" });
		});
		document.body.appendChild(button);
	}

	function refresh() {
		const currentRoute = route();
		if (currentRoute === lastRoute) return;
		lastRoute = currentRoute;
		enabled = false;
		removeButton();
		frappe.call({ method: `${METHOD}.get_test_data_reset_context`, args: { route: currentRoute }, quiet: true })
			.then((response) => addButton(response.message))
			.catch(() => removeButton());
	}

	function confirmReset() {
		if (!enabled) return;
		// Load immediately before opening the dialog so the visual preview reflects
		// the records that are eligible for deletion at confirmation time.
		frappe.call({ method: `${METHOD}.get_test_data_reset_context`, args: { route: route() }, quiet: true })
			.then((response) => openResetDialog(response.message))
			.catch(() => frappe.show_alert({ message: __("无法读取当前页面的测试数据预览"), indicator: "red" }));
	}

	function openResetDialog(context) {
		if (!context?.enabled) {
			frappe.show_alert({ message: context?.message || __("当前页面没有可安全清除的测试录入数据"), indicator: "blue" });
			return;
		}
		const dialog = new frappe.ui.Dialog({
			title: __("确认清除测试数据"),
			fields: [{ fieldtype: "HTML", fieldname: "reset_preview" }],
			primary_action_label: __("确认清除"),
			primary_action: () => {
				dialog.hide();
				frappe.call({
					method: `${METHOD}.clear_test_page_data`,
					args: { route: route(), confirm: CONFIRMATION_TEXT },
					freeze: true,
					freeze_message: __("正在清除测试数据..."),
				}).then((response) => {
					const result = response.message || {};
					frappe.show_alert({ message: __("已清除 {0} 条{1}", [result.count || 0, result.label || ""]), indicator: "green" });
					lastRoute = "";
					refresh();
					frappe.router?.trigger?.("change");
				});
			},
		});
		dialog.fields_dict.reset_preview.$wrapper.html(renderPreview(context));
		dialog.show();
	}

	function renderPreview(context) {
		const escape = frappe.utils.escape_html;
		const rows = (context.preview || []).map((row) => {
			const samples = (row.sample_names || []).map((name) => escape(name)).join("、") || __("无");
			const remaining = row.remaining_count ? ` ${__("另有 {0} 条", [row.remaining_count])}` : "";
			return `<tr><td>${escape(__(row.doctype))}</td><td class="text-right">${row.count}</td><td>${samples}${remaining}</td></tr>`;
		}).join("");
		return `
			<div class="alert alert-warning">
				${escape(__("仅会删除 TEST-HRMS 公司中当前页面逻辑对应的数据；不会删除其他页面或正式公司数据。"))}
			</div>
			<p>${escape(__("将删除 {0} 条{1}：", [context.count || 0, context.label || ""]))}</p>
			<table class="table table-bordered table-sm">
				<thead><tr><th>${escape(__("数据类型"))}</th><th class="text-right">${escape(__("数量"))}</th><th>${escape(__("记录样例（最多 5 条）"))}</th></tr></thead>
				<tbody>${rows || `<tr><td colspan="3" class="text-muted">${escape(__("当前没有可删除的测试记录"))}</td></tr>`}</tbody>
			</table>`;
	}

	function start() {
		if (!window.frappe?.router) return;
		frappe.router.on("change", refresh);
		setTimeout(refresh, 0);
	}

	$(document).ready(start);
})();
