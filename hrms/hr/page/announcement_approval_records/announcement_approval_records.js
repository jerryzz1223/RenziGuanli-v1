frappe.pages["announcement-approval-records"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("公告审批记录"), single_column: true });
	const root = $(page.main).html('<div class="hrms-announcement-page"><p class="hrms-announcement-page__intro">查看已完成审批的公告记录，包含审核通过、审核驳回及历史兼容状态。</p><div data-approval-history></div></div>').find(".hrms-announcement-page")[0];
	const list = root.querySelector("[data-approval-history]");
	const esc = hrms.announcement.escape.bind(hrms.announcement);
	const time = (value) => esc(value || "—");
	const routeName = String((frappe.get_route?.() || [])[1] || "").trim();
	let openedRoute = false;
	page.set_secondary_action(__("返回公告审批"), () => frappe.set_route("announcement-approval"), "left");

	function load() {
		list.innerHTML = '<div class="text-muted">正在加载审批记录…</div>';
		hrms.announcement.call("hrms.api.announcement.list_announcements", { view: "approval_records", sort_field: "reviewed_on", sort_order: "desc" }).then((response) => {
			const rows = response.message || [];
			const body = rows.length ? rows.map((row) => `<tr><td>${esc(row.announcement_number || "—")}</td><td>${esc(row.subject || "—")}</td><td>${hrms.announcement.status(row.status)}</td><td>${esc(row.reviewer_name || "—")}</td><td>${time(row.reviewed_on)}</td><td>${esc(row.approval_comment || "—")}</td><td><button type="button" class="btn btn-default btn-xs" data-history-open="${esc(row.name)}">查看</button></td></tr>`).join("") : '<tr><td class="hrms-announcement-table__empty" colspan="7">暂无审批记录。</td></tr>';
			list.innerHTML = `<div class="table-responsive hrms-announcement-approval-history"><table class="table table-bordered table-hover"><thead><tr><th>公告编号</th><th>主旨</th><th>审核状态</th><th>审核人</th><th>审核时间</th><th>审核意见</th><th>操作</th></tr></thead><tbody>${body}</tbody></table></div><p class="text-muted hrms-announcement-table__summary">共 ${rows.length} 条审批记录</p>`;
			list.querySelectorAll("[data-history-open]").forEach((button) => button.addEventListener("click", () => open_detail(button.dataset.historyOpen)));
			if (routeName && !openedRoute) { openedRoute = true; open_detail(routeName); }
		});
	}

	function open_detail(name) {
		hrms.announcement.call("hrms.api.announcement.get_announcement", { name }).then((response) => {
			const row = response.message || {};
			const dialog = new frappe.ui.Dialog({
				title: `${row.announcement_number || "公告"} · ${row.subject}`,
				fields: [
					{ fieldname: "meta", fieldtype: "HTML" },
					{ fieldname: "approval_comment", fieldtype: "Small Text", label: __("审核意见"), read_only: true },
					{ fieldname: "approver_name", fieldtype: "Data", label: __("核准人"), read_only: true },
				],
				primary_action_label: __("关闭"),
				primary_action() { dialog.hide(); },
			});
			const rendered_content = hrms.announcement.content_html(row.content);
			dialog.fields_dict.meta.$wrapper.html(`<div class="hrms-announcement-card"><p>${hrms.announcement.status(row.status)}　签字状态：${esc(row.signature_status)}</p><p><strong>审核人：</strong>${esc(row.reviewer_name || "—")}<br><strong>审核时间：</strong>${time(row.reviewed_on)}<br><strong>提交时间：</strong>${time(row.submitted_on)}</p><p><strong>收文单位：</strong>${esc(row.receiving_units)}<br><strong>附本抄送：</strong>${esc(row.cc_units || "—")}<br><strong>发文单位：</strong>${esc(row.issuing_unit_name)}<br><strong>发文者：</strong>${esc(row.issuer_name)}</p><h4>主旨：${esc(row.subject)}</h4><div class="hrms-announcement-preview hrms-announcement-preview--rich">${rendered_content}</div><p>相关附件：${hrms.announcement.files(row.files)}</p></div>`);
			dialog.set_values({ approval_comment: row.approval_comment || "", approver_name: row.approver_name || "" });
			dialog.show();
			hrms.announcement.bind_file_links(dialog.$wrapper[0]);
		});
	}

	load();
};
