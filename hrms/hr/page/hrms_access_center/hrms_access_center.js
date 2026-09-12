frappe.pages["hrms-access-center"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("账户与权限中心"),
		single_column: true,
	});

	const escape = (value) => frappe.utils.escape_html(value == null ? "" : String(value));
	const route = (target) => frappe.set_route(...target.split("/"));
	const state = { data: null, active_tab: "accounts", account_filter: "", role_filter: "", opened_roles_only: true };
	const matches = (value, query) => !query || String(value || "").toLowerCase().includes(query.toLowerCase());

	page.set_primary_action(__("新建账户"), () => frappe.new_doc("User"), "add");
	page.add_inner_button(__("测试实际权限"), () => open_permission_tester());

	function open_capability_editor(account) {
		const capabilities = state.data?.capabilities || [];
		const assigned = new Set(account.assigned_roles || []);
		const dialog = new frappe.ui.Dialog({
			title: __("设置 {0} 的业务权限", [account.full_name || account.user]),
			fields: [
				{
					fieldname: "permission_notice",
					fieldtype: "HTML",
					options: `<div class="alert alert-info">
						<strong>${escape(account.user)}</strong><br>
						${__("勾选会直接分配系统真实角色。薪资和权限管理属于高风险权限，保存后请再用“验证权限”检查具体单据。")}
					</div>`,
				},
				...capabilities.map((capability) => ({
					fieldname: `capability_${capability.key}`,
					fieldtype: "Check",
					label: `${capability.label}${["high", "critical"].includes(capability.risk) ? " · 高风险" : ""}`,
					default: assigned.has(capability.role) ? 1 : 0,
					description: `${capability.description}<br><code>${escape(capability.role)}</code>`,
				})),
			],
			primary_action_label: __("保存权限"),
			primary_action(values) {
				const selected = capabilities
					.filter((capability) => values[`capability_${capability.key}`])
					.map((capability) => capability.key);
				dialog.disable_primary_action();
				frappe.call("hrms.access_control.set_hrms_user_capabilities", {
					user: account.user,
					capabilities: selected,
				}).then(() => {
					dialog.hide();
					frappe.show_alert({ message: __("权限已保存"), indicator: "green" });
					load();
				}).finally(() => dialog.enable_primary_action());
			},
		});
		dialog.show();
	}

	function open_delete_account_dialog(account) {
		const dialog = new frappe.ui.Dialog({
			title: __("删除账号：{0}", [account.full_name || account.user]),
			fields: [
				{
					fieldname: "delete_notice",
					fieldtype: "HTML",
					options: `<div class="alert alert-danger">
						<strong>${__("此操作不可恢复。")}</strong><br>
						${__("若账号已被业务单据引用，系统将阻止删除；这种情况请在“账户资料”中停用账号。")}
					</div>`,
				},
				{
					fieldname: "confirmation",
					fieldtype: "Data",
					label: __("输入完整账户以确认"),
					description: `<code>${escape(account.user)}</code>`,
					reqd: 1,
				},
			],
			primary_action_label: __("永久删除账号"),
			primary_action(values) {
				if ((values.confirmation || "").trim() !== account.user) {
					frappe.msgprint(__("请输入完整账户：{0}", [account.user]));
					return;
				}
				dialog.disable_primary_action();
				frappe.call("hrms.access_control.delete_hrms_user_account", {
					user: account.user,
					confirmation: values.confirmation,
				}).then(() => {
					dialog.hide();
					frappe.show_alert({ message: __("账户已删除"), indicator: "green" });
					load();
				}).finally(() => dialog.enable_primary_action());
			},
		});
		dialog.show();
		dialog.get_primary_btn().removeClass("btn-primary").addClass("btn-danger");
	}

	function assigned_roles(account) {
		const roles = account.assigned_roles || [];
		const labels = account.assigned_role_labels || roles;
		const visible = labels.slice(0, 3).map((role) => `<span class="hrms-access-center__role-chip">${escape(role)}</span>`).join("");
		const remaining = roles.length - 3;
		return `${visible || `<span class="text-muted">${__("未分配角色")}</span>`}${remaining > 0 ? `<span class="hrms-access-center__role-more">+${remaining}</span>` : ""}`;
	}

	function assigned_scopes(account) {
		const scopes = account.data_scopes || [];
		const visible = scopes.slice(0, 2).map((scope) => `
			<span class="hrms-access-center__scope-chip${scope.identity_issue ? " is-invalid" : ""}" title="${escape(scope.applicable_for || __("全部相关单据"))}">
				${escape(scope.allow_label || scope.allow)}：${escape(scope.for_value)}
			</span>`).join("");
		const remaining = scopes.length - 2;
		return `${visible || `<span class="text-muted">${__("未单独限制")}</span>`}${remaining > 0 ? `<span class="hrms-access-center__role-more">+${remaining}</span>` : ""}`;
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
					${scope_rows ? `<table class="table table-bordered"><thead><tr><th>${__("限制对象")}</th><th>${__("允许值（员工仅显示公司工号）")}</th><th>${__("仅适用于")}</th></tr></thead><tbody>${scope_rows}</tbody></table>` : `<p class="text-muted">${__("该账户没有单独的数据范围限制。")}</p>`}
					<p class="text-muted">${__("验证员工记录时只能填公司工号；其他业务对象填具体记录编号。不填时只验证是否能进入该类业务。")}</p>
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
				{ fieldname: "document_name", label: __("公司工号 / 具体记录编号（可选）"), fieldtype: "Data", description: __("员工必须填公司工号，不接受 HR-EMP 系统编号；其他单据填具体记录编号。") },
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
			matches(`${account.user} ${account.full_name} ${(account.assigned_roles || []).join(" ")} ${(account.data_scopes || []).map((scope) => scope.for_value).join(" ")}`, state.account_filter),
		);
		const roles = (data.roles || []).filter((role) =>
			(!state.opened_roles_only || (data.managed_roles || []).includes(role.name)) &&
			matches(`${role.name} ${role.label} ${role.description} ${(role.permission_doctypes || []).map((item) => `${item.name} ${item.label}`).join(" ")}`, state.role_filter),
		);
		const enabled_count = (data.accounts || []).filter((account) => account.enabled).length;
		const project_role_count = (data.roles || []).filter((role) => (data.managed_roles || []).includes(role.name) && !role.disabled).length;
		const protected_accounts = new Set(["Administrator", "Guest", frappe.session.user]);

		$(page.body).html(`
			<div class="hrms-access-center">
				<section class="hrms-access-center__hero">
					<div>
						<span class="indicator blue"></span>
						<h3>${__("一个入口管理账户、权限与角色")}</h3>
						<p>${__("先为账户分配业务权限和数据范围，再到角色页维护共享规则；最终用实际权限测试确认结果。")}</p>
					</div>
					<div class="hrms-access-center__scope"><strong>${__("管理员权限")}</strong><span>System Manager</span></div>
				</section>

				<nav class="hrms-access-center__tabs" role="tablist" aria-label="${__("账户与权限管理视图")}">
					<button type="button" role="tab" aria-selected="${state.active_tab === "accounts"}" class="${state.active_tab === "accounts" ? "is-active" : ""}" data-access-tab="accounts">${__("用户与权限")}<span>${escape((data.accounts || []).length)}</span></button>
					<button type="button" role="tab" aria-selected="${state.active_tab === "roles"}" class="${state.active_tab === "roles" ? "is-active" : ""}" data-access-tab="roles">${__("角色与业务权限")}<span>${escape(project_role_count)}</span></button>
					<button type="button" role="tab" aria-selected="${state.active_tab === "guide"}" class="${state.active_tab === "guide" ? "is-active" : ""}" data-access-tab="guide">${__("权限逻辑说明")}</button>
				</nav>

				<section class="hrms-access-center__permission-model ${state.active_tab === "guide" ? "" : "is-hidden"}" aria-label="权限层级说明">
					<article><span>1</span><div><strong>${__("账户与角色分配")}</strong><p>${__("回答“这个人是谁、能登录吗、拥有哪些岗位角色”。在管理账户中改姓名、重置密码、启停和勾选角色。")}</p></div></article>
					<article><span>2</span><div><strong>${__("角色操作权限")}</strong><p>${__("回答“这个角色能对哪些业务对象执行读、写、创建、提交等操作”。同一角色的规则会复用于所有成员。")}</p></div></article>
					<article><span>3</span><div><strong>${__("用户数据范围")}</strong><p>${__("回答“这个账户只能看哪家公司、部门或员工记录”。它是额外收窄范围，不代替角色权限。")}</p></div></article>
					<article class="is-result"><span>=</span><div><strong>${__("实际有效权限")}</strong><p>${__("角色允许的操作 ∩ 用户数据范围 ∩ 具体记录所有权/共享。使用“测试实际权限”查看最终结果。")}</p></div></article>
				</section>

				<section class="hrms-access-center__panel ${state.active_tab === "accounts" ? "" : "is-hidden"}">
					<div class="hrms-access-center__panel-head">
						<div><h4>${__("全部已创建账户")}</h4><p>${__("这是日常管理入口。先选人，再修改账户资料、密码和角色；不需要从单据列表反向寻找人员。")}</p></div>
						<span class="indicator-pill blue">${escape((data.accounts || []).length)} ${__("个账户 / {0} 个启用", [enabled_count])}</span>
					</div>
					<div class="hrms-access-center__filter"><input type="search" class="form-control" data-account-filter placeholder="${escape(__("搜索账户、姓名或角色"))}" value="${escape(state.account_filter)}"></div>
					<div class="table-responsive">
						<table class="table hrms-access-center__account-table">
							<thead><tr><th>${__("账户")}</th><th>${__("姓名 / 状态")}</th><th>${__("已分配角色")}</th><th>${__("数据范围")}</th><th>${__("账户操作")}</th></tr></thead>
							<tbody>${accounts.map((account) => `
								<tr>
									<td><strong>${escape(account.user)}</strong><small>${escape(account.user_type)}</small></td>
									<td>${escape(account.full_name)}<span class="indicator-pill ${account.enabled ? "green" : "gray"}">${account.enabled ? __("启用") : __("已停用")}</span></td>
									<td><div class="hrms-access-center__role-chips">${assigned_roles(account)}</div></td>
									<td><div class="hrms-access-center__scope-chips">${assigned_scopes(account)}</div></td>
									<td class="hrms-access-center__account-actions">
										${account.user === "Administrator" ? `<span class="text-muted">${__("固定最高权限")}</span>` : `<button class="btn btn-primary btn-sm" data-action="capabilities" data-user="${escape(account.user)}">${__("勾选权限")}</button>`}
										<button class="btn btn-default btn-sm" data-action="edit-account" data-user="${escape(account.user)}">${__("账户资料")}</button>
										<button class="btn btn-default btn-sm" data-action="scope" data-user="${escape(account.user)}">${__("管理数据范围")}</button>
										<button class="btn btn-default btn-sm" data-action="test-user" data-user="${escape(account.user)}">${__("验证权限")}</button>
										${protected_accounts.has(account.user) ? "" : `<button class="btn btn-danger btn-sm" data-action="delete-account" data-user="${escape(account.user)}">${__("删除账号")}</button>`}
									</td>
							</tr>`).join("") || `<tr><td colspan="5" class="text-muted">${__("没有符合条件的账户")}</td></tr>`}</tbody>
						</table>
					</div>
				</section>

				<section class="hrms-access-center__panel ${state.active_tab === "roles" ? "" : "is-hidden"}">
					<div class="hrms-access-center__panel-head">
						<div><h4>${__("已开放的权限")}</h4><p>${__("只展示已完成业务链路验收的权限。其他 Frappe 预置角色保留在系统中，但暂不在此处开放勾选。")}</p></div>
					</div>
					<div class="hrms-access-center__role-list">
						${(data.capabilities || []).map((capability) => `<article class="hrms-access-center__role-card">
							<div class="hrms-access-center__role-copy">
								<div class="hrms-access-center__role-title"><strong>${escape(capability.label)}</strong><span>${escape(capability.category)}${["high", "critical"].includes(capability.risk) ? ` · ${__("高风险")}` : ""}</span></div>
								<p>${escape(capability.description)}</p><code>${escape(capability.role)}</code>
							</div>
						</article>`).join("")}
					</div>
					<ul>${(data.design_notes || []).map((note) => `<li>${escape(note)}</li>`).join("")}</ul>
				</section>

				<section class="hrms-access-center__panel hrms-access-center__role-panel ${state.active_tab === "roles" ? "" : "is-hidden"}">
					<div class="hrms-access-center__panel-head">
						<div><h4>${__("角色与业务对象权限")}</h4><p>${__("默认只显示已开放的角色。需要排查历史或 Frappe 预置角色时，可手动取消下方筛选。")}</p></div>
						<span class="indicator-pill gray">${escape(project_role_count)} ${__("个已开放角色")}</span>
					</div>
					<div class="hrms-access-center__role-toolbar">
						<div class="hrms-access-center__filter"><input type="search" class="form-control" data-role-filter placeholder="${escape(__("搜索角色、用途或业务对象"))}" value="${escape(state.role_filter)}"></div>
					<label><input type="checkbox" data-project-role-toggle ${state.opened_roles_only ? "checked" : ""}> ${__("仅显示已开放角色")}</label>
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

				<section class="hrms-access-center__password-note alert alert-info ${state.active_tab === "guide" ? "" : "is-hidden"}">
					<strong>${__("密码与业务权限说明")}</strong>：${__("管理员可以重设密码，但系统不会保存可查看的明文密码。权限勾选保存后会直接进入实际权限引擎，无需修改代码；请用真实账户和具体记录再次验证。")}
				</section>
			</div>
		`);

		$(page.body).find("[data-access-tab]").on("click", function () {
			state.active_tab = this.dataset.accessTab;
			render();
		});

		$(page.body).find("[data-account-filter]").on("input", function () {
			state.account_filter = this.value;
			render();
		});
		$(page.body).find("[data-role-filter]").on("input", function () {
			state.role_filter = this.value;
			render();
		});
		$(page.body).find("[data-project-role-toggle]").on("change", function () {
			state.opened_roles_only = this.checked;
			render();
		});
		$(page.body).find("[data-action='edit-account']").on("click", function () {
			frappe.set_route("Form", "User", this.dataset.user);
		});
		$(page.body).find("[data-action='capabilities']").on("click", function () {
			const account = (state.data.accounts || []).find((item) => item.user === this.dataset.user);
			if (account) open_capability_editor(account);
		});
		$(page.body).find("[data-action='scope']").on("click", function () {
			frappe.route_options = { user: this.dataset.user };
			frappe.set_route("List", "User Permission");
		});
		$(page.body).find("[data-action='test-user']").on("click", function () {
			open_permission_tester(this.dataset.user);
		});
		$(page.body).find("[data-action='delete-account']").on("click", function () {
			const account = (state.data.accounts || []).find((item) => item.user === this.dataset.user);
			if (account) open_delete_account_dialog(account);
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
		return Promise.all([
			frappe.call("hrms.api.employee_field_template.get_hrms_access_center"),
			frappe.call("hrms.access_control.get_hrms_capability_catalog"),
		])
			.then(([accessResponse, capabilityResponse]) => {
				state.data = { ...(accessResponse.message || {}), ...(capabilityResponse.message || {}) };
				render();
			})
			.catch(() => $(page.body).html(`<div class="alert alert-danger">${__("无法读取账户与角色。请使用系统管理员账号进入。")}</div>`));
	}

	load();
};
