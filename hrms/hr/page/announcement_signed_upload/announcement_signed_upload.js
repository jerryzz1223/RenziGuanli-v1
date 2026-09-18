frappe.pages["announcement-signed-upload"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("上传签字版"), single_column: true });
	const root = $(page.main).html('<div class="hrms-announcement-page"><p class="hrms-announcement-page__intro">审批通过后下载公告、完成签字，再上传签字版。上传是新增归档版本，不改变公告流程状态；已上传记录会移入“签字版记录”，这里只显示尚未上传签字版的公告。</p><div data-signed-list></div></div>').find(".hrms-announcement-page")[0];
	const list = root.querySelector("[data-signed-list]");
	const esc = hrms.announcement.escape.bind(hrms.announcement);
	const time = (value) => esc(value || "—");
	page.set_primary_action(__("签字版记录"), () => frappe.set_route("announcement-signed-records"), "list");
	let openedRouteName = "";

	function open_route_target() {
		const routeName = String((frappe.get_route?.() || [])[1] || "").trim();
		if (!routeName || openedRouteName === routeName) return;
		openedRouteName = routeName;
		// The route identifies the exact announcement, so open its uploader
		// directly instead of making the user find the card and click again.
		upload_signed(routeName);
	}

	function load() {
		list.innerHTML = '<div class="text-muted">正在加载待签字公告…</div>';
		hrms.announcement.call("hrms.api.announcement.list_announcements", { view: "sign" }).then((response) => {
			const rows = response.message || [];
			list.innerHTML = rows.length ? rows.map((row) => `<article class="hrms-announcement-card"><div class="hrms-announcement-card__head"><div><h4>${esc(row.announcement_number)}　${esc(row.subject)}</h4><p class="hrms-announcement-card__meta">${esc(row.issuing_unit_name)}　${hrms.announcement.status(row.status)}　签字状态：${esc(row.signature_status)}</p><p class="hrms-announcement-card__meta">创建时间：${time(row.created_on)}　审批时间：${time(row.reviewed_on)}　签字版上传时间：${time(row.signed_on)}</p></div><button class="btn btn-default btn-sm" data-open="${esc(row.name)}">查看</button></div><div class="hrms-announcement-card__files">${hrms.announcement.versions(row.versions || [], [], "download")}</div><div class="hrms-announcement-editor__actions"><button class="btn btn-primary btn-sm" data-signed-upload="${esc(row.name)}">上传签字版</button></div></article>`).join("") : '<div class="text-muted">暂无待上传签字版的公告。已上传记录请在“签字版记录”中查看。</div>';
			list.querySelectorAll("[data-open]").forEach((node) => node.addEventListener("click", () => open_detail(node.dataset.open)));
			list.querySelectorAll("[data-signed-upload]").forEach((node) => node.addEventListener("click", () => upload_signed(node.dataset.signedUpload)));
			hrms.announcement.bind_file_links(list);
		});
	}
	function open_detail(name) {
		hrms.announcement.call("hrms.api.announcement.get_announcement", { name }).then((response) => {
			const row = response.message || {};
			const dialog = new frappe.ui.Dialog({ title: `${row.announcement_number} · ${row.subject}`, fields: [{ fieldname: "html", fieldtype: "HTML" }] });
			dialog.fields_dict.html.$wrapper.html(`<p>${hrms.announcement.status(row.status)}　签字状态：${esc(row.signature_status)}</p><p><strong>创建时间：</strong>${time(row.created_on)}<br><strong>审批时间：</strong>${time(row.reviewed_on)}<br><strong>签字版上传时间：</strong>${time(row.signed_on)}</p><p><strong>收文单位：</strong>${esc(row.receiving_units)}<br><strong>附本抄送：</strong>${esc(row.cc_units || "—")}<br><strong>发文单位：</strong>${esc(row.issuing_unit_name)}</p><h4>主旨：${esc(row.subject)}</h4><div class="hrms-announcement-card__files">${hrms.announcement.versions(row.versions || [])}</div>`);
			dialog.show();
			hrms.announcement.bind_file_links(dialog.$wrapper[0]);
		});
	}
	function upload_signed(name) {
		hrms.announcement.upload({ name, fieldname: "signed_attachment", accept: [".docx", ".doc", ".xlsx", ".xls", ".pdf", ".jpg", ".png"], on_success: (file) => {
			hrms.announcement.call("hrms.api.announcement.upload_signed_announcement", { name, signed_file_url: file.file_url }).then(() => { frappe.show_alert({ message: __("签字版已归档，未签字版仍保留"), indicator: "green" }); load(); });
		} });
	}
	load();
	open_route_target();
	wrapper.announcement_signed_upload = { load, open_route_target };
};

frappe.pages["announcement-signed-upload"].on_page_show = function (wrapper) {
	wrapper.announcement_signed_upload?.load();
	wrapper.announcement_signed_upload?.open_route_target();
};
