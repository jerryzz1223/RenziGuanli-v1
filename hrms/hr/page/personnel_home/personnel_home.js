frappe.pages["personnel-home"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("人事首页"), single_column: true });
	new PersonnelHome(page).show();
};

const PROVINCE_LABELS = {
	"北京": "北京市", "天津": "天津市", "上海": "上海市", "重庆": "重庆市", "香港": "香港特别行政区", "澳门": "澳门特别行政区", "台湾": "台湾省",
	"内蒙古": "内蒙古自治区", "广西": "广西壮族自治区", "西藏": "西藏自治区", "宁夏": "宁夏回族自治区", "新疆": "新疆维吾尔自治区",
};

const PERSONNEL_CHART_COLORS = ["#4b75cc", "#78a2ed", "#89b89f", "#e8b15d", "#d98272", "#9d83cb"];

class PersonnelHome {
	constructor(page) {
		this.page = page;
		this.wrapper = page.main[0];
		this.members = {};
		this.selectedProvince = "";
	}

	show() {
		this.page.set_title(__("人事首页"));
		this.wrapper.innerHTML = '<section class="personnel-home personnel-home--state">正在加载人事数据…</section>';
		frappe.call("hrms.hr.page.personnel_home.personnel_home.get_data")
			.then((response) => this.render(response.message || {}))
			.catch(() => this.render_error());
	}

	render_error() {
		this.wrapper.innerHTML = '<section class="personnel-home personnel-home--state"><p>人事首页数据暂时无法读取。</p><button class="btn btn-default" data-personnel-refresh>重新加载</button></section>';
		this.wrapper.querySelector("[data-personnel-refresh]")?.addEventListener("click", () => this.show());
	}

		render(data) {
			const overview = data.right_rail?.overview || {};
			const personnel = data.cards?.personnel || {};
			const analytics = data.analytics || {};
		const number = (value) => frappe.utils.escape_html(String(value || 0));
		this.wrapper.innerHTML = `
			<section class="personnel-home">
				<header class="personnel-home__header"><div><p>${frappe.utils.escape_html(data.today?.date_label || "")}</p><h2>人事首页</h2><span>员工结构、入转离和人事日常工作概览</span></div><button class="btn btn-default" data-personnel-refresh>刷新数据</button></header>
				<div class="personnel-home__metrics">
					${this.metric("在职员工", number(overview.active), `员工总数 ${number(overview.total)}`)}
					${this.metric("试用期", number(overview.probation), `本月入职 ${number(personnel.new_hires)}`)}
					${this.metric("待办入转离", number((personnel.onboarding || 0) + (personnel.separation || 0)), `待入职 ${number(personnel.onboarding)} · 待离职 ${number(personnel.separation)}`)}
				</div>
				<section class="personnel-home__analytics">
					${this.map(analytics.native_place || {})}
					<div class="personnel-home__side">
						${this.chart("学历结构", "按最高学历统计", analytics.education || {}, "暂无学历数据")}
						${this.departments(analytics.department || {})}
					</div>
				</section>
			</section>`;
		this.bind();
		this.render_province_map(analytics.native_place || {});
	}

	metric(label, value, note) {
		return `<article class="personnel-home__metric"><span>${label}</span><b>${value}</b><small>${note}</small></article>`;
	}

	map(distribution) {
		this.members = distribution.members || {};
		this.nativePlaceCounts = new Map((distribution.items || []).map((item) => [item.label, Number(item.count) || 0]));
		this.nativePlaceTotal = Number(distribution.total) || 0;
		this.selectedProvince = "";
		return `<article class="personnel-home__card personnel-home__map-card"><header><div><h3>人员籍贯分布</h3><p>移入省份可高亮整块区域并查看员工信息；点击可固定查看</p></div><b>${this.nativePlaceTotal} 人</b></header><div class="personnel-home__map-layout"><div class="personnel-home__map" data-province-map><span>正在加载省级地图…</span></div><div class="personnel-home__member-detail" data-member-detail>移入地图中的省份，查看该省在职员工姓名。</div></div></article>`;
	}

	province_label(name) {
		return PROVINCE_LABELS[name] || `${name}省`;
	}

