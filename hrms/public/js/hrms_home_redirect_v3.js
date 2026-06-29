(function () {
	var text_replacements = {
		"Begin typing for results.": "输入以搜索结果。",
	};

	function redirect_to_hrms_home() {
		var path = window.location.pathname.replace(/\/+$/, "");
		var hash = window.location.hash || "";
		if ((path === "/desk" && (!hash || hash === "#")) || path === "/apps") {
			window.location.replace("/desk/hr-setup");
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

	function localize_dynamic_text() {
		document.querySelectorAll("input, textarea").forEach(function (field) {
			var placeholder = field.getAttribute("placeholder");
			if (placeholder && text_replacements[placeholder]) {
				field.setAttribute("placeholder", text_replacements[placeholder]);
			}
		});

		var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		var node;
		while ((node = walker.nextNode())) {
			var text = node.nodeValue.trim();
			if (text_replacements[text]) {
				node.nodeValue = node.nodeValue.replace(text, text_replacements[text]);
			}
		}
	}

	function apply_hrms_ui_rules() {
		hide_unneeded_menu_items();
		localize_dynamic_text();
	}

	redirect_to_hrms_home();
	apply_hrms_ui_rules();
	window.addEventListener("hashchange", redirect_to_hrms_home);
	new MutationObserver(apply_hrms_ui_rules).observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
})();
