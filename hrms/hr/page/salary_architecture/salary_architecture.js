frappe.pages["salary-architecture"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("薪资架构"), single_column: true });
	wrapper.salary_architecture = new SalaryArchitecture(page);
	wrapper.salary_architecture.show();
};

class SalaryArchitecture {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.versions = [];
		this.selectedVersion = "";
		this.levels = [];
		this.defaultLevelCount = 20;
	}

	show() {
		this.page.set_primary_action(__("新建薪级表"), () => this.createVersion(), "add");
		this.page.add_menu_item(__("导入薪级表 Excel"), () => this.openUploader());
		this.load();
	}

	escape(value) {
		return frappe.utils.escape_html(value == null ? "" : String(value));
	}

	toNumber(value) {
		return Number(value || 0) || 0;
	}

	formatMoney(value) {
		return this.toNumber(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
	}

	levelNumber(row, index) {
		const number = Number(row.salary_level || String(row.job_grade || "").match(/^\d+$/)?.[0]);
		return number > 0 ? number : index + 1;
	}

	load() {
		this.wrapper.innerHTML = `<div class="text-muted">${this.escape(__("正在加载薪级表..."))}</div>`;
		frappe.call("hrms.api.payroll_input.list_salary_structure_versions")
			.then((response) => {
				this.versions = response.message || [];
				if (!this.selectedVersion || !this.versions.some((row) => row.name === this.selectedVersion)) {
					this.selectedVersion = this.versions[0]?.name || "";
				}
				return this.selectedVersion
					? frappe.call("hrms.api.payroll_input.list_salary_grades", { structure_version: this.selectedVersion, page_length: this.defaultLevelCount })
					: { message: [] };
			})
			.then((response) => {
				const rows = response.message || [];
				this.levels = rows
					.map((row, index) => ({
						level: this.levelNumber(row, index),
						base_salary: this.toNumber(row.base_salary),
						function_allowance: this.toNumber(row.function_allowance),
					}))
					.sort((left, right) => left.level - right.level);
				if (this.selectedVersion && !this.levels.length) {
					this.levels = Array.from({ length: this.defaultLevelCount }, (_, index) => ({ level: index + 1, base_salary: 0, function_allowance: 0 }));
				}
				this.render();
			})
			.catch(() => {
				this.wrapper.innerHTML = `<div class="alert alert-danger">${this.escape(__("无法读取薪级表，请确认当前账号具有人资经理或系统管理员权限。"))}</div>`;
			});
	}

	selectedVersionRow() {
		return this.versions.find((row) => row.name === this.selectedVersion) || {};
	}

	derivedLevels() {
		let previousFull = 0;
		return this.levels.map((row, index) => {
			const base = this.toNumber(row.base_salary);
			const allowance = this.toNumber(row.function_allowance);
			const full = base + allowance;
			const difference = index === 0 ? 0 : full - previousFull;
			previousFull = full;
			return { ...row, base_salary: base, function_allowance: allowance, full_salary: full, grade_difference: difference };
		});
	}

	render() {
		const version = this.selectedVersionRow();
		const levels = this.derivedLevels();
		const levelCells = (render) => levels.map(render).join("");
		this.wrapper.innerHTML = `
			<div class="hrms-salary-level-head">
				<div>
					<span>${this.escape(__("薪资标准配置"))}</span>
					<h3>${this.escape(__("薪级表"))}</h3>
					<p>${this.escape(__("本页只建立薪级 1、2、3…N 及对应标准，不按部门、职位或岗位自动分配员工。人员薪级分配将在后续作为独立功能建设。"))}</p>
				</div>
				<div class="hrms-salary-level-actions">
					<button class="btn btn-default btn-sm" data-action="new-version">${this.escape(__("新建版本"))}</button>
					<button class="btn btn-default btn-sm" data-action="import">${this.escape(__("导入 Excel"))}</button>
					<button class="btn btn-primary btn-sm" data-action="save" ${this.selectedVersion ? "" : "disabled"}>${this.escape(__("保存薪级表"))}</button>
				</div>
			</div>
			<section class="hrms-salary-level-version-panel">
				<label>${this.escape(__("当前薪级表版本"))}</label>
				<select class="form-control" data-version-select ${this.versions.length ? "" : "disabled"}>
					${this.versions.length ? this.versions.map((row) => `<option value="${this.escape(row.name)}" ${row.name === this.selectedVersion ? "selected" : ""}>${this.escape(row.structure_version)} · ${this.escape(row.status)} · ${this.escape(row.effective_from || "未设生效日")}</option>`).join("") : `<option>${this.escape(__("暂无版本，请先新建"))}</option>`}
				</select>
				${this.selectedVersion ? `<small>${this.escape(__("生效期间：{0} 至 {1}", [version.effective_from || "—", version.effective_to || "长期"]))}</small>` : ""}
			</section>
			<section class="hrms-salary-level-editor">
				<div class="hrms-salary-level-editor-head">
					<div><h4>${this.escape(__("薪级标准"))}</h4><p>${this.escape(__("全薪与级差由系统即时计算。可增加薪级、录入或修改底薪和职能津贴，确认无误后保存。"))}</p></div>
					<div><button class="btn btn-default btn-sm" data-action="remove-level" ${levels.length <= 1 ? "disabled" : ""}>${this.escape(__("删除末级"))}</button> <button class="btn btn-default btn-sm" data-action="add-level" ${this.selectedVersion ? "" : "disabled"}>${this.escape(__("新增薪级"))}</button></div>
				</div>
				<div class="table-responsive hrms-salary-level-matrix-wrap">
					<table class="table table-bordered hrms-salary-level-matrix">
						<tbody>
							<tr><th>${this.escape(__("序号"))}</th>${levelCells((row) => `<td class="salary-level-number">${row.level}</td>`)}</tr>
							<tr><th>${this.escape(__("①底薪"))}</th>${levelCells((row) => `<td><input class="form-control input-sm" type="number" min="0" step="0.01" data-field="base_salary" data-level="${row.level}" value="${row.base_salary}"></td>`)}</tr>
							<tr><th>${this.escape(__("②职能津贴"))}</th>${levelCells((row) => `<td><input class="form-control input-sm" type="number" min="0" step="0.01" data-field="function_allowance" data-level="${row.level}" value="${row.function_allowance}"></td>`)}</tr>
							<tr class="salary-level-full-row"><th>${this.escape(__("全薪"))}</th>${levelCells((row) => `<td data-derived="full_salary" data-level="${row.level}">${this.formatMoney(row.full_salary)}</td>`)}</tr>
							<tr><th>${this.escape(__("级差"))}</th>${levelCells((row) => `<td data-derived="grade_difference" data-level="${row.level}">${this.formatMoney(row.grade_difference)}</td>`)}</tr>
						</tbody>
					</table>
				</div>
				${this.selectedVersion ? "" : `<div class="text-muted hrms-salary-level-empty">${this.escape(__("请先新建一个薪级表版本，再维护 1、2、3…N 级标准。"))}</div>`}
			</section>
			<section class="hrms-salary-level-boundary"><strong>${this.escape(__("当前边界"))}</strong><span>${this.escape(__("此处仅维护薪级标准；不包含人员、部门、职位、岗位类别或标签。后续将另设人员薪级分配，并允许按员工逐一分配。"))}</span></section>
		`;
		this.bindEvents();
	}

	bindEvents() {
		const versionSelect = this.wrapper.querySelector("[data-version-select]");
		if (versionSelect) versionSelect.addEventListener("change", (event) => {
			this.selectedVersion = event.target.value;
			this.load();
		});
		this.wrapper.querySelectorAll("[data-field]").forEach((input) => input.addEventListener("input", (event) => {
			const level = Number(event.target.dataset.level);
			const field = event.target.dataset.field;
			const row = this.levels.find((item) => item.level === level);
			if (row) row[field] = this.toNumber(event.target.value);
			this.updateDerivedCells();
		}));
		this.wrapper.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
			const action = button.dataset.action;
			if (action === "new-version") this.createVersion();
			if (action === "import") this.openUploader();
			if (action === "save") this.save();
			if (action === "add-level") { this.levels.push({ level: Math.max(0, ...this.levels.map((item) => item.level)) + 1, base_salary: 0, function_allowance: 0 }); this.render(); }
			if (action === "remove-level" && this.levels.length > 1) { this.levels.pop(); this.render(); }
		}));
	}

	updateDerivedCells() {
		this.derivedLevels().forEach((row) => {
			const full = this.wrapper.querySelector(`[data-derived="full_salary"][data-level="${row.level}"]`);
			const difference = this.wrapper.querySelector(`[data-derived="grade_difference"][data-level="${row.level}"]`);
			if (full) full.textContent = this.formatMoney(row.full_salary);
			if (difference) difference.textContent = this.formatMoney(row.grade_difference);
		});
	}

	createVersion() {
		frappe.prompt([
			{ fieldname: "structure_version", fieldtype: "Data", label: __("版本名称"), reqd: 1, description: __("例如：2026 年薪级表") },
			{ fieldname: "effective_from", fieldtype: "Date", label: __("生效开始"), reqd: 1, default: frappe.datetime.get_today() },
			{ fieldname: "effective_to", fieldtype: "Date", label: __("生效结束") },
		], (values) => frappe.call({
			method: "hrms.api.payroll_input.create_salary_level_structure_version",
			args: values,
			freeze: true,
			freeze_message: __("正在新建薪级表..."),
		}).then((response) => {
			this.selectedVersion = response.message.name;
			this.load();
		}), __("新建薪级表"));
	}

	save() {
		frappe.call({
			method: "hrms.api.payroll_input.save_salary_level_structure",
			args: { structure_version: this.selectedVersion, levels: this.derivedLevels() },
			freeze: true,
			freeze_message: __("正在保存薪级表..."),
		}).then((response) => {
			frappe.show_alert({ message: __("已保存 {0} 个薪级", [response.message.saved]), indicator: "green" });
			this.load();
		});
	}

	openUploader() {
		new frappe.ui.FileUploader({
			folder: "Home/Attachments",
			restrictions: { allowed_file_types: [".xlsx"] },
			on_success: (file) => this.previewImport(file.file_url),
		});
	}

	previewImport(fileUrl) {
		frappe.call({ method: "hrms.api.payroll_input.preview_salary_structure_workbook", args: { file_url: fileUrl }, freeze: true, freeze_message: __("正在识别薪级表...") }).then((response) => {
			const preview = response.message || {};
			if (!preview.found || !preview.grade_rows) return frappe.msgprint(__("未识别到薪级数据。Excel 请使用“薪资架构”工作表，并包含序号、底薪、职能津贴行。"));
			frappe.prompt([
				{ fieldname: "structure_version", fieldtype: "Data", label: __("版本名称"), reqd: 1, default: preview.suggested_structure_version || "" },
				{ fieldname: "effective_from", fieldtype: "Date", label: __("生效开始"), reqd: 1, default: frappe.datetime.get_today() },
				{ fieldname: "effective_to", fieldtype: "Date", label: __("生效结束") },
			], (values) => this.importWorkbook(fileUrl, values), __("识别到 {0} 个薪级", [preview.grade_rows]));
		});
	}

	importWorkbook(fileUrl, values) {
		frappe.call({ method: "hrms.api.payroll_input.import_salary_structure_workbook", args: { file_url: fileUrl, ...values }, freeze: true, freeze_message: __("正在导入薪级表...") }).then(() => {
			frappe.show_alert({ message: __("薪级表导入完成"), indicator: "green" });
			this.selectedVersion = "";
			this.load();
		});
	}
}
