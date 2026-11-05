frappe.pages["cross-department-support"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({parent: wrapper, title: __("支援次数"), single_column: true});
    wrapper.cross_department_support = new CrossDepartmentSupportPage(page);
    wrapper.cross_department_support.show();
};

class CrossDepartmentSupportPage {
    constructor(page) {
        this.page = page;
        this.wrapper = page.main[0];
        this.year_request = 0;
    }

    show() {
        this.page.set_primary_action(__("填写每月次数"), () => this.open_counts_dialog(this.employee.get_value()));
        $(this.wrapper).html(`<div class="cross-department-support-page">
            <div class="cross-department-support-page__intro"><div><h4>${__("支援次数")}</h4><p>${__("每月填写支援总次数，按年汇总 1—12 月次数。")}</p></div></div>
            <div class="support-count-filters"><div data-year></div><div data-employee></div><button class="btn btn-default" data-year-summary>${__("查看年度汇总")}</button></div>
            <div class="cross-department-support-page__results" data-results></div></div>`);
        const make = (selector, df) => frappe.ui.form.make_control({parent: $(this.wrapper).find(selector), df, render_input: true});
        this.year = make("[data-year]", {fieldname: "year", fieldtype: "Data", label: __("年份"), default: frappe.datetime.get_today().slice(0, 4)});
        this.employee = make("[data-employee]", {fieldname: "employee", fieldtype: "Link", options: "Employee", label: __("员工（留空查看全部）")});
        $(this.wrapper).on("click", "[data-year-summary]", () => this.search());
        this.search();
    }

    search() {
        const request = ++this.year_request;
        const output = $(this.wrapper).find("[data-results]");
        output.text(__("正在加载年度汇总…"));
        return Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.get_yearly_support_counts",
            args: {year: this.year.get_value(), employee: this.employee.get_value() || null}})).then(response => {
            if (request !== this.year_request) return;
            const data = response.message || {};
            if (data.available === false) {output.text(data.message); return;}
            const escape = value => frappe.utils.escape_html(String(value ?? ""));
            output.html(`<table class="table table-bordered"><thead><tr><th>${__("员工")}</th>
                ${Array.from({length: 12}, (_, i) => `<th>${i + 1}${__("月")}</th>`).join("")}<th>${escape(data.year)}${__("年合计")}</th></tr></thead><tbody>
                ${(data.rows || []).map(row => `<tr><td>${escape(row.employee_name)}<br><small class="text-muted">${escape(row.employee)}</small></td>
                    ${row.months.map(value => `<td>${value == null ? "—" : escape(value)}</td>`).join("")}<td><strong>${escape(row.total_count)}</strong></td></tr>`).join("") || `<tr><td colspan="14">${__("该年度暂无填写记录")}</td></tr>`}
                </tbody></table><p class="text-muted" style="padding: 12px; margin: 0">${__("— 表示该月未填写；年度合计为已填写月份的次数之和。")}</p>`);
        }).catch(() => {if (request === this.year_request) output.text(__("年度汇总加载失败，请检查年份或权限后重试。"));});
    }

    open_counts_dialog(employee = null) {
        let dialog, request = 0, loaded_key = null;
        const key = () => `${dialog.get_value("employee") || ""}/${dialog.get_value("month") || ""}`;
        const load = () => {
            if (!dialog) return;
            const current = ++request;
            loaded_key = null;
            dialog.get_primary_btn().prop("disabled", true);
            const employee = dialog.get_value("employee"), month = dialog.get_value("month");
            const output = dialog.fields_dict.counts.$wrapper;
            if (!employee || !month) {output.text(__("选择员工和月份后填写该月支援总次数。")); return;}
            const selected = key();
            output.text(__("正在读取月度次数…"));
            return Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.get_monthly_support_count",
                args: {employee, month}})).then(response => {
                if (current !== request || selected !== key()) return;
                const data = response.message || {};
                if (data.available === false) {output.text(data.message); return;}
                return Promise.resolve(dialog.set_value("support_count", data.monthly_count)).then(() => {
                    if (current !== request || selected !== key()) return;
                    loaded_key = selected;
                    dialog.get_primary_btn().prop("disabled", !data.can_edit);
                    output.text(data.can_edit ? __("填写当月总次数；再次保存会更新该月次数。") : __("当前仅可查看，需要月度记录权限才能填写。"));
                });
            }).catch(() => {if (current === request) output.text(__("读取失败，请重新选择月份后重试。"));});
        };
        dialog = new frappe.ui.Dialog({title: __("每月支援次数"), fields: [
            {fieldname: "employee", fieldtype: "Link", options: "Employee", label: __("员工"), default: employee, reqd: 1, change: load},
            {fieldname: "month", fieldtype: "Data", label: __("月份（YYYY-MM）"), default: this.count_month?.get_value() || frappe.datetime.get_today().slice(0, 7), reqd: 1, change: load},
            {fieldname: "support_count", fieldtype: "Int", label: __("该月支援次数"), default: 0, reqd: 1,
                description: __("填写该员工当月总次数，允许为 0；再次保存会更新该月次数。")},
            {fieldname: "counts", fieldtype: "HTML"},
        ], primary_action_label: __("保存月度次数"), primary_action: values => {
            if (loaded_key !== key() || dialog.saving) return;
            dialog.saving = true;
            dialog.get_primary_btn().prop("disabled", true);
            return Promise.resolve(frappe.call({method: "hrms.api.cross_department_support.save_monthly_support_count",
                args: values, freeze: true})).then(() => {
                frappe.show_alert({message: __("月度支援次数已保存。"), indicator: "green"});
                this.search();
                return load();
            }).finally(() => {dialog.saving = false; if (loaded_key) dialog.get_primary_btn().prop("disabled", false);});
        }});
        dialog.show();
        load();
        return dialog;
    }

}
