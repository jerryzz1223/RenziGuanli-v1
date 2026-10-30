/* Single employee export: no stored public/private file is created. */
(() => {
	const pending = new Set();
	const acceptedTypes = new Set([
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"application/octet-stream",
	]);
	async function serverMessage(response) {
		try {
			const data = await response.json();
			const messages = JSON.parse(data._server_messages || "[]");
			const last = messages[messages.length - 1];
			const item = typeof last === "string" ? JSON.parse(last) : last;
			return typeof item?.message === "string" ? item.message.slice(0, 500) : "";
		} catch (_) {
			return "";
		}
	}
	window.hrmsExportEmployeeHistory = async function (employee) {
		employee = String(employee || "").trim();
		if (!employee || pending.has(employee)) return;
		if (!pending.size) frappe.dom.freeze(__("正在汇总员工履历，请稍候…"));
		pending.add(employee);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 180000);
		let message = "";
		try {
			const response = await fetch(`/api/method/hrms.api.employee_history_export.download_employee_history?employee=${encodeURIComponent(employee)}`, {
				credentials: "same-origin",
				headers: { "X-Frappe-CSRF-Token": frappe.csrf_token || "" },
				signal: controller.signal,
			});
			const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
			if (!response.ok || !acceptedTypes.has(type)) {
				if (type === "application/json") message = await serverMessage(response);
				throw new Error("export-response-invalid");
			}
			const blob = await response.blob();
			const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
			if (signature.length !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b || signature[2] !== 3 || signature[3] !== 4) {
				message = __("服务器返回的文件为空或格式异常，请重试或联系管理员。");
				throw new Error("export-file-invalid");
			}
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			try {
				link.href = url;
				link.download = `${employee.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")}-全履历.xlsx`;
				document.body.appendChild(link);
				link.click();
			} finally {
				link.remove();
				setTimeout(() => URL.revokeObjectURL(url), 60000);
			}
		} catch (error) {
			if (error.name === "AbortError") message = __("履历导出请求超时，请稍后重试；持续超时请联系管理员检查数据量。");
			const text = message || __("请检查人事导出及员工读取权限，或联系管理员检查数据来源后重试。");
			frappe.msgprint({ title: __("履历导出失败"), indicator: "red", message: frappe.utils.escape_html(text) });
		} finally {
			clearTimeout(timeout);
			pending.delete(employee);
			if (!pending.size) frappe.dom.unfreeze();
		}
	};
})();
