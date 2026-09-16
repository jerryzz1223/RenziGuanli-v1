"""Match explicit profile abbreviations against the field's allowed values."""

from datetime import date


def calculate_employee_age(date_of_birth, today):
	"""Completed years; missing, invalid and future birth dates have no age."""
	try:
		birth = date.fromisoformat(str(date_of_birth))
		on_date = date.fromisoformat(str(today))
	except (TypeError, ValueError):
		return None
	if birth > on_date:
		return None
	return on_date.year - birth.year - ((on_date.month, on_date.day) < (birth.month, birth.day))


PROFILE_FIELDS = ("custom_ethnicity", "custom_native_place")
NATIVE_PLACE_ALIASES = {
	"内蒙古": "内蒙古自治区",
	"广西": "广西壮族自治区",
	"西藏": "西藏自治区",
	"宁夏": "宁夏回族自治区",
	"新疆": "新疆维吾尔自治区",
	"香港": "香港特别行政区",
	"澳门": "澳门特别行政区",
}

# The Employee field stores the province-level value so the personnel map and
# reports have one aggregation key.  Import sources, however, often contain a
# prefecture-level or county-level city (for example ``常熟市``).  Keep the
# mapping local and deterministic: no external geocoding service is needed at
# import time, and no city name is written to the province selector.
#
# Names are intentionally written without administrative suffixes.  The
# normaliser accepts both ``常熟`` and ``常熟市`` (and likewise for 自治州、地区、盟).
NATIVE_PLACE_CITY_GROUPS = {
	"北京市": "北京",
	"天津市": "天津",
	"河北省": "石家庄 唐山 秦皇岛 邯郸 邢台 保定 张家口 承德 沧州 廊坊 衡水 定州 辛集",
	"山西省": "太原 大同 阳泉 长治 晋城 朔州 晋中 运城 忻州 临汾 吕梁",
	"内蒙古自治区": "呼和浩特 包头 乌海 赤峰 通辽 鄂尔多斯 呼伦贝尔 巴彦淖尔 乌兰察布 兴安 锡林郭勒 阿拉善",
	"辽宁省": "沈阳 大连 鞍山 抚顺 本溪 丹东 锦州 营口 阜新 辽阳 盘锦 铁岭 朝阳 葫芦岛",
	"吉林省": "长春 吉林 四平 辽源 通化 白山 松原 白城 延边",
	"黑龙江省": "哈尔滨 齐齐哈尔 鸡西 鹤岗 双鸭山 大庆 伊春 佳木斯 七台河 牡丹江 黑河 绥化 大兴安岭",
	"上海市": "上海",
	"江苏省": "南京 无锡 徐州 常州 苏州 南通 连云港 淮安 盐城 扬州 镇江 泰州 宿迁 常熟 昆山 张家港 太仓 江阴 宜兴 丹阳 东台 靖江 泰兴 如皋 海安 高邮 仪征 兴化",
	"浙江省": "杭州 宁波 温州 嘉兴 湖州 绍兴 金华 衢州 舟山 台州 丽水 义乌 慈溪 余姚 乐清 瑞安 海宁 桐乡 兰溪 东阳 永康 江山",
	"安徽省": "合肥 芜湖 蚌埠 淮南 马鞍山 淮北 铜陵 安庆 黄山 滁州 阜阳 宿州 六安 亳州 池州 宣城 巢湖 广德 宁国 桐城 潜山 天长 明光 界首",
	"福建省": "福州 厦门 莆田 三明 泉州 漳州 南平 龙岩 宁德 福清 长乐 永安 石狮 晋江 南安 龙海 邵武 武夷山 建瓯 福安 福鼎",
	"江西省": "南昌 景德镇 萍乡 九江 新余 鹰潭 赣州 吉安 宜春 抚州 上饶 瑞金 共青城 乐平 瑞昌 贵溪 丰城 樟树 高安 井冈山 井冈山市",
	"山东省": "济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽 莱州 荣成 青州 诸城 寿光 安丘 高密 曲阜 邹城 新泰 肥城 文登 乳山 昌邑 龙口 招远 栖霞 滕州",
	"河南省": "郑州 开封 洛阳 平顶山 安阳 鹤壁 新乡 焦作 濮阳 许昌 漯河 三门峡 南阳 商丘 信阳 周口 驻马店 济源 巩义 新郑 新密 登封 荥阳 中牟 偃师 汝州 舞钢 林州 卫辉 辉县 沁阳 孟州 禹州 长葛 义马 灵宝 邓州 永城 项城 淮阳 鹿邑",
	"湖北省": "武汉 黄石 十堰 宜昌 襄阳 鄂州 荆门 孝感 荆州 黄冈 咸宁 随州 恩施 仙桃 潜江 天门 神农架 大冶 利川 枣阳 宜城 老河口 钟祥 应城 安陆 汉川 麻城 武穴 赤壁 广水 松滋 石首 洪湖 监利",
	"湖南省": "长沙 株洲 湘潭 衡阳 邵阳 岳阳 常德 张家界 益阳 郴州 永州 怀化 娄底 湘西 浏阳 醴陵 湘乡 韶山 耒阳 常宁 武冈 邵东 岳阳楼 汨罗 临湘 津市 安乡 沅江 资兴 洪江 冷水江 涟源 吉首",
	"广东省": "广州 韶关 深圳 珠海 汕头 佛山 江门 湛江 茂名 肇庆 惠州 梅州 汕尾 河源 阳江 清远 东莞 中山 潮州 揭阳 云浮 廉江 雷州 吴川 高州 化州 信宜 四会 罗定 恩平 台山 开平 鹤山 新会 连州 英德 乐昌 南雄 兴宁 梅县 普宁 陆丰 阳春",
	"广西壮族自治区": "南宁 柳州 桂林 梧州 北海 防城港 钦州 贵港 玉林 百色 贺州 河池 来宾 崇左 岑溪 东兴 凭祥 合山 北流 容县 靖西 平果 宜州 桂平",
	"海南省": "海口 三亚 三沙 儋州 五指山 文昌 琼海 万宁 东方 定安 屯昌 澄迈 临高 白沙 昌江 乐东 陵水 保亭 琼中",
	"重庆市": "重庆",
	"四川省": "成都 自贡 攀枝花 泸州 德阳 绵阳 广元 遂宁 内江 乐山 南充 眉山 宜宾 广安 达州 雅安 巴中 资阳 阿坝 甘孜 凉山 都江堰 彭州 邛崃 崇州 广汉 什邡 绵竹 江油 阆中 华蓥 万源 简阳 西昌 康定 马尔康",
	"贵州省": "贵阳 六盘水 遵义 安顺 毕节 铜仁 黔西南 黔东南 黔南 清镇 赤水 仁怀 盘州 兴义 凯里 都匀 福泉 兴仁",
	"云南省": "昆明 曲靖 玉溪 保山 昭通 丽江 普洱 临沧 楚雄 红河 文山 西双版纳 大理 德宏 怒江 迪庆 安宁 宣威 腾冲 水富 瑞丽 芒市 楚雄市 大理市 个旧 开远 蒙自 建水 景洪 香格里拉",
	"西藏自治区": "拉萨 日喀则 昌都 林芝 山南 那曲 阿里",
	"陕西省": "西安 铜川 宝鸡 咸阳 渭南 延安 汉中 榆林 安康 商洛 韩城 华阴 兴平 彬州 神木 府谷",
	"甘肃省": "兰州 嘉峪关 金昌 白银 天水 武威 张掖 平凉 酒泉 庆阳 定西 陇南 临夏 甘南 玉门 敦煌 临洮 合作",
	"青海省": "西宁 海东 海北 黄南 果洛 玉树 海西 格尔木 德令哈 茫崖",
	"宁夏回族自治区": "银川 石嘴山 吴忠 固原 中卫 灵武 青铜峡",
	"新疆维吾尔自治区": "乌鲁木齐 克拉玛依 吐鲁番 哈密 昌吉 博尔塔拉 巴音郭楞 阿克苏 克孜勒苏 喀什 和田 伊犁 塔城 阿勒泰 石河子 阿拉尔 图木舒克 五家渠 北屯 铁门关 双河 可克达拉 昆玉 胡杨河 乌苏 博乐 库尔勒 阿克苏市 喀什市 和田市 伊宁市 奎屯 塔城市 阿勒泰市",
	"台湾省": "台北 新北 桃园 台中 台南 高雄 基隆 新竹 嘉义 宜兰 新竹县 苗栗 彰化 南投 云林 嘉义县 屏东 花莲 台东 澎湖",
}
NATIVE_PLACE_CITY_TO_PROVINCE = {
	city: province
	for province, cities in NATIVE_PLACE_CITY_GROUPS.items()
	for city in cities.split()
}
NATIVE_PLACE_CITY_SUFFIXES = ("特别行政区", "自治州", "地区", "盟", "市")


