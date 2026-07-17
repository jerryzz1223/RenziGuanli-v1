const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function mustExist(file) {
	const full = path.join(root, file);
	if (!fs.existsSync(full)) throw new Error(`Missing file: ${file}`);
	return full;
}

function read(file) {
	return fs.readFileSync(mustExist(file), "utf8");
}

function mustInclude(source, marker, message) {
	if (!source.includes(marker)) throw new Error(message || `Missing marker: ${marker}`);
}

function readJson(file) {
	return JSON.parse(read(file));
}

const api = read("hrms/api/dingtalk_integration.py");
for (const marker of [
	"DINGTALK_SETTINGS_DOCTYPE",
	"DINGTALK_RAW_RECORD_DOCTYPE",
	"DINGTALK_USER_MAP_DOCTYPE",
	"DINGTALK_SYNC_LOG_DOCTYPE",
	"DINGTALK_DEFAULT_APP_ID",
	"DINGTALK_DEFAULT_AGENT_ID",
	"DINGTALK_DEFAULT_CLIENT_ID",
	"DINGTALK_API_BASE_URL",
	"DINGTALK_OAPI_BASE_URL",
	"DINGTALK_DEPARTMENT_LIST_PATH",
	"DINGTALK_DEPARTMENT_USERS_PATH",
	"DINGTALK_ATTENDANCE_UPDATEDATA_PATH",
	"get_dingtalk_connection_status",
	"save_dingtalk_connection_settings",
	"apply_dingtalk_default_settings",
	"get_dingtalk_access_token_value",
	"fetch_dingtalk_departments",
	"sync_departments_from_dingtalk",
	"fetch_dingtalk_department_users",
	"sync_users_from_dingtalk",
	"fetch_dingtalk_attendance_update_data",
	"sync_attendance_from_dingtalk",
	"fetch_dingtalk_process_instance_ids",
	"fetch_dingtalk_process_instance_detail",
	"sync_approval_instance_details_from_payload",
	"normalize_dingtalk_department",
	"normalize_dingtalk_user",
	"upsert_raw_record",
	"upsert_user_mapping",
	"preview_sync_payload",
	"fetch_access_token",
	"sync_departments_from_payload",
	"sync_users_from_payload",
	"client_id",
	"client_secret",
	"access_token",
	"local_gateway_enabled",
	"public_gateway_enabled",
	"公网小网关",
	"部署到服务器",
	'"sync_mode": "Excel导入（默认）"',
	'"public_gateway_enabled": 0',
]) {
	mustInclude(api, marker, `DingTalk integration API is missing marker: ${marker}`);
}

const employeeGateway = read("hrms/api/dingtalk_employee_gateway.py");
for (const marker of [
	"get_employee_gateway_config",
	"get_employee_self_snapshot",
	"allow_guest=True",
	"DINGTALK_USERINFO_BY_CODE_URL",
	"_exchange_auth_code_for_userid",
	"_employee_from_dingtalk_userid",
	"HRMS Monthly Attendance Summary",
	"HRMS Attendance Day Check",
	"payroll_status",
	"does not accept",
]) {
	mustInclude(employeeGateway, marker, `DingTalk employee gateway is missing marker: ${marker}`);
}

const settings = readJson("hrms/hr/doctype/hrms_dingtalk_settings/hrms_dingtalk_settings.json");
if (settings.name !== "HRMS DingTalk Settings" || settings.issingle !== 1) {
	throw new Error("HRMS DingTalk Settings must be a Single DocType.");
}
if (settings.fields.find((field) => field.fieldname === "local_gateway_enabled").default !== "0") {
	throw new Error("Local gateway must be disabled by default for the read-only local phase.");
}
if (settings.fields.find((field) => field.fieldname === "public_gateway_enabled").default !== "0") {
	throw new Error("Public employee gateway must be disabled by default before server deployment.");
}
for (const fieldname of [
	"enabled",
	"sync_mode",
	"app_id",
	"corp_id",
	"agent_id",
	"client_id",
	"client_secret",
	"access_token",
	"token_expires_at",
	"local_gateway_enabled",
	"local_gateway_url",
	"public_gateway_enabled",
	"public_gateway_base_url",
	"employee_gateway_scopes",
	"server_deployment_note",
	"last_department_sync_at",
	"last_user_sync_at",
	"last_attendance_sync_at",
	"last_approval_sync_at",
]) {
	if (!settings.fields.some((field) => field.fieldname === fieldname)) {
		throw new Error(`DingTalk settings missing field: ${fieldname}`);
	}
}

const rawRecord = readJson("hrms/hr/doctype/hrms_dingtalk_raw_record/hrms_dingtalk_raw_record.json");
for (const fieldname of [
	"source_type",
	"external_id",
	"sync_batch",
	"payload_json",
	"payload_hash",
	"sync_status",
	"received_at",
	"processed_at",
	"error_message",
]) {
	if (!rawRecord.fields.some((field) => field.fieldname === fieldname)) {
		throw new Error(`DingTalk raw record missing field: ${fieldname}`);
	}
}

const userMap = readJson("hrms/hr/doctype/hrms_dingtalk_user_map/hrms_dingtalk_user_map.json");
for (const fieldname of [
	"dingtalk_userid",
	"employee",
	"employee_code",
	"employee_name",
	"mobile",
	"department_id",
	"department_name",
	"sync_status",
	"last_synced_at",
]) {
	if (!userMap.fields.some((field) => field.fieldname === fieldname)) {
		throw new Error(`DingTalk user map missing field: ${fieldname}`);
	}
}

const syncLog = readJson("hrms/hr/doctype/hrms_dingtalk_sync_log/hrms_dingtalk_sync_log.json");
for (const fieldname of [
	"sync_type",
	"sync_direction",
	"status",
	"started_at",
	"finished_at",
	"records_received",
	"records_created",
	"records_updated",
	"records_failed",
	"error_message",
]) {
	if (!syncLog.fields.some((field) => field.fieldname === fieldname)) {
		throw new Error(`DingTalk sync log missing field: ${fieldname}`);
	}
}

const settingsCenter = read("hrms/hr/page/hr_settings_center/hr_settings_center.js");
for (const marker of [
	"钉钉集成",
	"get_dingtalk_connection_status",
	"apply_dingtalk_default_settings",
	"save_dingtalk_connection_settings",
	"get_employee_gateway_config",
	"get_employee_self_snapshot",
	"sync_departments_from_dingtalk",
	"sync_users_from_dingtalk",
	"sync_attendance_from_dingtalk",
	"preview_sync_payload",
	"公网小网关",
	"服务器部署",
]) {
	mustInclude(settingsCenter, marker, `Settings center is missing DingTalk marker: ${marker}`);
}

const workbench = read("hrms/hr/page/hrms_workbench/hrms_workbench.js");
for (const marker of ["钉钉集成", "dingtalk-integration", "基础数据同步"]) {
	mustInclude(workbench, marker, `Workbench is missing DingTalk marker: ${marker}`);
}

console.log("DingTalk integration contract passed.");
