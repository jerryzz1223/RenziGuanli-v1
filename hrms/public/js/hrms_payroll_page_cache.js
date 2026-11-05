(() => {
	// Frappe persists Page scripts across reloads. Discard only the old payroll
	// script so the next visit fetches the correction UI from the current server.
	const key = "_page:payroll-input-center";
	const revision = "HRMS_PAYROLL_PAGE_REVISION: 20261104-dashboard-performance-v5";
	try {
		const cached = localStorage.getItem(key);
		if (!cached) return;
		const docs = JSON.parse(cached);
		const pages = Array.isArray(docs) ? docs : [docs];
		if (!pages.some((page) => page?.name === "payroll-input-center" && String(page.script || "").includes(revision))) {
			localStorage.removeItem(key);
		}
	} catch (error) {
		// Blocked storage must not prevent Desk from starting.
		console.warn("Unable to refresh payroll page cache", error);
	}
})();
