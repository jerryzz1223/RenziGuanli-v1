frappe.pages["hrms-access-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("账户与权限中心"),
		single_column: true,
	});

	const escape = (value) => frappe.utils.escape_html(value == null ? "" : String(value));
	const route = (target) => frappe.set_route(...target.split("/"));
	const state = { data: null, account_filter: "", role_filter: "", project_roles_only: true };
	const matches = (value, query) => !query || String(value || "").toLowerCase().includes(query.toLowerCase());

	page.set_primary_action(__("新建账户"), () => frappe.new_doc("User"), "add");
	page.add_inner_button(__("测试实际权限"), () => open_permission_tester());

	function assigned_roles(account) {
		const roles = account.assigned_roles || [];
		const labels = account.assigned_role_labels || roles;
		const visible = labels.slice(0, 3).map((role) => `<span class="hrms-access-center__role-chip">${escape(role)}</span>`).join("");
		const remaining = roles.length - 3;
		return `${visible || `<span class="text-muted">${__("未分配角色")}</span>`}${remaining > 0 ? `<span class="hrms-access-center__role-more">+${remaining}</span>` : ""}`;
	}

	function render_permission_result(result) {
		const scope_rows = (result.user_permissions || []).map((item) => `
			<tr><td>${escape(item.allow)}</td><td>${escape(item.for_value)}</td><td>${escape(item.applicable_for || __("全部相关单据"))}</td></tr>`).join("");
		frappe.msgprint({
			title: result.allowed ? __("实际验证：允许") : __("实际验证：拒绝"),
			indicator: result.allowed ? "green" : "red",
			message: `
				<div class="hrms-access-center__test-result">
					<p><strong>${escape(result.user)}</strong> · ${escape(result.doctype)} · ${escape(result.permission_type)} · ${escape(result.scope_mode)}</p>
					<p>${escape(result.explanation)}</p>
					<p><strong>${__("可能授予此操作的角色")}</strong>：${escape((result.granting_roles || []).join("、") || __("未找到角色授权"))}</p>
					<p><strong>${__("账户全部角色")}</strong>：${escape((result.roles || []).join("、"))}</p>
					<h5>${__("用户数据范围限制")}</h5>
					${scope_rows ? `<table class="table table-bordered"><thead><tr><th>${__("限制对象")}</th><th>${__("允许值")}</th><th>${__("仅适用于")}</th></tr></thead><tbody>${scope_rows}</tbody></table>` : `<p class="text-muted">${__("该账户没有单独的数据范围限制。")}</p>`}
					<p class="text-muted">${__("未填写具体记录时只验证是否能进入该类业务；填写记录编号后，结果还会包含该记录的数据范围、所有者和共享权限。")}</p>
				</div>`,
		});
	}

	function open_permission_tester(default_user = "") {
		const dialog = new frappe.ui.Dialog({
			title: __("测试账户的实际有效权限"),
			fields: [
				{ fieldname: "user", label: __("账户"), fieldtype: "Link", options: "User", reqd: 1, default: default_user },
				{ fieldname: "doctype", label: __("业务对象（单据类型）"), fieldtype: "Link", options: "DocType", reqd: 1, default: "Employee" },
				{ fieldname: "permission_type", label: __("要验证的操作"), fieldtype: "Select", options: "read\nwrite\ncreate\ndelete\nsubmit\ncancel\namend\nreport\nimport\nexport\nprint\nemail\nshare\nselect", reqd: 1, default: "read" },
				{ fieldname: "document_name", label: __("具体记录编号（可选）"), fieldtype: "Data", description: __("填写后会验证这条真实记录；不填则验证是否能进入该类业务。") },
			],
			primary_action_label: __("执行实际权限测试"),
			primary_action(values) {
				dialog.disable_primary_action();
				frappe.call("hrms.api.employee_field_template.test_hrms_effective_permission", values)
					.then((response) => {
						dialog.hide();
						render_permission_result(response.message || {});
					})
					.finally(() => dialog.enable_primary_action());
			},
		});
		dialog.show();
	}

	function render() {
		const data = state.data || {};
		const accounts = (data.accounts || []).filter((account) =>
			matches(`${account.user} ${account.full_name} ${(account.assigned_roles || []).join(" ")}`, state.account_filter),
		);
		const roles = (data.roles || []).filter((role) =>
			(!state.project_roles_only || role.is_project_used) &&
			matches(`${role.name} ${role.label} ${role.description} ${(role.permission_doctypes || []).map((item) => `${item.name} ${item.label}`).join(" ")}`, state.role_filter),
		);
		const enabled_count = (data.accounts || []).filter((account) => account.enabled).length;
		const project_role_count = (data.roles || []).filter((role) => role.is_project_used && !role.disabled).length;

		$(page.body).html(`
			<div class="hrms-access-center">
				<section class="hrms-access-center__hero">
					<div>
						<span class="indicator blue"></span>
						<h3>${__("先看账户，再沿着角色验证实际权限")}</h3>
						<p>${__("账户负责身份与登录，角色负责能做什么，数据范围负责能看哪些记录。最终权限是三层规则共同计算的结果。")}</p>
					</div>
					<div class="hrms-access-center__scope"><strong>${__("管理员权限")}</strong><span>System Manager</span></div>
				</section>

				<section class="hrms-access-center__permission-model" aria-label="权限层级说明">
					<article><span>1</span><div><strong>${__("账户与角色分配")}</strong><p>${__("回答“这个人是谁、能登录吗、拥有哪些岗位角色”。在管理账户中改姓名、重置密码、启停和勾选角色。")}</p></div></article>
					<article><span>2</span><div><strong>${__("角色操作权限")}</strong><p>${__("回答“这个角色能对哪些业务对象执行读、写、创建、提交等操作”。同一角色的规则会复用于所有成员。")}</p></div></article>
					<article><span>3</span><div><strong>${__("用户数据范围")}</strong><p>${__("回答“这个账户只能看哪家公司、部门或员工记录”。它是额外收窄范围，不代替角色权限。")}</p></div></article>
					<article class="is-result"><span>=</span><div><strong>${__("实际有效权限")}</strong><p>${__("角色允许的操作 ∩ 用户数据范围 ∩ 具体记录所有权/共享。使用“测试实际权限”查看最终结果。")}</p></div></article>
				</section>

				<section class="hrms-access-center__panel">
					<div class="hrms-access-center__panel-head">
						<div><h4>${__("全部已创建账户")}</h4><p>${__("这是日常管理入口。先选人，再修改账户资料、密码和角色；不需要从单据列表反向寻找人员。")}</p></div>
						<span class="indicator-pill blue">${escape((data.accounts || []).length)} ${__("个账户 / {0} 个启用", [enabled_count])}</span>
					</div>
					<div class="hrms-access-center__filter"><input type="search" class="form-control" data-account-filter placeholder="${escape(__("搜索账户、姓名或角色"))}" value="${escape(state.account_filter)}"></div>
					<div class="table-responsive">
						<table class="table hrms-access-center__account-table">
							<thead><tr><th>${__("账户")}</th><th>${__("姓名 / 状态")}</th><th>${__("已分配角色")}</th><th>${__("账户操作")}</th></tr></thead>
							<tbody>${accounts.map((account) => `
								<tr>
									<td><strong>${escape(account.user)}</strong><small>${escape(account.user_type)}</small></td>
									<td>${escape(account.full_name)}<span class="indicator-pill ${account.enabled ? "green" : "gray"}">${account.enabled ? __("启用") : __("已停用")}</span></td>
									<td><div class="hrms-access-center__role-chips">${assigned_roles(account)}</div></td>
									<td class="hrms-access-center__account-actions">
										<button class="btn btn-primary btn-sm" data-action="edit-account" data-user="${escape(account.user)}">${__("管理账户")}</button>
										<button class="btn btn-default btn-sm" data-action="scope" data-user="${escape(account.user)}">${__("数据范围")}</button>
										<button class="btn btn-default btn-sm" data-action="test-user" data-user="${escape(account.user)}">${__("验证权限")}</button>
									</td>
								</tr>`).join("") || `<tr><td colspan="4" class="text-muted">${__("没有符合条件的账户")}</td></tr>`}</tbody>
						</table>
					</div>
				</section>

				<section class="hrms-access-center__panel hrms-access-center__role-panel">
					<div class="hrms-access-center__panel-head">
						<div><h4>${__("角色与业务对象权限")}</h4><p>${__("先选角色，再查看这个角色影响哪些账户、哪些业务对象。下方默认只显示本项目已分配或人资核心角色。")}</p></div>
						<span class="indicator-pill gray">${escape(project_role_count)} ${__("个项目相关角色")}</span>
					</div>
					<div class="hrms-access-center__role-toolbar">
						<div class="hrms-access-center__filter"><input type="search" class="form-control" data-role-filter placeholder="${escape(__("搜索角色、用途或业务对象"))}" value="${escape(state.role_filter)}"></div>
						<label><input type="checkbox" data-project-role-toggle ${state.project_roles_only ? "checked" : ""}> ${__("仅显示本项目相关角色")}</label>
					</div>
					<div class="hrms-access-center__role-list">
						${roles.map((role) => `<article class="hrms-access-center__role-card ${role.disabled ? "is-disabled" : ""}">
							<div class="hrms-access-center__role-copy">
								<div class="hrms-access-center__role-title"><strong>${escape(role.label || role.name)}</strong><span>${role.is_custom ? __("自定义") : __("系统预置")}${role.disabled ? ` · ${__("已停用")}` : ""}</span></div>
								<p>${escape(role.description)}</p>
								<small>${__("已分配 {0} 个账户 · 已配置 {1} 类业务对象", [role.user_count, role.permission_doctype_count])}</small>
								${(role.permission_doctypes || []).length ? `<div class="hrms-access-center__doctype-list">${role.permission_doctypes.map((doctype) => `<code title="${escape(doctype.name)}">${escape(doctype.label || doctype.name)}</code>`).join("")}</div>` : `<small class="text-muted">${__("尚无单据权限配置；仅创建角色不会自动获得业务权限。")}</small>`}
							</div>
							<div class="hrms-access-center__role-actions">
								<button class="btn btn-default btn-sm" data-action="edit-role" data-role="${escape(role.name)}">${__("角色资料")}</button>
								<button class="btn btn-primary btn-sm" data-action="configure-role" data-role="${escape(role.name)}" ${role.disabled ? "disabled" : ""}>${__("配置业务权限")}</button>
							</div>
						</article>`).join("") || `<div class="text-muted">${__("没有符合条件的角色")}</div>`}
					</div>
				</section>

				<section class="hrms-access-center__password-note alert alert-info">
					<strong>${__("密码与业务权限说明")}</strong>：${__("管理员可以重设密码，但系统不会保存可查看的明文密码。权限勾选保存后会直接进入实际权限引擎，无需修改代码；请用真实账户和具体记录再次验证。")}
				</section>
			</div>
		`);

		$(page.body).find("[data-account-filter]").on("input", function () {
			state.account_filter = this.value;
			render();
		});
		$(page.body).find("[data-role-filter]").on("input", function () {
			state.role_filter = this.value;
			render();
		});
		$(page.body).find("[data-project-role-toggle]").on("change", function () {
			state.project_roles_only = this.checked;
			render();
		});
		$(page.body).find("[data-action='edit-account']").on("click", function () {
			frappe.set_route("Form", "User", this.dataset.user);
		});
		$(page.body).find("[data-action='scope']").on("click", function () {
			frappe.route_options = { user: this.dataset.user };
			frappe.set_route("List", "User Permission");
		});
		$(page.body).find("[data-action='test-user']").on("click", function () {
			open_permission_tester(this.dataset.user);
		});
		$(page.body).find("[data-action='edit-role']").on("click", function () {
			frappe.set_route("Form", "Role", this.dataset.role);
		});
		$(page.body).find("[data-action='configure-role']").on("click", function () {
			frappe.route_options = { role: this.dataset.role };
			route("permission-manager");
		});
	}

	function load() {
		$(page.body).html(`<div class="text-muted">${__("正在读取账户、角色与实际使用位置...")}</div>`);
		return frappe.call("hrms.api.employee_field_template.get_hrms_access_center")
			.then((response) => {
				state.data = response.message || {};
				render();
			})
			.catch(() => $(page.body).html(`<div class="alert alert-danger">${__("无法读取账户与角色。请使用系统管理员账号进入。")}</div>`));
	}

	load();
};
