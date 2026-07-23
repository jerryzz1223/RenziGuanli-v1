frappe.pages["hrms-data-operations"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("数据处理中心"),
		single_column: true,
	});
	page.set_primary_action(__("刷新状态"), () => load(), "refresh");

	function escape(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	function level_class(level) {
		return level === "危险" ? "danger" : level === "提醒" ? "warning" : "success";
	}

	function render(data) {
		const queues = data.queues || [];
		const actions = data.actions || [];
		const jobs = data.relevant_jobs || [];
		$(page.body).html(`
			<div class="hrms-data-operations">
				<div class="hrms-data-operations__notice alert alert-info">
					<strong>${__("管理员专用")}</strong><br>
					${__("这里只显示人资数据处理所需的队列状态与入口，不展示数据库、密码、系统日志或全量后台任务。")}
				</div>
				<div class="hrms-data-operations__summary">
					<div class="hrms-data-operations__card"><small>${__("待处理任务")}</small><strong>${escape(data.queued_total || 0)}</strong><span>${__("队列上限：{0}", [data.queue_limit || "-"])}</span></div>
					<div class="hrms-data-operations__card is-${level_class(data.level)}"><small>${__("运行状态")}</small><strong>${escape(data.level || "-")}</strong><span>${escape(data.message || "")}</span></div>
				</div>
				<div class="hrms-data-operations__panel">
					<h4>${__("后台队列")}</h4>
					<table class="table table-bordered"><thead><tr><th>${__("队列")}</th><th>${__("等待")}</th><th>${__("运行中")}</th><th>${__("状态")}</th></tr></thead><tbody>
						${queues.map((row) => `<tr><td>${escape(row.name)}</td><td>${escape(row.pending)}</td><td>${escape(row.running)}</td><td><span class="indicator-pill ${level_class(row.level)}">${escape(row.level)}</span></td></tr>`).join("") || `<tr><td colspan="4" class="text-muted">${__("暂无队列数据")}</td></tr>`}
					</tbody></table>
				</div>
				<div class="hrms-data-operations__panel">
					<h4>${__("人资相关待处理任务")}</h4>
					<p class="text-muted">${__("出现大量“关联记录清理”通常表示此前正在清理或撤回大量导入记录；请等待完成后再执行新的大批量操作。")}</p>
					<table class="table table-bordered"><thead><tr><th>${__("队列")}</th><th>${__("类型")}</th><th>${__("任务")}</th></tr></thead><tbody>
						${jobs.map((row) => `<tr><td>${escape(row.queue)}</td><td>${escape(row.type)}</td><td><code>${escape(row.method)}</code></td></tr>`).join("") || `<tr><td colspan="3" class="text-muted">${__("没有人资相关待处理任务")}</td></tr>`}
					</tbody></table>
				</div>
				<div class="hrms-data-operations__actions">${actions.map((action) => `<button class="btn btn-default" data-route="${escape(action.route)}">${escape(action.label)}</button>`).join("")}</div>
			</div>
		`);
		page.body.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => {
			const route = button.dataset.route.replace(/^\/desk\//, "").split("/");
			frappe.set_route(...route);
		}));
	}

	function load() {
		$(page.body).html(`<div class="text-muted">${__("正在读取数据处理状态...")}</div>`);
		return frappe.call("hrms.api.data_operations.get_data_operations_overview")
			.then((response) => render(response.message || {}));
	}

	load();
};
