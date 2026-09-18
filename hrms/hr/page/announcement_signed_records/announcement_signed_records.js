frappe.pages["announcement-signed-records"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("签字版记录"), single_column: true });
	const root = $(page.main).html('<div class="hrms-announcement-page"><p class="hrms-announcement-page__intro">查看已经上传并归档的签字版；未上传的公告不会出现在这里。</p><div data-signed-history></div></div>').find(".hrms-announcement-page")[0];
	const list = root.querySelector("[data-signed-history]");
	const esc = hrms.announcement.escape.bind(hrms.announcement);
	const time = (value) => esc(value || "—");
	const routeName = String((frappe.get_route?.() || [])[1] || "").trim();
	let openedRoute = false;
	page.set_secondary_action(__("返回上传签字版"), () => frappe.set_route("announcement-signed-upload"), "left");

	function load() {
		list.innerHTML = '<div class="text-muted">正在加载签字版记录…</div>';
		hrms.announcement.call("hrms.api.announcement.list_announcements", { view: "signed_records", sort_field: "signed_on", sort_order: "desc" }).then((response) => {
			const rows = response.message || [];
			const body = rows.length ? rows.map((row) => `<tr><td>${esc(row.announcement_number || "—")}</td><td>${esc(row.subject || "—")}</td><td>${esc(row.signed_by_name || "—")}</td><td>${time(row.signed_on)}</td><td>${time(row.reviewed_on)}</td><td>${hrms.announcement.versions(row.versions || [], [], "download")}</td><td><button type="button" class="btn btn-default btn-xs" data-signed-open="${esc(row.name)}">查看</button></td></tr>`).join("") : '<tr><td class="hrms-announcement-table__empty" colspan="7">暂无签字版记录。</td></tr>';
			list.innerHTML = `<div class="table-responsive hrms-announcement-approval-history"><table class="table table-bordered table-hover"><thead><tr><th>公告编号</th><th>主旨</th><th>签字上传人</th><th>签字版上传时间</th><th>审批时间</th><th>签字版文件</th><th>操作</th></tr></thead><tbody>${body}</tbody></table></div><p class="text-muted hrms-announcement-table__summary">共 ${rows.length} 条签字版记录</p>`;
			list.querySelectorAll("[data-signed-open]").forEach((button) => button.addEventListener("click", () => open_detail(button.dataset.signedOpen)));
			hrms.announcement.bind_file_links(list);
			if (routeName && !openedRoute) {
				openedRoute = true;
				if (rows.some((row) => row.name === routeName)) open_detail(routeName);
			}
		});
	}

	function open_detail(name) {
		hrms.announcement.call("hrms.api.announcement.get_announcement", { name }).then((response) => {
			const row = response.message || {};
			const dialog = new frappe.ui.Dialog({ title: `${row.announcement_number || "公告"} · ${row.subject}`, fields: [{ fieldname: "html", fieldtype: "HTML" }] });
			dialog.fields_dict.html.$wrapper.html(`<div class="hrms-announcement-card"><p>${hrms.announcement.status(row.status)}　签字状态：${esc(row.signature_status)}</p><p><strong>提交时间：</strong>${time(row.submitted_on)}<br><strong>审批时间：</strong>${time(row.reviewed_on)}<br><strong>签字版上传时间：</strong>${time(row.signed_on)}<br><strong>签字上传人：</strong>${esc(row.signed_by_name || "—")}</p><p><strong>审核人：</strong>${esc(row.reviewer_name || "—")}　<strong>核准人：</strong>${esc(row.approver_name || "—")}</p><h4>主旨：${esc(row.subject)}</h4><div class="hrms-announcement-card__files">${hrms.announcement.versions(row.versions || [], [], "download")}</div></div>`);
			dialog.show();
			hrms.announcement.bind_file_links(dialog.$wrapper[0]);
		});
	}

	load();
	wrapper.announcement_signed_records = { load };
};

frappe.pages["announcement-signed-records"].on_page_show = function (wrapper) {
	wrapper.announcement_signed_records?.load();
};
