(() => {
	"use strict";

	const ENTRY_PATHS = new Set(["", "/desktop", "/desk/desktop", "/app/desktop"]);
	const BRAND = "/assets/hrms/images/yongxin-brand-mark-red.png";

	function enhanceEntry() {
		const isEntry = ENTRY_PATHS.has(window.location.pathname.replace(/\/+$/, ""));
		const wrapper = isEntry && document.querySelector(".desktop-wrapper");
		// Enhance only the app already rendered by Frappe's permission-aware desktop.
		const entry = wrapper && wrapper.querySelector('.desktop-container a.desktop-icon[data-id="人资管理系统"]');
		document.body.classList.toggle("hrms-entry-page", Boolean(entry));
		if (!entry) return;
		wrapper.classList.add("hrms-entry");
		if (document.title === "Desktop") document.title = "系统入口 · 人资管理系统";
		document.querySelectorAll("link[rel~='icon']").forEach((icon) => {
			icon.setAttribute("href", "/assets/hrms/images/blank-brand.svg");
		});
		const home = wrapper.querySelector(".navbar-home");
		if (home && !home.querySelector(".hrms-entry-brand")) {
			const name = document.createElement("span");
			name.className = "hrms-entry-brand";
			name.textContent = "永新电子";
			home.appendChild(name);
		}
		if (!entry.querySelector(".hrms-entry-description")) {
			const description = document.createElement("span");
			description.className = "hrms-entry-description";
			description.textContent = "人事档案、组织管理、考勤假期与薪酬业务";
			const action = document.createElement("span");
			action.className = "hrms-entry-action";
			action.innerHTML = '进入系统 <span aria-hidden="true">↗</span>';
			entry.append(description, action);
		}
		entry.classList.add("hrms-entry-card");
		const title = entry.querySelector(".icon-title");
		if (title) {
			title.setAttribute("role", "heading");
			title.setAttribute("aria-level", "1");
		}
		const search = wrapper.querySelector("#search-widget-button");
		if (search) {
			search.title = "搜索";
			search.setAttribute("aria-label", "搜索");
		}
		const logo = entry.querySelector("img.app-icon");
		if (logo && logo.getAttribute("src") !== BRAND) logo.setAttribute("src", BRAND);
	}

	function start() {
		enhanceEntry();
		// Desktop and its icons render asynchronously and can be rebuilt on return.
		let pending = false;
		new MutationObserver(() => {
			if (pending) return;
			pending = true;
			requestAnimationFrame(() => {
				pending = false;
				enhanceEntry();
			});
		}).observe(document.getElementById("body") || document.body, { childList: true, subtree: true });
		window.frappe?.router?.on("change", enhanceEntry);
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start, { once: true });
	} else {
		start();
	}
})();
