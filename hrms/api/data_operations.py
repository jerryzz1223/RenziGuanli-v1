"""Restricted operational status for HRMS administrators.

This deliberately exposes only queue capacity and HRMS import/task summaries.
It is not a replacement for Frappe's infrastructure health report, which can
reveal database, worker and application-wide diagnostic information.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils.background_jobs import MAX_QUEUED_JOBS, get_queue, get_queue_list, get_running_jobs_in_queue


def _require_system_manager():
	if "System Manager" not in frappe.get_roles(frappe.session.user):
		frappe.throw(_("仅系统管理员可以查看数据处理中心。"), frappe.PermissionError)


def _job_method(job):
	kwargs = getattr(job, "kwargs", {}) or {}
	return str(kwargs.get("method") or kwargs.get("kwargs", {}).get("method") or getattr(job, "func_name", ""))


def _job_label(method: str):
	if method == "frappe.model.delete_doc.delete_dynamic_links":
		return "关联记录清理"
	if method.startswith("hrms.api.dingtalk"):
		return "钉钉同步"
	if method.startswith("hrms."):
		return "人资后台任务"
	return "其他系统任务"


@frappe.whitelist()
def get_data_operations_overview():
	"""Return a small, read-only operational view for System Managers."""
	_require_system_manager()
	queue_limit = int(MAX_QUEUED_JOBS)
	queues = []
	relevant_jobs = []
	for queue_name in get_queue_list():
		queue = get_queue(queue_name)
		pending = int(queue.count)
		running = len(get_running_jobs_in_queue(queue))
		queues.append(
			{
				"name": queue_name,
				"pending": pending,
				"running": running,
				"level": "危险" if pending >= queue_limit else "提醒" if pending >= queue_limit * 0.8 else "正常",
			}
		)
		for job in queue.jobs[:30]:
			method = _job_method(job)
			if method.startswith("hrms.") or method == "frappe.model.delete_doc.delete_dynamic_links":
				relevant_jobs.append({"queue": queue_name, "type": _job_label(method), "method": method})

	queued_total = sum(row["pending"] for row in queues)
	return {
		"queue_limit": queue_limit,
		"queued_total": queued_total,
		"level": "危险" if any(row["level"] == "危险" for row in queues) else "提醒" if any(row["level"] == "提醒" for row in queues) else "正常",
		"queues": queues,
		"relevant_jobs": relevant_jobs[:20],
		"message": (
			"队列接近上限时，请暂停批量同步和大范围撤回；数据处理中心不会清空系统队列。"
			if queued_total >= queue_limit * 0.8
			else "队列可用。考勤撤回会在当前请求内清理生成记录，不再为每条记录投递关联清理任务。"
		),
		"actions": [
			{"label": "导入批次管理", "route": "/desk/attendance-import-center/import-batches"},
			{"label": "钉钉同步中心", "route": "/desk/attendance-import-center/dingtalk"},
			{"label": "钉钉同步日志", "route": "/desk/hrms-dingtalk-sync-log"},
		],
	}
