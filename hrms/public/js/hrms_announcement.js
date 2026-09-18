(function () {
	window.hrms = window.hrms || {};
	hrms.announcement = {
		escape(value) {
			return frappe.utils.escape_html(value == null ? "" : String(value));
		},
		call(method, args) {
			return frappe.call({ method, args: args || {}, freeze: true });
		},
		file_url(url) {
			return url ? frappe.urllib.get_full_url(url) : "";
		},
		content_html(value) {
			const raw = String(value == null ? "" : value);
			if (!raw.trim()) return `<span class="text-muted">${__("暂无正文")}</span>`;
			if (!/<[a-z][\s\S]*>/i.test(raw) || typeof DOMParser === "undefined") {
				return this.escape(raw).replace(/\n/g, "<br>");
			}

			const parsed = new DOMParser().parseFromString(raw, "text/html");
			const allowedTags = new Set(["A", "B", "BLOCKQUOTE", "BR", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6", "I", "LI", "OL", "P", "S", "SPAN", "STRONG", "U", "UL"]);
			const blockedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "LINK", "META"]);
			const clean = (parent) => Array.from(parent.children).forEach((element) => {
				if (blockedTags.has(element.tagName)) {
					element.remove();
					return;
				}
				if (!allowedTags.has(element.tagName)) {
					element.replaceWith(document.createTextNode(element.textContent || ""));
					return;
				}
				Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
				clean(element);
			});
			clean(parsed.body);
			const rendered = parsed.body.innerHTML;
			const visibleText = (parsed.body.textContent || "").replace(/\u00a0/g, " ").trim();
			if (!visibleText && !parsed.body.querySelector("img, video, audio, svg")) {
				return `<span class="text-muted">${__("暂无正文")}</span>`;
			}
			return rendered || `<span class="text-muted">${__("暂无正文")}</span>`;
		},
		open_file(url) {
			if (url) window.open(this.file_url(url), "_blank");
		},
		download_file(url, fileName) {
			if (!url) return;
			const link = document.createElement("a");
			link.href = this.file_url(url);
			link.download = fileName || "";
			link.rel = "noopener";
			document.body.appendChild(link);
			link.click();
			link.remove();
		},
		open_preview({ name, url, fileName }) {
			return this.call("hrms.api.announcement.preview_announcement_file", { name, file_url: url }).then((response) => {
				const preview = response.message || {};
				const dialog = new frappe.ui.Dialog({
					title: `${__("附件预览")} · ${preview.file_name || fileName || __("附件")}`,
					fields: [{ fieldname: "preview", fieldtype: "HTML" }],
				});
				dialog.fields_dict.preview.$wrapper.html(this.preview_html(preview));
				dialog.show();
				this.bind_file_links(dialog.$wrapper[0]);
				return dialog;
			});
		},
		preview_html(preview) {
			const download = preview.file_url ? `<div class="hrms-announcement-preview__toolbar"><button type="button" class="btn btn-default btn-sm" data-preview-download="${this.escape(preview.file_url)}" data-preview-download-name="${this.escape(preview.file_name || "")}">${__("下载原件")}</button></div>` : "";
			if (preview.kind === "docx") {
				const paragraphs = (preview.paragraphs || []).map((paragraph) => `<p>${this.escape(paragraph).replace(/\n/g, "<br>") || "&nbsp;"}</p>`).join("");
				return `${download}<div class="hrms-announcement-file-preview hrms-announcement-file-preview--docx">${paragraphs || `<p class="text-muted">${__("文档没有可显示的正文")}</p>`}</div>`;
			}
			if (preview.kind === "xlsx") {
				const sheets = (preview.sheets || []).map((sheet) => `<section class="hrms-announcement-sheet"><h5>${this.escape(sheet.name)}</h5><div class="table-responsive"><table class="table table-bordered table-condensed"><thead><tr>${(sheet.columns || []).map((column) => `<th>${this.escape(column)}</th>`).join("")}</tr></thead><tbody>${(sheet.rows || []).map((row) => `<tr>${(sheet.columns || []).map((_, index) => `<td>${this.escape(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`).join("");
				return `${download}<div class="hrms-announcement-file-preview hrms-announcement-file-preview--xlsx">${sheets || `<p class="text-muted">${__("工作簿没有可显示的数据")}</p>`}</div>`;
			}
			if (preview.kind === "image") {
				return `${download}<div class="hrms-announcement-file-preview hrms-announcement-file-preview--image"><img src="${this.escape(this.file_url(preview.file_url))}" alt="${this.escape(preview.file_name || __("附件"))}"></div>`;
			}
			return `${download}<div class="alert alert-warning hrms-announcement-file-preview__unsupported">${this.escape(preview.message || __("此格式暂不支持在线预览，请下载原文件查看。"))}</div>`;
		},
		status(status) {
			const cls = status === "已签字" ? "success" : status === "审核驳回" ? "danger" : status === "待审核" ? "warning" : "info";
			return `<span class="label label-${cls}">${this.escape(status || "草稿")}</span>`;
		},
		files(files, exclude = [], action = "preview") {
			const excluded = new Set(exclude);
			return (files || []).filter((file) => !excluded.has(file.attached_to_field)).map((file) =>
				action === "download"
					? `<button type="button" class="btn btn-link btn-xs hrms-announcement-file" data-download-url="${this.escape(file.file_url)}" data-download-name="${this.escape(file.file_name || file.file_url)}">${this.escape(file.file_name || file.file_url)}</button>`
					: `<button type="button" class="btn btn-link btn-xs hrms-announcement-file" data-file-url="${this.escape(file.file_url)}" data-file-name="${this.escape(file.file_name || file.file_url)}" data-announcement-name="${this.escape(file.attached_to_name || "")}">${this.escape(file.file_name || file.file_url)}</button>`,
			).join("");
		},
		versions(versions, exclude = []) {
			const action = arguments[2] || "preview";
			const excluded = new Set(exclude);
			const markup = (versions || []).map((version) => {
				const files = (version.files || []).filter((file) => !excluded.has(file.attached_to_field));
				return files.length ? `<div class="hrms-announcement-version"><strong>${this.escape(version.label)}：</strong>${this.files(files, [], action)}</div>` : "";
			}).join("");
			return markup;
		},
		upload({ name, fieldname, accept, on_success }) {
			new frappe.ui.FileUploader({
				folder: "Home/Attachments",
				restrictions: { allowed_file_types: accept || [".docx", ".doc", ".xlsx", ".xls", ".pdf", ".jpg", ".png"] },
				on_success: (file) => this.call("hrms.api.announcement.attach_announcement_file", { name, file_url: file.file_url, fieldname }).then(() => on_success(file)),
			});
		},
		bind_file_links(root) {
			root.querySelectorAll("[data-file-url]").forEach((node) => node.addEventListener("click", () => {
				if (node.dataset.announcementName) {
					this.open_preview({ name: node.dataset.announcementName, url: node.dataset.fileUrl, fileName: node.dataset.fileName });
				} else {
					this.open_file(node.dataset.fileUrl);
				}
			}));
			root.querySelectorAll("[data-preview-download]").forEach((node) => node.addEventListener("click", () => this.download_file(node.dataset.previewDownload, node.dataset.previewDownloadName)));
			root.querySelectorAll("[data-download-url]").forEach((node) => node.addEventListener("click", () => this.download_file(node.dataset.downloadUrl, node.dataset.downloadName)));
		},
	};
})();
