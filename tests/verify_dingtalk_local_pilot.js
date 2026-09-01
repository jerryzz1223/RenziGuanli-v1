const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const integration = read("hrms/api/dingtalk_integration.py");
for (const marker of [
	"LOCAL_PILOT_MAX_USERS = 5",
	"_parse_local_pilot_userids",
	"queue_dingtalk_local_pilot_sync",
	"本地试运行最多只能同步 {0} 名员工",
	"本地试运行要求“启用员工端公网小网关”保持关闭",
	"本地试运行要求“每日自动同步”保持关闭",
	"userids_json=userids",
	"doc.reload()",
]) {
	assert(integration.includes(marker), `Missing local DingTalk pilot guard: ${marker}`);
}

const settingsCenter = read("hrms/hr/page/hr_settings_center/hr_settings_center.js");
assert(!settingsCenter.includes("SYSTEM_SETTINGS_MODULES = new Set([\"钉钉集成\""), "DingTalk must not remain a Settings Center module.");
assert(!settingsCenter.includes("render_dingtalk_integration"), "DingTalk controls must not remain duplicated in Settings Center.");

const attendanceCenter = read("hrms/hr/page/attendance_import_center/attendance_import_center.js");
for (const marker of [
	"standalone_views",
	"key: \"dingtalk\"",
	"render_dingtalk_integration()",
	"open_dingtalk_local_pilot_dialog",
	"open_dingtalk_configuration",
	"queue_dingtalk_local_pilot_sync",
	"save_dingtalk_connection_settings",
	"dingtalk-manual-sync",
	"手动拉取指定日期",
	"每日自动同步（02:30）",
	"sync_lookback_days",
	"最多 5 名员工",
]) {
	assert(attendanceCenter.includes(marker), `Missing standalone DingTalk integration UI: ${marker}`);
}

const topNav = read("hrms/public/js/hrms_top_nav.js");
for (const marker of [
	'label: "钉钉集成"',
	'route: "/desk/attendance-import-center/dingtalk"',
	"钉钉考勤、员工映射与同步记录",
	"function isDingtalkIntegrationRoute()",
	'if (isDingtalkIntegrationRoute()) return "";',
	"const moreActive = isDingtalkIntegrationRoute()",
]) {
	assert(topNav.includes(marker), `Missing DingTalk 更多 menu entry: ${marker}`);
}

const sidebar = read("hrms/public/js/hrms_home_redirect_v6.js");
for (const marker of [
	'label: "钉钉集成"',
	'keys: ["attendance-import-center/dingtalk", "hrms-dingtalk-user-map", "hrms-dingtalk-raw-record", "hrms-dingtalk-sync-log"]',
	'label: "数据与记录"',
	'route: "/desk/List/HRMS DingTalk User Map"',
]) {
	assert(sidebar.includes(marker), `Missing DingTalk sidebar context: ${marker}`);
}

console.log("DingTalk local pilot contract passed.");