	decode_geojson(geojson) {
		if (!geojson.UTF8Encoding) return geojson;
		const decode_ring = (encoded, offset) => {
			let previousX = offset[0];
			let previousY = offset[1];
			const ring = [];
			for (let index = 0; index < encoded.length; index += 2) {
				let x = encoded.charCodeAt(index) - 64;
				let y = encoded.charCodeAt(index + 1) - 64;
				x = (x >> 1) ^ (-(x & 1));
				y = (y >> 1) ^ (-(y & 1));
				previousX += x;
				previousY += y;
				ring.push([previousX / 1024, previousY / 1024]);
			}
			return ring;
		};
		geojson.features.forEach((feature) => {
			const geometry = feature.geometry;
			const offsets = geometry.encodeOffsets || [];
			if (geometry.type === "Polygon") geometry.coordinates = geometry.coordinates.map((ring, index) => decode_ring(ring, offsets[index]));
			if (geometry.type === "MultiPolygon") geometry.coordinates = geometry.coordinates.map((polygon, polygonIndex) => polygon.map((ring, ringIndex) => decode_ring(ring, offsets[polygonIndex][ringIndex])));
			delete geometry.encodeOffsets;
		});
		geojson.UTF8Encoding = false;
		return geojson;
	}

	feature_rings(feature) {
		return feature.geometry.type === "Polygon" ? feature.geometry.coordinates : feature.geometry.coordinates.flat();
	}

	map_bounds(features) {
		const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
		features.forEach((feature) => this.feature_rings(feature).forEach((ring) => ring.forEach(([x, y]) => {
			bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
			bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
		})));
		return bounds;
	}

