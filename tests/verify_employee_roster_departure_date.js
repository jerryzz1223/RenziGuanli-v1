const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const list = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms", "public", "css", "hrms_top_nav.css"), "utf8");
const api = fs.readFileSync(path.join(root, "hrms", "api", "employee_field_template.py"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

mustInclude(list, '{ fieldname: "relieving_date", label: "离职日期" }', "花名册必须定义离职日期列。");
mustInclude(list, '"relieving_date",', "花名册请求必须包含 Employee.relieving_date。");
mustInclude(list, 'get_active_roster_card().filters.custom_work_nature === "离职"', "离职日期只应在已离职工作性质显示。");
mustInclude(list, "get_visible_roster_columns", "表头必须随离职状态切换日期列。");
mustInclude(list, 'toggle_roster_date_column(wrapper, "date_of_joining", show_departure_date)', "离职视图必须隐藏入职日期。");
mustInclude(list, 'toggle_roster_date_column(wrapper, "relieving_date", !show_departure_date)', "离职视图必须显示离职日期。");
mustInclude(list, 'cell.style.setProperty("display", hidden ? "none" : "", hidden ? "important" : "")', "日期列显隐不能只依赖可能被缓存的样式表。");
mustInclude(list, "records_card_label", "状态卡切换时必须识别表格数据所属的状态卡。");
mustInclude(list, "request_id", "状态卡切换必须隔离旧的异步请求回调。");
mustInclude(list, "must never repaint the newly selected", "状态卡切换时不得继续渲染上一卡片的缓存员工。");
mustInclude(list, "matches_card_filter", "自定义花名册表格必须再次校验当前状态卡条件。");
mustInclude(list, "Its rows are a safe fallback", "新路由的原生花名册结果必须能补回被取消的自定义请求。");
mustInclude(list, "window.location.assign(target_url.toString())", "状态卡切换必须直接进入新的花名册路由。");
mustInclude(list, "cannot reuse prior-card rows", "状态卡切换必须避免复用上一卡片的缓存行。");
mustInclude(list, "Use a browser navigation rather than Frappe's in-place router", "状态卡切换必须绕开会复用旧列表的页面内路由。");
mustInclude(list, "apply_single_roster_filter(card, get_stored_roster_column_filter(), listview)", "状态卡必须使用渲染时的列表实例进行完整页面跳转。");
mustInclude(list, "const listview = current_listview || get_active_employee_roster_listview()", "状态卡不能依赖点击回调中可能缺失的全局列表实例。");
mustInclude(list, "frappe.route_options = route_options;\n\t\tfrappe.set_route", "已有花名册直接导航时不能让 Frappe 先用旧路由条件改写地址。");
mustInclude(list, "The custom roster API handles comparison filters itself", "比较筛选条件必须由花名册接口处理。");
mustInclude(list, "if (!Array.isArray(value)) params.set(fieldname, value)", "比较筛选条件不得交给原生列表路由解析。");
mustInclude(api, '"relieving_date",', "离职视图接口必须取回实际离职日期。");
mustInclude(css, ".hrms-roster-status-date-column-hidden", "必须提供日期列显隐样式。");

console.log("employee roster departure date column verified");
