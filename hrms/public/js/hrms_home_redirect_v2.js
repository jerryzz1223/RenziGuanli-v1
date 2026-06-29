(function () {
	function redirect_to_hrms_home() {
		var path = window.location.pathname.replace(/\/+$/, "");
		var hash = window.location.hash || "";
		if ((path === "/desk" && (!hash || hash === "#")) || path === "/apps") {
			window.location.replace("/desk/expenses");
		}
	}

	function hide_unneeded_menu_items() {
		var hidden_labels = new Set(["桌面", "Desktop", "网站", "Website"]);
		document
			.querySelectorAll(".dropdown-menu a, .dropdown-menu button, .dropdown-menu .dropdown-item")
			.forEach(function (item) {
				var text = (item.innerText || item.textContent || "").trim();
				if (hidden_labels.has(text)) {
					item.style.display = "none";
				}
			});
	}

	redirect_to_hrms_home();
	hide_unneeded_menu_items();
	window.addEventListener("hashchange", redirect_to_hrms_home);
	new MutationObserver(hide_unneeded_menu_items).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
})();