	feature_path(feature, bounds) {
		const width = 1000;
		const height = 660;
		const scale = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY));
		const offsetX = (width - (bounds.maxX - bounds.minX) * scale) / 2;
		const offsetY = (height - (bounds.maxY - bounds.minY) * scale) / 2;
		const project = ([x, y]) => [offsetX + (x - bounds.minX) * scale, offsetY + (bounds.maxY - y) * scale];
		return this.feature_rings(feature).map((ring) => ring.map((point, index) => {
			const [x, y] = project(point);
			return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
		}).join("") + "Z").join(" ");
	}

	async render_province_map() {
		const host = this.wrapper.querySelector("[data-province-map]");
		if (!host) return;
		try {
			const response = await fetch("/assets/hrms/data/china-provinces.geojson");
			if (!response.ok) throw new Error("map data unavailable");
			const geojson = this.decode_geojson(await response.json());
			const bounds = this.map_bounds(geojson.features);
			const max = Math.max(...Array.from(this.nativePlaceCounts.values()), 0);
			const paths = geojson.features.map((feature) => {
				const place = this.province_label(feature.properties.name);
				const count = this.nativePlaceCounts.get(place) || 0;
				const level = count && max ? Math.max(.25, count / max) : 0;
				return `<path class="personnel-home__province ${count ? "is-populated" : ""}" data-province="${frappe.utils.escape_html(place)}" data-count="${count}" style="--level:${level}" d="${this.feature_path(feature, bounds)}" tabindex="0" role="button" aria-label="${frappe.utils.escape_html(`${place}，${count} 名在职员工`)}"/>`;
			}).join("");
			host.innerHTML = `<svg class="personnel-home__province-svg" viewBox="0 0 1000 660" aria-label="中国省级员工籍贯分布图">${paths}</svg><div class="personnel-home__map-tooltip" data-map-tooltip role="status"></div>`;
			host.querySelectorAll("[data-province]").forEach((province) => {
				province.addEventListener("mouseenter", (event) => this.preview_province(province, event));
				province.addEventListener("focus", (event) => this.preview_province(province, event));
				province.addEventListener("click", (event) => this.select_province(province, event));
				province.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						this.select_province(province, event);
					}
				});
				province.addEventListener("mouseleave", () => {
					if (!this.selectedProvince) this.hide_province_tooltip();
				});
			});
		} catch (error) {
			host.innerHTML = '<span>省级地图资源暂时无法加载，请刷新后重试。</span>';
		}
	}

	preview_province(province, event) {
		if (this.selectedProvince) return;
		this.activate_province(province, event, false);
	}

	select_province(province, event) {
		this.selectedProvince = province.dataset.province || "";
		this.activate_province(province, event, true);
	}

	activate_province(province, event, selected) {
		const host = this.wrapper.querySelector("[data-province-map]");
		const place = province.dataset.province || "";
		if (!host || !place) return;
		host.querySelectorAll(".is-hovered, .is-selected").forEach((item) => item.classList.remove("is-hovered", "is-selected"));
		province.classList.add(selected ? "is-selected" : "is-hovered");
		this.show_members(place);
		const tooltip = host.querySelector("[data-map-tooltip]");
		const members = this.members[place] || [];
		const count = Number(province.dataset.count) || 0;
		const ratio = this.province_ratio(count);
		const preview = members.slice(0, 12).map((member) => frappe.utils.escape_html(this.member_name(member))).join("、");
		tooltip.innerHTML = `<strong>${frappe.utils.escape_html(place)}</strong><span>${count} 人 · 占人员 ${ratio}${preview ? ` · ${preview}${members.length > 12 ? "等" : ""}` : ""}</span>`;
		tooltip.classList.add("is-visible");
		const box = host.getBoundingClientRect();
		const x = event?.clientX ? event.clientX - box.left : box.width / 2;
		const y = event?.clientY ? event.clientY - box.top : box.height / 2;
		tooltip.style.left = `${Math.max(8, Math.min(box.width - 8, x))}px`;
		tooltip.style.top = `${Math.max(8, Math.min(box.height - 8, y))}px`;
	}

	hide_province_tooltip() {
		this.wrapper.querySelector("[data-map-tooltip]")?.classList.remove("is-visible");
	}

	member_name(member) {
		return typeof member === "string" ? member : String(member?.employee_name || "");
	}

	employee_name(member) {
		return typeof member === "object" ? String(member?.name || "") : "";
	}

	province_ratio(count) {
		return this.nativePlaceTotal ? `${(Number(count) / this.nativePlaceTotal * 100).toFixed(1)}%` : "0.0%";
	}

	chart(title, subtitle, distribution, empty) {
		const items = this.items(distribution);
		const total = items.reduce((sum, item) => sum + item.count, 0);
		let start = 0;
		const segments = items.map((item, index) => { const end = total ? start + item.count / total * 100 : 0; const result = `${PERSONNEL_CHART_COLORS[index % PERSONNEL_CHART_COLORS.length]} ${start}% ${end}%`; start = end; return result; });
		return `<article class="personnel-home__card"><header><div><h3>${title}</h3><p>${subtitle}</p></div></header><div class="personnel-home__chart"><div class="personnel-home__donut" style="background:${segments.length ? `conic-gradient(${segments.join(",")})` : "#edf1f5"}"><span>${total}<small>人</small></span></div><div>${items.length ? items.map((item, index) => `<p><i style="--color:${PERSONNEL_CHART_COLORS[index % PERSONNEL_CHART_COLORS.length]}"></i>${frappe.utils.escape_html(item.label)}<b>${item.count}</b></p>`).join("") : `<p>${empty}</p>`}</div></div></article>`;
	}

	departments(distribution) {
		const items = distribution.items || [];
		const max = Math.max(...items.map((item) => Number(item.count) || 0), 0);
		return `<article class="personnel-home__card"><header><div><h3>部门人员分布</h3><p>在职员工人数最多的部门</p></div></header><div class="personnel-home__bars">${items.length ? items.map((item) => `<p><span>${frappe.utils.escape_html(item.label)}</span><i><b style="width:${max ? Math.max(6, Number(item.count) / max * 100) : 0}%"></b></i><strong>${item.count} 人</strong></p>`).join("") : "暂无部门数据"}</div></article>`;
	}

	items(distribution) {
		const items = (distribution.items || []).map((item) => ({ label: item.label, count: Number(item.count) || 0 }));
		if (distribution.other) items.push({ label: "其他", count: Number(distribution.other) });
		if (distribution.unreported) items.push({ label: "未填写", count: Number(distribution.unreported) });
		return items.filter((item) => item.count);
	}

	bind() {
		this.wrapper.querySelectorAll("[data-personnel-refresh]").forEach((button) => button.addEventListener("click", () => this.show()));
		this.wrapper.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => frappe.set_route(...JSON.parse(button.dataset.route))));
	}

	show_members(place) {
		const detail = this.wrapper.querySelector("[data-member-detail]");
		const members = this.members[place] || [];
		const count = this.nativePlaceCounts.get(place) || 0;
		if (!detail || !place) return;
		const ratio = this.province_ratio(count);
		detail.innerHTML = members.length ? `<strong>${frappe.utils.escape_html(place)} · ${count} 人 <span class="personnel-home__member-ratio">占人员 ${ratio}</span></strong><div>${members.map((member) => {
			const employee = this.employee_name(member);
			const name = frappe.utils.escape_html(this.member_name(member));
			return employee ? `<button type="button" class="personnel-home__member-link" data-employee="${frappe.utils.escape_html(employee)}">${name}</button>` : `<span>${name}</span>`;
		}).join("")}</div>` : `<strong>${frappe.utils.escape_html(place)}</strong><p>当前账号没有可显示的员工姓名。</p>`;
		detail.querySelectorAll("[data-employee]").forEach((member) => member.addEventListener("click", () => frappe.set_route("employee-detail", member.dataset.employee)));
	}
}
