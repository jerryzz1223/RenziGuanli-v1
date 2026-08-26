const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const list = fs.readFileSync(path.join(root, "hrms", "public", "js", "erpnext", "employee_list.js"), "utf8");
const css = fs.readFileSync(path.join(root, "hrms", "public", "css", "hrms_top_nav.css"), "utf8");

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

mustInclude(list, '{ fieldname: "relieving_date", label: "离职日期" }', "花名册必须定义离职日期列。");
mustInclude(list, '"relieving_date",', "花名册请求必须包含 Employee.relieving_date。");
mustInclude(list, 'get_active_roster_card().filters.status === "Left"', "离职日期只应在已离职状态显示。");
mustInclude(list, "get_visible_roster_columns", "表头必须随离职状态切换日期列。");
mustInclude(list, 'toggle_roster_date_column(wrapper, "date_of_joining", show_departure_date)', "离职视图必须隐藏入职日期。");
mustInclude(list, 'toggle_roster_date_column(wrapper, "relieving_date", !show_departure_date)', "离职视图必须显示离职日期。");
mustInclude(list, 'cell.style.setProperty("display", hidden ? "none" : "", hidden ? "important" : "")', "日期列显隐不能只依赖可能被缓存的样式表。");
mustInclude(css, ".hrms-roster-status-date-column-hidden", "必须提供日期列显隐样式。");

console.log("employee roster departure date column verified");
