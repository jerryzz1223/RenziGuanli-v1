frappe.pages["announcement-submit"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("提交公告"), single_column: true });
	const root = $(page.main).html('<div class="hrms-announcement-page"><p class="hrms-announcement-page__intro">在此创建公告、保存草稿并提交审核；提交动作完成后请到“提交记录”查看进度，这里只保留待处理草稿和驳回项。</p><div data-submit-body></div></div>').find(".hrms-announcement-page")[0];
	const body = root.querySelector("[data-submit-body]");
	let current = null;
	const esc = hrms.announcement.escape.bind(hrms.announcement);
	const time = (value) => esc(value || "—");
	page.set_primary_action(__("新建公告"), () => open_editor(null), "add");
	page.set_secondary_action(__("提交记录"), () => frappe.set_route("announcement-submission-records"), "list");

	function load() {
		body.innerHTML = '<div class="text-muted">正在加载待处理列表…</div>';
		hrms.announcement.call("hrms.api.announcement.list_announcements", { view: "submit" }).then((response) => {
			const rows = response.message || [];
			body.innerHTML = rows.length ? `<div class="list-group">${rows.map((row) => `<button class="list-group-item list-group-item-action" data-draft="${esc(row.name)}"><strong>${esc(row.announcement_number || "未提交草稿")}</strong>　${esc(row.subject || "未填写主旨")} <span class="pull-right">${hrms.announcement.status(row.status)}　创建：${time(row.created_on)}　提交：${time(row.submitted_on)}</span></button>`).join("")}</div>` : '<div class="text-muted">暂无待处理公告，点击右上角“新建公告”。已完成审批的公告可在“提交记录”中查看。</div>';
			body.querySelectorAll("[data-draft]").forEach((node) => node.addEventListener("click", () => open_editor(node.dataset.draft)));
		});
	}

	function open_editor(name) {
		const show = (data) => {
			if (data && data.status !== "草稿") {
				current = data;
				show_saved();
				return;
			}
			const dialog = new frappe.ui.Dialog({
				title: name ? __("编辑公告草稿") : __("新建公告"),
				fields: [
					{ fieldname: "subject", fieldtype: "Data", label: __("主旨"), reqd: 1 },
					{ fieldname: "receiving_units", fieldtype: "Small Text", label: __("收文单位"), reqd: 1, description: __("多个单位可用顿号或换行分隔，也可手动填写。") },
					{ fieldname: "cc_units", fieldtype: "Small Text", label: __("附本抄送") },
					{ fieldname: "issuing_unit", fieldtype: "Link", options: "Department", label: __("发文单位"), reqd: 1 },
					{ fieldname: "issuer_name", fieldtype: "Data", label: __("发文者"), reqd: 1, description: __("可填写姓名或账号，系统会尝试匹配账号；无法匹配时保留手动填写。") },
					{ fieldname: "approver_name", fieldtype: "Data", label: __("核准人") },
					{ fieldname: "content", fieldtype: "Text Editor", label: __("正文") },
				],
				primary_action_label: __("保存草稿"),
				primary_action(values) {
					dialog.disable_primary_action();
					hrms.announcement.call("hrms.api.announcement.save_announcement", { payload: values, name: name || "" }).then((response) => {
						dialog.hide();
						current = response.message;
						show_saved();
					}).finally(() => dialog.enable_primary_action());
				},
			});
			if (data) dialog.set_values(data);
			dialog.show();
		};
		if (name) hrms.announcement.call("hrms.api.announcement.get_announcement", { name }).then((response) => show(response.message));
		else show(null);
	}

	function show_saved() {
		const data = current || {};
		const template_file = (url, label) => {
			const file = (data.files || []).find((item) => item.file_url === url) || {};
			return url ? `<button type="button" class="btn btn-link btn-sm" data-file-url="${esc(url)}" data-file-name="${esc(file.file_name || label)}" data-announcement-name="${esc(data.name)}">${label}</button><button type="button" class="btn btn-link btn-xs" data-download="${esc(url)}">下载</button>` : "";
		};
		const rendered_content = hrms.announcement.content_html(data.content);
		body.innerHTML = `<div class="hrms-announcement-card"><div class="hrms-announcement-card__head"><div><h4>${esc(data.announcement_number || "未提交草稿")}　${esc(data.subject)}</h4><p class="hrms-announcement-card__meta">${hrms.announcement.status(data.status)}　发文者：${esc(data.issuer_name)}　发文单位：${esc(data.issuing_unit_name || data.issuing_unit)}</p></div><div class="hrms-announcement-editor__actions"><button class="btn btn-default btn-sm" data-back>返回列表</button>${data.status === "草稿" ? '<button class="btn btn-default btn-sm" data-edit>编辑草稿</button>' : ""}</div></div><p><strong>创建时间：</strong>${time(data.created_on)}　<strong>提交时间：</strong>${time(data.submitted_on)}　<strong>审批时间：</strong>${time(data.reviewed_on)}</p><p><strong>收文单位：</strong>${esc(data.receiving_units)}　<strong>附本抄送：</strong>${esc(data.cc_units || "—")}</p><div class="hrms-announcement-preview hrms-announcement-preview--rich">${rendered_content}</div><div class="hrms-announcement-editor__actions"><button class="btn btn-default btn-sm" data-source-upload ${data.status === "草稿" ? "" : "disabled"}>上传提交附件</button>${data.status === "草稿" ? '<button class="btn btn-primary btn-sm" data-submit>提交公告并生成 Word/Excel</button>' : ""}${template_file(data.word_template, "预览 Word 待填写模板")}${template_file(data.excel_template, "预览 Excel 待填写模板")}</div><div><strong>相关文件：</strong>${hrms.announcement.files(data.files || [], ["word_template", "excel_template"])}</div></div>`;
		body.querySelector("[data-back]")?.addEventListener("click", () => { current = null; load(); });
		body.querySelector("[data-edit]")?.addEventListener("click", () => open_editor(data.name));
		body.querySelector("[data-submit]")?.addEventListener("click", () => {
			frappe.confirm(__("提交后将生成正式编号并进入审核，正文和收发信息不能再修改。确认提交？"), () => {
				hrms.announcement.call("hrms.api.announcement.submit_announcement", { name: data.name }).then((response) => { current = response.message; frappe.show_alert({ message: __("公告已提交，Word/Excel待填写模板已生成"), indicator: "green" }); show_saved(); });
			});
		});
		body.querySelector("[data-source-upload]")?.addEventListener("click", () => hrms.announcement.upload({ name: data.name, fieldname: "source_attachment", on_success: () => { hrms.announcement.call("hrms.api.announcement.get_announcement", { name: data.name }).then((response) => { current = response.message; show_saved(); }); } }));
		body.querySelectorAll("[data-download]").forEach((node) => node.addEventListener("click", () => hrms.announcement.open_file(node.dataset.download)));
		hrms.announcement.bind_file_links(body);
	}
	load();
};
