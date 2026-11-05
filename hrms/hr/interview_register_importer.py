"""Read the original two-row interview register without evaluating formulas."""
from datetime import date, datetime
from io import BytesIO


COLUMNS = [
    ("registration_month", "月份"), ("source_sequence", "序号"), ("candidate_name", "姓名"),
    ("native_place", "籍贯"), ("source", "信息渠道"), ("phone", "联系电话"),
    ("gender", "性别"), ("education", "学历"), ("marital_status", "婚姻状况"), ("age", "年龄"),
    ("interview_date", "面试时间"), ("interview_position", "面试岗位"), ("referrer", "介绍人"),
    ("interviewer", "面试官"), ("hired", "录用与否"), ("assigned_department", "分配部门"),
    ("assigned_position", "分配岗位"), ("rejection_reason", "未录用原因或其他"),
    ("expected_start_date", "预计人员上班时间"), ("arrival_status", "是否报到"), ("no_show_reason", "未报到原因"),
]


def text(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


# Suggestions are offered for review, never applied without an explicit edit.
ALIASES = {
    "education": {"专科": "大专", "大学专科": "大专", "大学本科": "本科"},
    "gender": {"男性": "男", "女性": "女"},
}
DEFAULT_OPTIONS = {
    "gender": ["", "男", "女"], "marital_status": ["", "未婚", "已婚", "离异", "丧偶"],
    "hired": ["", "是", "否"], "arrival_status": ["", "待报到", "已报到", "未报到"],
}


def parse_workbook(content, corrections=None, select_options=None):
    from openpyxl import load_workbook
    from openpyxl.utils.datetime import from_excel

    book = load_workbook(BytesIO(content), read_only=True, data_only=False)
    try:
        sheet = book["面试人员清单"] if "面试人员清单" in book.sheetnames else book.active
        if sheet.max_row > 10010 or sheet.max_column > 100:
            raise ValueError("表格超出限制，请每次导入不超过 10000 条记录。")
        rows = list(sheet.iter_rows(values_only=True))
        mapping, header = {}, None
        for index, row in enumerate(rows[:10]):
            labels = {text(value): col for col, value in enumerate(row) if text(value)}
            if all(label in labels for label in ("姓名", "面试时间", "面试岗位")):
                header = index
                lower = rows[index + 1] if index + 1 < len(rows) else ()
                for key, label in COLUMNS:
                    if label in labels:
                        mapping[key] = labels[label]
                    elif label in [text(v) for v in lower]:
                        mapping[key] = [text(v) for v in lower].index(label)
                break
        if header is None or len(mapping) != len(COLUMNS):
            raise ValueError("未识别完整表头，请使用面试人员清单原表（含人员基本信息第二层表头）。")
        options = {**DEFAULT_OPTIONS, **(select_options or {})}
        edits = {}
        if not isinstance(corrections or [], list):
            raise ValueError("修正内容格式不正确。")
        for edit in corrections or []:
            if (not isinstance(edit, dict) or type(edit.get("row")) is not int
                    or edit.get("field") not in dict(COLUMNS)
                    or not isinstance(edit.get("value"), (str, int, float, type(None)))):
                raise ValueError("修正内容包含无效的行号、字段或值。")
            key = (edit["row"], edit["field"])
            if key in edits:
                raise ValueError("同一单元格不能重复修正。")
            edits[key] = edit["value"]
        result, errors, source_rows, applied = [], [], set(), []
        edits_by_row = {}
        for (row_number, key), value in edits.items():
            edits_by_row.setdefault(row_number, {})[key] = value
        for index, row in enumerate(rows[header + 2:], start=header + 3):
            values = {key: row[col] if col < len(row) else None for key, col in mapping.items()}
            if not any(text(v) for v in values.values()):
                continue
            source_rows.add(index)
            for key, value in edits_by_row.get(index, {}).items():
                applied.append({"row": index, "field": key, "label": dict(COLUMNS)[key],
                                "original": text(values[key]), "value": text(value)})
                values[key] = value
            record = {key: text(value) for key, value in values.items()}
            row_errors = []
            for key, label in COLUMNS:
                try:
                    value = values[key]
                    if text(value).startswith("="):
                        raise ValueError("包含公式，请填写实际值。")
                    if key in ("candidate_name", "phone", "interview_date", "interview_position") and not text(value):
                        raise ValueError("不能为空。")
                    if key in ("interview_date", "expected_start_date"):
                        if not text(value):
                            record[key] = None
                            continue
                        if isinstance(value, (int, float)):
                            value = from_excel(value, book.epoch)
                        if isinstance(value, datetime):
                            value = value.date()
                        if not isinstance(value, date):
                            value = date.fromisoformat(text(value).replace("/", "-").split(" ")[0])
                        record[key] = value.isoformat()
                    if key == "age":
                        age = float(text(value)) if text(value) else None
                        if age is not None and (not age.is_integer() or not 0 <= age <= 120):
                            raise ValueError("应为 0 至 120 的整数。")
                        record[key] = int(age) if age is not None else None
                    if key == "arrival_status":
                        record[key] = {"是": "已报到", "否": "未报到"}.get(record[key], record[key])
                    if key in options and record[key] not in options[key]:
                        raise ValueError("请选择：" + "、".join(v or "空白" for v in options[key]))
                except (ValueError, TypeError, OverflowError) as exc:
                    message = str(exc) if key not in ("interview_date", "expected_start_date", "age") else (
                        "请填写有效日期（YYYY-MM-DD）。" if key != "age" else "应为 0 至 120 的整数。")
                    suggestion = ALIASES.get(key, {}).get(text(values[key]))
                    row_errors.append({"row": index, "field": key, "label": label,
                                       "value": text(values[key]), "candidate_name": text(values["candidate_name"]),
                                       "message": label + "：" + message, "options": options.get(key),
                                       "suggestion": suggestion if suggestion in options.get(key, []) else None})
            if row_errors:
                errors.extend(row_errors)
            else:
                record["source_month"] = record["registration_month"]
                record["registration_month"] = record["interview_date"][:7]
                result.append({"row": index, "values": record})
        if any(row_number not in source_rows for row_number, _ in edits):
            raise ValueError("修正行号不属于原表数据。")
        if not result and not errors:
            errors.append({"row": 0, "message": "表格没有可导入记录。"})
        return {"rows": result, "errors": errors, "total": len(source_rows), "corrections": applied}
    finally:
        book.close()
