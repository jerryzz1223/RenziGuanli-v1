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
		const tiers = state.data?.tiers || [];
		const tier_by_label = new Map(tiers.map((tier) => [tier.label, tier.key]));
		const current_tier = tiers.find((tier) => tier.key === account.access_tier) || tiers[0];
		const dialog = new frappe.ui.Dialog({
			title: __("设置 {0} 的权限档位", [account.full_name || account.user]),
			fields: [
				{
					fieldname: "permission_notice",
					fieldtype: "HTML",
					options: `<div class="hrms-access-capability-dialog__header">
						<div class="hrms-access-capability-dialog__account">${escape(account.user)}</div>
					</div>`,
				},
				{
					fieldname: "access_tier_label",
					fieldtype: "Select",
					label: __("权限档位"),
					options: tiers.map((tier) => tier.label).join("\n"),
					default: current_tier?.label || "只读",
					reqd: 1,
					description: tiers.map((tier) => `<strong>${escape(tier.label)}</strong>：${escape(tier.description)}`).join("<br>"),
				},
				{
					fieldname: "audit_notice",
					fieldtype: "HTML",
					options: `<div class="alert alert-info">${__("权限逐级包含；提交人和审批人按实际登录账号记入单据及审计记录。")}</div>`,
				},
			],
			primary_action_label: __("保存权限"),
			primary_action() {
				const values = dialog.get_values() || {};
				const selected = tier_by_label.get(values.access_tier_label);
				dialog.disable_primary_action();
				frappe.call({
					method: "hrms.access_control.set_hrms_user_access_tier",
					args: {
						user: account.user,
						access_tier: selected,
					},
					freeze: true,
					freeze_message: __("正在保存权限..."),
					callback(response) {
						if (!response.message?.saved || response.message?.access_tier !== selected) {
							frappe.msgprint({
								title: __("保存失败"),
								message: __("权限保存后校验失败，请刷新后重试。"),
								indicator: "red",
							});
							return;
						}
						account.assigned_roles = response.message.roles || [];
						account.access_tier = response.message.access_tier;
						account.access_tier_label = response.message.access_tier_label;
						dialog.hide();
						frappe.show_alert({
							message: __("权限已保存为“{0}”", [response.message.access_tier_label]),
							indicator: "green",
						});
						load();
					},
					always() {
						dialog.enable_primary_action();
					},
				});
			},
		});
		dialog.show();
		dialog.$wrapper.addClass("hrms-access-capability-dialog");
	}

	function open_disable_account_dialog(account) {
		const dialog = new frappe.ui.Dialog({
			title: __("停用账号：{0}", [account.full_name || account.user]),
			fields: [
				{
					fieldname: "disable_notice",
					fieldtype: "HTML",
					options: `<div class="alert alert-warning">
						<strong>${__("停用后该账号将无法登录。")}</strong><br>
						${__("账号及其角色、数据范围和历史操作记录都会保留；需要时可在“账户资料”中重新启用。")}
					</div>`,
				},
			],
			primary_action_label: __("确认停用"),
			primary_action() {
				dialog.disable_primary_action();
				frappe.call("hrms.access_control.disable_hrms_user_account", {
					user: account.user,
				}).then(() => {
					dialog.hide();
					frappe.show_alert({ message: __("账户已停用，历史记录已保留"), indicator: "green" });
					load();
				}).finally(() => dialog.enable_primary_action());
			},
		});
		dialog.show();
		dialog.get_primary_btn().removeClass("btn-primary").addClass("btn-warning");
	}

	function assigned_roles(account) {
		const roles = account.assigned_roles || [];
		const labels = [account.access_tier_label || __("只读")];
		if (roles.includes("System Manager")) labels.push(__("系统管理员"));
		const visible = labels.slice(0, 3).map((role) => `<span class="hrms-access-center__role-chip">${escape(role)}</span>`).join("");
		const remaining = Math.max(0, labels.length - 3);
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
						<p>${__("账户只选只读、可以提交、审批三档之一；数据范围仍可按公司、部门或员工限定。")}</p>
					</div>
					<div class="hrms-access-center__scope"><strong>${__("管理员权限")}</strong><span>System Manager</span></div>
				</section>

				<nav class="hrms-access-center__tabs" role="tablist" aria-label="${__("账户与权限管理视图")}">
					<button type="button" role="tab" aria-selected="${state.active_tab === "accounts"}" class="${state.active_tab === "accounts" ? "is-active" : ""}" data-access-tab="accounts">${__("用户与权限")}<span>${escape((data.accounts || []).length)}</span></button>
					<button type="button" role="tab" aria-selected="${state.active_tab === "roles"}" class="${state.active_tab === "roles" ? "is-active" : ""}" data-access-tab="roles">${__("角色与业务权限")}<span>${escape(project_role_count)}</span></button>
				</nav>

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
										${account.user === "Administrator" ? `<span class="text-muted">${__("固定最高权限")}</span>` : `<button class="btn btn-primary btn-sm" data-action="capabilities" data-user="${escape(account.user)}">${__("设置权限档位")}</button>`}
										<button class="btn btn-default btn-sm" data-action="edit-account" data-user="${escape(account.user)}">${__("账户资料")}</button>
										<button class="btn btn-default btn-sm" data-action="scope" data-user="${escape(account.user)}">${__("管理数据范围")}</button>
										<button class="btn btn-default btn-sm" data-action="test-user" data-user="${escape(account.user)}">${__("验证权限")}</button>
										${protected_accounts.has(account.user) || !account.enabled ? "" : `<button class="btn btn-warning btn-sm" data-action="disable-account" data-user="${escape(account.user)}">${__("停用账号")}</button>`}
									</td>
							</tr>`).join("") || `<tr><td colspan="5" class="text-muted">${__("没有符合条件的账户")}</td></tr>`}</tbody>
						</table>
					</div>
				</section>

				<section class="hrms-access-center__panel ${state.active_tab === "roles" ? "" : "is-hidden"}">
					<div class="hrms-access-center__panel-head">
					<div><h4>${__("三档业务权限")}</h4><p>${__("只读 → 可以提交 → 审批，逐级包含。")}</p></div>
					</div>
					<div class="hrms-access-center__role-list">
					${(data.tiers || []).map((tier) => `<article class="hrms-access-center__role-card">
							<div class="hrms-access-center__role-copy">
								<div class="hrms-access-center__role-title"><strong>${escape(tier.label)}</strong></div>
								<p>${escape(tier.description)}</p><code>${escape(tier.role)}</code>
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
		$(page.body).find("[data-action='disable-account']").on("click", function () {
			const account = (state.data.accounts || []).find((item) => item.user === this.dataset.user);
			if (account) open_disable_account_dialog(account);
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
