frappe.pages["announcement-directory"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("公告目录"), single_column: true });
	const root = $(page.main).html('<div class="hrms-announcement-page"><p class="hrms-announcement-page__intro">同一公告编号下，未签字版和签字版分别占一行；两行共用同一个编号。点击未签字状态可进入签字处理；审核通过和已签字仅作状态展示。点击表头可切换升降序，筛选框支持按列查询。</p><div data-announcement-list></div></div>').find(".hrms-announcement-page")[0];
	const list = root.querySelector("[data-announcement-list]");
	const escape = hrms.announcement.escape.bind(hrms.announcement);
	const columns = [
		{ key: "announcement_date", label: "年度", sortable: true },
		{ key: "sequence", label: "序号", sortable: true },
		{ key: "issuer_name", label: "发文者", sortable: true },
		{ key: "subject", label: "主旨", sortable: true },
		{ key: "announcement_number", label: "编号", sortable: true },
		{ key: "version_label", label: "版本", sortable: true, select: [["", "全部"], ["未签字版", "未签字版"], ["签字版", "签字版"]] },
		{ key: "created_on", label: "创建时间", sortable: true },
		{ key: "reviewed_on", label: "审批时间", sortable: true },
		{ key: "signed_on", label: "签字版上传时间", sortable: true },
		{ key: "reviewer_name", label: "审核人", sortable: true },
		{ key: "status", label: "审核状态", sortable: true, select: [["", "全部"], ["审核通过", "审核通过"], ["待上传签字", "待上传签字"], ["已签字", "已签字"]] },
		{ key: "signature_status", label: "签字状态", sortable: true, select: [["", "全部"], ["未签字", "未签字"], ["已签字", "已签字"]] },
		{ key: "actions", label: "操作", sortable: false, filterable: false },
	];
	const state = { rows: [], filters: {}, sortField: "announcement_date", sortOrder: "desc" };
	function download_export(values) {
		const params = new URLSearchParams({
			current_filters: JSON.stringify(state.filters),
			sort_field: state.sortField,
			sort_order: state.sortOrder,
			start_date: values.start_date || "",
			end_date: values.end_date || "",
		});
		window.open(frappe.urllib.get_full_url(`/api/method/hrms.api.announcement.download_announcement_directory_export?${params.toString()}`), "_blank");
	}
	page.set_primary_action(__("导出 Excel"), () => {
		const dialog = new frappe.ui.Dialog({
			title: __("导出公告 Excel"),
			fields: [
				{ fieldname: "start_date", fieldtype: "Date", label: __("开始日期") },
				{ fieldname: "end_date", fieldtype: "Date", label: __("结束日期") },
				{ fieldname: "hint", fieldtype: "HTML", options: '<p class="text-muted">按页面显示的“公告日期”筛选，包含开始和结束当天；留空表示不限制日期。已签字版按签字版上传日期，否则按审批日期。</p>' },
			],
			primary_action_label: __("导出"),
			primary_action: () => {
				const values = dialog.get_values() || {};
				if (values.start_date && values.end_date && values.start_date > values.end_date) {
					frappe.msgprint({ title: __("日期范围不正确"), message: __("开始日期不能晚于结束日期。"), indicator: "orange" });
					return;
				}
				dialog.hide();
				download_export(values);
			},
		});
		dialog.show();
	}, "download");

	function normalise(value) {
		return String(value == null ? "" : value).trim().toLocaleLowerCase();
	}

	function valueFor(row, key) {
		if (key === "files" || key === "actions") return "";
		return row[key] == null ? "" : row[key];
	}

	function sortedRows(rows) {
		const key = state.sortField;
		const multiplier = state.sortOrder === "asc" ? 1 : -1;
		return [...rows].sort((left, right) => {
			const leftValue = valueFor(left, key);
			const rightValue = valueFor(right, key);
			const leftEmpty = leftValue === "" || leftValue == null;
			const rightEmpty = rightValue === "" || rightValue == null;
			if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
			if (key === "sequence") return (Number(leftValue || 0) - Number(rightValue || 0)) * multiplier;
			return String(leftValue).localeCompare(String(rightValue), "zh-Hans-CN", { numeric: true }) * multiplier;
		});
	}

	function filteredRows() {
		return state.rows.filter((row) => columns.every((column) => {
			const query = normalise(state.filters[column.key]);
			return !query || normalise(valueFor(row, column.key)).includes(query);
		}));
	}

	function filterControl(column) {
		if (column.filterable === false) return "";
		if (column.select) {
			return `<select class="form-control input-xs" data-announcement-filter="${column.key}">${column.select.map(([value, label]) => `<option value="${escape(value)}" ${state.filters[column.key] === value ? "selected" : ""}>${escape(label)}</option>`).join("")}</select>`;
		}
		if (column.key === "announcement_date") return "";
		return `<input class="form-control input-xs" data-announcement-filter="${column.key}" value="${escape(state.filters[column.key] || "")}" placeholder="搜索">`;
	}

	function sortIndicator(column) {
		if (!column.sortable) return "";
		const active = state.sortField === column.key;
		return `<button class="hrms-announcement-table__sort ${active ? "is-sorted" : ""}" data-announcement-sort="${column.key}" aria-sort="${active ? (state.sortOrder === "asc" ? "ascending" : "descending") : "none"}">${escape(column.label)} <span aria-hidden="true">${active ? (state.sortOrder === "asc" ? "↑" : "↓") : "↕"}</span></button>`;
	}

	function statusAction(row, field) {
		const isReview = field === "status";
		const value = row[field] || (isReview ? "草稿" : "未签字");
		const labelClass = isReview
			? (value === "审核驳回" ? "text-danger" : "text-info")
			: (value === "已签字" ? "text-success" : "text-warning");
		const isCompleted = isReview ? value === "审核通过" : value === "已签字";
		const isLockedUnsigned = field === "signature_status" && value === "未签字" && row.has_signed_version;
		if (isLockedUnsigned) return `<span class="hrms-announcement-status-link--locked">${escape(value)}</span>`;
		if (isCompleted) return `<span class="${labelClass}">${escape(value)}</span>`;
		const route = isReview ? "announcement-approval" : "announcement-signed-upload";
		return `<button type="button" class="hrms-announcement-status-link ${labelClass}" data-announcement-route="${route}" data-announcement-name="${escape(row.name)}">${escape(value)}</button>`;
	}

	function render() {
		const rows = sortedRows(filteredRows());
		const header = columns.map((column) => `<th>${sortIndicator(column)}</th>`).join("");
		const filters = columns.map((column) => `<th>${filterControl(column)}</th>`).join("");
		const body = rows.length ? rows.map((row) => `<tr><td>${escape(row.announcement_date || "—")}</td><td>${escape(row.sequence)}</td><td>${escape(row.issuer_name)}</td><td><a data-open="${escape(row.name)}">${escape(row.subject)}</a></td><td>${escape(row.announcement_number)}</td><td>${row.version_label === "签字版" ? '<span class="text-success">签字版</span>' : '<span class="text-warning">未签字版</span>'}</td><td>${escape(row.created_on || "—")}</td><td>${escape(row.reviewed_on || "—")}</td><td>${escape(row.signed_on || "—")}</td><td>${escape(row.reviewer_name || "—")}</td><td>${statusAction(row, "status")}</td><td>${statusAction(row, "signature_status")}</td><td><button class="btn btn-xs btn-default" data-open="${escape(row.name)}">查看</button></td></tr>`).join("") : `<tr><td class="hrms-announcement-table__empty" colspan="${columns.length}">没有符合筛选条件的公告。</td></tr>`;
		list.innerHTML = `<div class="hrms-announcement-table-wrap"><table class="table table-bordered table-hover hrms-announcement-table"><thead><tr>${header}</tr><tr class="hrms-announcement-table__filter-row">${filters}</tr></thead><tbody>${body}</tbody></table></div><p class="text-muted hrms-announcement-table__summary">当前显示 ${rows.length} 条，共 ${state.rows.length} 条</p>`;
		list.querySelectorAll("[data-open]").forEach((node) => node.addEventListener("click", () => open_detail(node.dataset.open)));
		list.querySelectorAll("[data-announcement-route]").forEach((node) => node.addEventListener("click", () => frappe.set_route(node.dataset.announcementRoute, node.dataset.announcementName)));
		list.querySelectorAll("[data-announcement-sort]").forEach((button) => button.addEventListener("click", () => {
			const field = button.dataset.announcementSort;
			state.sortOrder = state.sortField === field && state.sortOrder === "asc" ? "desc" : "asc";
			state.sortField = field;
			render();
			list.querySelector(`[data-announcement-sort="${field}"]`)?.focus({ preventScroll: true });
		}));
		list.querySelectorAll("[data-announcement-filter]").forEach((control) => control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
			state.filters[control.dataset.announcementFilter] = control.value;
			render();
			const next = list.querySelector(`[data-announcement-filter="${control.dataset.announcementFilter}"]`);
			if (next) {
				next.focus();
				if (typeof next.setSelectionRange === "function") next.setSelectionRange(next.value.length, next.value.length);
			}
		}));
		hrms.announcement.bind_file_links(list);
	}

	function load() {
		list.innerHTML = '<div class="text-muted">正在加载公告目录…</div>';
		hrms.announcement.call("hrms.api.announcement.list_announcements", { view: "directory", sort_field: state.sortField, sort_order: state.sortOrder }).then((response) => {
			state.rows = response.message || [];
			render();
		}).catch(() => {
			list.innerHTML = '<div class="text-danger">公告目录加载失败，请刷新后重试。</div>';
		});
	}

	function open_detail(name) {
		hrms.announcement.call("hrms.api.announcement.get_announcement", { name }).then((response) => {
			const row = response.message || {};
			const originalFile = (row.files || []).find((file) => file.file_url === row.word_template);
			const originalName = originalFile?.file_name || String(row.word_template || "").split("/").pop() || "公告原件.docx";
			const originalDownload = row.word_template
				? `<div class="hrms-announcement-detail-actions"><button type="button" class="btn btn-primary btn-sm" data-download-url="${escape(row.word_template)}" data-download-name="${escape(originalName)}">下载原件</button></div>`
				: "";
			const dialog = new frappe.ui.Dialog({ title: `${row.announcement_number || "公告"} · ${row.subject}`, fields: [{ fieldname: "html", fieldtype: "HTML" }] });
			dialog.$wrapper.addClass("hrms-announcement-detail-dialog");
			dialog.fields_dict.html.$wrapper.html(`<div class="hrms-announcement-card hrms-announcement-detail-card"><p>${hrms.announcement.status(row.status)}　签字状态：${escape(row.signature_status)}</p><p><strong>创建时间：</strong>${escape(row.created_on || "—")}<br><strong>审批时间：</strong>${escape(row.reviewed_on || "—")}<br><strong>签字版上传时间：</strong>${escape(row.signed_on || "—")}</p><p><strong>公告日期：</strong>${escape(row.announcement_date || "—")}（按公告事件记录）</p><p><strong>收文单位：</strong>${escape(row.receiving_units)}</p><p><strong>附本抄送：</strong>${escape(row.cc_units || "—")}</p><p><strong>发文单位：</strong>${escape(row.issuing_unit_name)}</p><p><strong>发文者：</strong>${escape(row.issuer_name)}　<strong>审核：</strong>${escape(row.reviewer_name || "—")}　<strong>核准：</strong>${escape(row.approver_name || "—")}</p><h4>主旨：${escape(row.subject)}</h4><div class="hrms-announcement-preview hrms-announcement-preview--rich">${hrms.announcement.content_html(row.content)}</div><div class="hrms-announcement-detail-word" data-detail-word-preview><div class="text-muted">正在加载 Word 待填写模板预览…</div></div>${originalDownload}<div class="hrms-announcement-card__files">${hrms.announcement.versions(row.versions || [], ["word_template", "excel_template"])}</div></div>`);
			dialog.show();
			hrms.announcement.bind_file_links(dialog.$wrapper[0]);
			const previewTarget = dialog.$wrapper[0].querySelector("[data-detail-word-preview]");
			if (!row.word_template) {
				previewTarget.innerHTML = '<div class="text-muted">暂无 Word 待填写模板。</div>';
				return;
			}
			hrms.announcement.call("hrms.api.announcement.preview_announcement_file", { name: row.name, file_url: row.word_template }).then((previewResponse) => {
				previewTarget.innerHTML = hrms.announcement.preview_html(previewResponse.message || {});
				hrms.announcement.bind_file_links(previewTarget);
			}).catch(() => {
				previewTarget.innerHTML = '<div class="text-danger">Word 模板预览加载失败，请点击外部文件入口下载查看。</div>';
			});
		});
	}

	load();
};