def _native_place_city_key(value):
	"""Return a city key while preserving names such as ``城市`` correctly."""
	text = str(value or "").strip()
	for suffix in NATIVE_PLACE_CITY_SUFFIXES:
		if text.endswith(suffix):
			return text[: -len(suffix)]
	return text


def normalise_profile_value(fieldname, value, options):
	"""Only expand unambiguous names; leave unknown values for Select validation."""
	if fieldname not in PROFILE_FIELDS or value is None:
		return value
	text = str(value).strip()
	if isinstance(options, str):
		options = options.splitlines()
	allowed = {str(option).strip() for option in (options or ()) if str(option).strip()}
	if not text or text in allowed:
		return text
	if fieldname == "custom_ethnicity":
		candidates = {text + "族"}
	else:
		city_province = NATIVE_PLACE_CITY_TO_PROVINCE.get(_native_place_city_key(text))
		candidates = {text + "省", text + "市", NATIVE_PLACE_ALIASES.get(text), city_province}
	matches = candidates & allowed
	return matches.pop() if len(matches) == 1 else text


def normalise_employee_profile(employee):
	for fieldname in PROFILE_FIELDS:
		field = employee.meta.get_field(fieldname)
		if field and field.fieldtype == "Select":
			employee.set(fieldname, normalise_profile_value(fieldname, employee.get(fieldname), field.options))
