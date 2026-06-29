from pathlib import Path


DATEUTILS = Path("apps/frappe/frappe/utils/dateutils.py")

OLD = '''def get_period(date, interval="Monthly"):
\tdate = getdate(date)
\tmonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
\treturn {
\t\t"Daily": date.strftime("%d-%m-%y"),
\t\t"Weekly": date.strftime("%d-%m-%y"),
\t\t"Monthly": str(months[date.month - 1]) + " " + str(date.year),
\t\t"Quarterly": "Quarter " + str(((date.month - 1) // 3) + 1) + " " + str(date.year),
\t\t"Yearly": str(date.year),
\t}[interval]
'''

OLD_V1 = '''def get_period(date, interval="Monthly"):
\tdate = getdate(date)
\tlanguage = getattr(frappe.local, "lang", None) or ""
\tif language.lower().startswith("zh"):
\t\tmonths = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
\t\tquarter = "第" + str(((date.month - 1) // 3) + 1) + "季度 " + str(date.year)
\telse:
\t\tmonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
\t\tquarter = "Quarter " + str(((date.month - 1) // 3) + 1) + " " + str(date.year)
\treturn {
\t\t"Daily": date.strftime("%d-%m-%y"),
\t\t"Weekly": date.strftime("%d-%m-%y"),
\t\t"Monthly": str(months[date.month - 1]) + " " + str(date.year),
\t\t"Quarterly": quarter,
\t\t"Yearly": str(date.year),
\t}[interval]
'''

OLD_V2 = '''def get_period(date, interval="Monthly"):
\tdate = getdate(date)
\tlanguage = getattr(frappe.local, "lang", None) or ""
\tif not language:
\t\ttry:
\t\t\tlanguage = frappe.db.get_single_value("System Settings", "language") or ""
\t\texcept Exception:
\t\t\tlanguage = ""
\tif language.lower().startswith("zh"):
\t\tmonths = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
\t\tquarter = "第" + str(((date.month - 1) // 3) + 1) + "季度 " + str(date.year)
\telse:
\t\tmonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
\t\tquarter = "Quarter " + str(((date.month - 1) // 3) + 1) + " " + str(date.year)
\treturn {
\t\t"Daily": date.strftime("%d-%m-%y"),
\t\t"Weekly": date.strftime("%d-%m-%y"),
\t\t"Monthly": str(months[date.month - 1]) + " " + str(date.year),
\t\t"Quarterly": quarter,
\t\t"Yearly": str(date.year),
\t}[interval]
'''

NEW = '''def get_period(date, interval="Monthly"):
\tdate = getdate(date)
\tlanguage = getattr(frappe.local, "lang", None) or ""
\ttry:
\t\tsystem_language = frappe.db.get_single_value("System Settings", "language") or ""
\texcept Exception:
\t\tsystem_language = ""
\tif (not language or language.lower() == "en") and system_language:
\t\tlanguage = system_language
\tif language.lower().startswith("zh"):
\t\tmonths = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"]
\t\tquarter = "第" + str(((date.month - 1) // 3) + 1) + "季度 " + str(date.year)
\telse:
\t\tmonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
\t\tquarter = "Quarter " + str(((date.month - 1) // 3) + 1) + " " + str(date.year)
\treturn {
\t\t"Daily": date.strftime("%d-%m-%y"),
\t\t"Weekly": date.strftime("%d-%m-%y"),
\t\t"Monthly": str(months[date.month - 1]) + " " + str(date.year),
\t\t"Quarterly": quarter,
\t\t"Yearly": str(date.year),
\t}[interval]
'''


def main():
    text = DATEUTILS.read_text()
    if OLD in text:
        DATEUTILS.write_text(text.replace(OLD, NEW))
        print("patched Frappe dateutils.get_period")
        return
    if OLD_V1 in text:
        DATEUTILS.write_text(text.replace(OLD_V1, NEW))
        print("updated Frappe dateutils.get_period")
        return
    if OLD_V2 in text:
        DATEUTILS.write_text(text.replace(OLD_V2, NEW))
        print("updated Frappe dateutils.get_period")
        return
    if 'language.lower() == "en"' in text:
        print("Frappe dateutils.get_period already patched")
        return
    raise SystemExit("Could not patch Frappe dateutils.get_period")


if __name__ == "__main__":
    main()
