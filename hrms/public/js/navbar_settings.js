function show_logo_upload_button(frm) {
	const field = frm.fields_dict.app_logo;
	const wrapper = field?.$wrapper?.[0];
	if (!wrapper) return;

	const refresh_button = () => {
		const button = wrapper.querySelector(".btn-attach");
		if (!button) return;

		const label = frm.doc.app_logo ? __("更换图片") : __("上传图片");
		if (button.textContent.trim() !== label) button.textContent = label;
		if (button.style.display === "none") button.style.display = "";
		button.classList.add("hrms-navbar-logo-upload");
		button.style.marginTop = frm.doc.app_logo ? "8px" : "0";
	};

	refresh_button();
	if (wrapper.hrms_logo_upload_observer) return;

	const observer = new MutationObserver(refresh_button);
	observer.observe(wrapper, {
		attributes: true,
		attributeFilter: ["style"],
		childList: true,
		subtree: true,
	});
	wrapper.hrms_logo_upload_observer = observer;
}

function apply_minimal_branding_layout(frm) {
	frm.page?.set_title?.(__("品牌外观"));
	for (const fieldname of ["section_break_2", "announcements_section"]) {
		if (frm.fields_dict[fieldname]) frm.set_df_property(fieldname, "hidden", 1);
	}

	const page = frm.page?.wrapper?.[0];
	if (!page) return;
	page.classList.add("hrms-navbar-settings-minimal");

	if (document.getElementById("hrms-navbar-settings-minimal-style")) return;
	const style = document.createElement("style");
	style.id = "hrms-navbar-settings-minimal-style";
	style.textContent = `
		.hrms-navbar-settings-minimal [data-fieldname="section_break_2"],
		.hrms-navbar-settings-minimal [data-fieldname="announcements_section"],
		.hrms-navbar-settings-minimal .form-footer,
		.hrms-navbar-settings-minimal .layout-side-section,
		.hrms-navbar-settings-minimal #full-search-button,
		.hrms-navbar-settings-minimal .menu-more-button {
			display: none !important;
		}
		.hrms-navbar-settings-minimal .layout-main-section-wrapper {
			width: 100%;
		}
		#hrms-export-watermark-settings { margin: 32px 0; max-width: 920px; }
		#hrms-export-watermark-settings h4 { margin-bottom: 8px; }
		#hrms-export-watermark-settings .hrms-watermark-controls { display: flex; gap: 16px; flex-wrap: wrap; margin: 18px 0; }
		#hrms-export-watermark-settings .hrms-watermark-controls label { min-width: 220px; flex: 1; }
		#hrms-export-watermark-settings .hrms-watermark-preview { display: flex; align-items: center; justify-content: center; height: 100px; border: 1px dashed var(--border-color); margin-bottom: 18px; font-size: 26px; overflow: hidden; }
		#hrms-export-watermark-settings td:nth-child(n+2), #hrms-export-watermark-settings th:nth-child(n+2) { text-align: center; width: 150px; }
	`;
	document.head.appendChild(style);
}

async function render_export_watermark_settings(frm) {
	const anchor = frm.fields_dict.app_logo?.$wrapper?.[0];
	if (!anchor) return;
	let panel = document.getElementById("hrms-export-watermark-settings");
	if (!panel) {
		panel = document.createElement("section");
		panel.id = "hrms-export-watermark-settings";
		anchor.after(panel);
	}
	panel.textContent = __("正在加载 Excel 水印设置…");
	try {
		const response = await Promise.resolve().then(() => frappe.call({
			method: "hrms.utils.export_watermark_settings.get_export_watermark_settings",
		}));
		const settings = response.message;
		if (!settings) throw new Error(__("无法读取水印设置"));
		const esc = frappe.utils.escape_html;
		panel.innerHTML = `
			<h4>${__("Excel 水印")}</h4>
			<p class="text-muted">${__("设置对今后生成的文件生效，首次打开时沿用各导出原有的水印开启状态。导出水印显示在工作表背景；打开打印开关会在每页页眉增加文字水印。Excel 与 LibreOffice/WPS 对背景图的打印行为可能不同，请在使用的软件里预览打印效果。")}</p>
			<div class="hrms-watermark-controls">
				<label>${__("水印内容")}<input class="form-control" data-watermark-text maxlength="100" value="${esc(settings.text || "")}"></label>
				<label>${__("深浅（1 最浅，50 最深）")}<input class="form-control" data-watermark-opacity type="number" min="1" max="50" value="${Number(settings.opacity) || 12}"></label>
			</div>
			<div class="hrms-watermark-preview"><span>${esc(settings.text || "")}</span></div>
			<div class="table-responsive"><table class="table table-bordered table-sm"><thead><tr><th>${__("Excel 导出位置")}</th><th>${__("导出文件带水印")}</th><th>${__("打印时加页眉水印")}</th></tr></thead><tbody>
			${settings.exports.map((item) => `<tr data-export-key="${esc(item.key)}"><td>${esc(item.label)}</td><td><input type="checkbox" data-export ${item.export ? "checked" : ""} aria-label="${esc(item.label)} ${__("导出文件带水印")}"></td><td><input type="checkbox" data-print ${item.print ? "checked" : ""} ${item.export ? "" : "disabled"} aria-label="${esc(item.label)} ${__("打印时加页眉水印")}"></td></tr>`).join("")}
			</tbody></table></div>
			<button type="button" class="btn btn-primary" data-save-watermark>${__("保存水印设置")}</button>
		`;
		const textInput = panel.querySelector("[data-watermark-text]");
		const opacityInput = panel.querySelector("[data-watermark-opacity]");
		const updatePreview = () => {
			const preview = panel.querySelector(".hrms-watermark-preview span");
			preview.textContent = textInput.value;
			preview.style.opacity = String(Math.max(1, Math.min(50, Number(opacityInput.value) || 12)) / 100);
		};
		textInput.addEventListener("input", updatePreview);
		opacityInput.addEventListener("input", updatePreview);
		updatePreview();
		panel.querySelectorAll("[data-export]").forEach((checkbox) => checkbox.addEventListener("change", () => {
			const print = checkbox.closest("tr").querySelector("[data-print]");
			print.disabled = !checkbox.checked;
			if (!checkbox.checked) print.checked = false;
		}));
		panel.querySelector("[data-save-watermark]").addEventListener("click", async (event) => {
			const button = event.currentTarget;
			const exports = {};
			panel.querySelectorAll("[data-export-key]").forEach((row) => {
				exports[row.dataset.exportKey] = { export: row.querySelector("[data-export]").checked, print: row.querySelector("[data-print]").checked };
			});
			button.disabled = true;
			try {
				await Promise.resolve().then(() => frappe.call({
					method: "hrms.utils.export_watermark_settings.save_export_watermark_settings",
					args: { text: textInput.value, opacity: opacityInput.value, exports: JSON.stringify(exports) },
				}));
				frappe.show_alert({ message: __("水印设置已保存"), indicator: "green" });
			} finally {
				button.disabled = false;
			}
		});
	} catch (error) {
		panel.textContent = __("水印设置加载失败，请刷新页面重试。");
		console.error(error);
	}
}

frappe.ui.form.on("Navbar Settings", {
	refresh(frm) {
		apply_minimal_branding_layout(frm);
		show_logo_upload_button(frm);
		render_export_watermark_settings(frm);
	},
});
