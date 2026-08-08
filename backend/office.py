from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path


EXCEL_SUFFIXES = {".xlsx", ".xlsm"}
WORD_SUFFIXES = {".docx"}


def resolve_office_file(raw_path: str) -> Path:
    path = Path(raw_path).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"文件不存在：{path}")
    if path.suffix.lower() not in EXCEL_SUFFIXES | WORD_SUFFIXES:
        raise ValueError("仅支持 XLSX、XLSM 和 DOCX 文件")
    return path


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 10_000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise ValueError(f"无法为 {path.name} 生成不重复的文件名")


def _output_path(source: Path, raw_output_dir: str, label: str) -> Path:
    output_dir = Path(raw_output_dir).expanduser().resolve() if raw_output_dir.strip() else (
        source.parent / "OmniBox 输出" / f"{datetime.now():%Y%m%d-%H%M%S}-Office"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    return _unique_path(output_dir / f"{source.stem}-{label}{source.suffix}")


def office_context(source: Path) -> dict:
    suffix = source.suffix.lower()
    if suffix in EXCEL_SUFFIXES:
        from openpyxl import load_workbook

        workbook = load_workbook(source, read_only=True, data_only=False, keep_vba=suffix == ".xlsm")
        try:
            sheets = []
            for sheet in workbook.worksheets[:12]:
                max_row, max_column = sheet.max_row, sheet.max_column
                if max_row is None or max_column is None:
                    from openpyxl.utils.cell import range_boundaries

                    _, _, calculated_column, calculated_row = range_boundaries(sheet.calculate_dimension(force=True))
                    max_row, max_column = calculated_row, calculated_column
                rows = []
                for row in sheet.iter_rows(min_row=1, max_row=min(max_row, 8), max_col=min(max_column, 12), values_only=True):
                    rows.append([str(value)[:160] if value is not None else "" for value in row])
                sheets.append({
                    "name": sheet.title,
                    "rows": max_row,
                    "columns": max_column,
                    "sample": rows,
                })
            return {"type": "excel", "file": source.name, "sheets": sheets}
        finally:
            workbook.close()

    from docx import Document

    document = Document(source)
    paragraphs = [paragraph.text.strip()[:240] for paragraph in document.paragraphs if paragraph.text.strip()][:40]
    tables = [{"rows": len(table.rows), "columns": len(table.columns)} for table in document.tables[:20]]
    return {
        "type": "word",
        "file": source.name,
        "paragraph_count": len(document.paragraphs),
        "sample_paragraphs": paragraphs,
        "tables": tables,
    }


def parse_plan(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回有效的 JSON 操作计划")
    plan = json.loads(text[start:end + 1])
    operations = plan.get("operations")
    if not isinstance(operations, list) or not operations:
        raise ValueError("操作计划为空")
    if len(operations) > 20:
        raise ValueError("单次最多执行 20 个 Office 操作")
    return plan


def _selected_sheets(workbook, raw_name: str):
    name = str(raw_name or "*").strip()
    if name == "*":
        return list(workbook.worksheets)
    if name not in workbook.sheetnames:
        raise ValueError(f"工作表不存在：{name}")
    return [workbook[name]]


def _excel_trim_text(sheet) -> int:
    from openpyxl.cell.cell import MergedCell

    changed = 0
    for row in sheet.iter_rows():
        for cell in row:
            if isinstance(cell, MergedCell) or not isinstance(cell.value, str) or cell.value.startswith("="):
                continue
            cleaned = cell.value.strip()
            if cleaned != cell.value:
                cell.value = cleaned
                changed += 1
    return changed


def _excel_remove_blank_rows(sheet, start_row: int = 2) -> int:
    removed = 0
    for row_index in range(sheet.max_row, max(1, start_row) - 1, -1):
        if all(cell.value is None or (isinstance(cell.value, str) and not cell.value.strip()) for cell in sheet[row_index]):
            sheet.delete_rows(row_index)
            removed += 1
    return removed


def _excel_deduplicate(sheet, columns: list | None = None, start_row: int = 2) -> int:
    from openpyxl.utils.cell import column_index_from_string

    if columns:
        indexes = []
        for value in columns:
            if isinstance(value, int):
                indexes.append(value)
            elif re.fullmatch(r"[A-Za-z]{1,3}", str(value).strip()):
                indexes.append(column_index_from_string(str(value).strip().upper()))
            else:
                raise ValueError(f"无效的去重列：{value}")
    else:
        indexes = list(range(1, sheet.max_column + 1))
    if any(index < 1 or index > sheet.max_column for index in indexes):
        raise ValueError(f"去重列超出工作表 {sheet.title} 的范围")

    seen = set()
    duplicates = []
    for row_index in range(max(1, start_row), sheet.max_row + 1):
        key = tuple(sheet.cell(row_index, index).value for index in indexes)
        if key in seen:
            duplicates.append(row_index)
        else:
            seen.add(key)
    for row_index in reversed(duplicates):
        sheet.delete_rows(row_index)
    return len(duplicates)


def _excel_fill_formula(sheet, target_range: str, formula: str) -> int:
    from openpyxl.formula.translate import Translator
    from openpyxl.utils.cell import range_boundaries

    if not formula.startswith("=") or len(formula) > 2_000:
        raise ValueError("公式必须以 = 开头且不超过 2000 字符")
    if "[" in formula or re.search(r"\b(?:WEBSERVICE|RTD|DDE|HYPERLINK)\s*\(", formula, re.IGNORECASE):
        raise ValueError("不允许写入外部工作簿引用或联网公式")
    min_col, min_row, max_col, max_row = range_boundaries(target_range)
    if min_col != max_col or min_row < 1 or max_row - min_row > 100_000:
        raise ValueError("公式目标必须是单列且不超过 100001 行")
    origin = sheet.cell(min_row, min_col)
    for row_index in range(min_row, max_row + 1):
        cell = sheet.cell(row_index, min_col)
        cell.value = Translator(formula, origin=origin.coordinate).translate_formula(cell.coordinate)
    return max_row - min_row + 1


def _apply_excel_operations(workbook, operations: list[dict]) -> list[str]:
    reports = []
    allowed = {"trim_text", "remove_blank_rows", "deduplicate_rows", "fill_formula"}
    for operation in operations:
        operation_type = str(operation.get("type", ""))
        if operation_type not in allowed:
            raise ValueError(f"不支持的 Excel 操作：{operation_type}")
        sheets = _selected_sheets(workbook, operation.get("sheet", "*"))
        for sheet in sheets:
            if operation_type == "trim_text":
                count = _excel_trim_text(sheet)
                reports.append(f"{sheet.title}：清理 {count} 个文本单元格")
            elif operation_type == "remove_blank_rows":
                count = _excel_remove_blank_rows(sheet, int(operation.get("start_row", 2)))
                reports.append(f"{sheet.title}：删除 {count} 个空白行")
            elif operation_type == "deduplicate_rows":
                count = _excel_deduplicate(sheet, operation.get("columns"), int(operation.get("start_row", 2)))
                reports.append(f"{sheet.title}：删除 {count} 个重复行")
            else:
                count = _excel_fill_formula(sheet, str(operation.get("target_range", "")), str(operation.get("formula", "")))
                reports.append(f"{sheet.title}：写入 {count} 个公式")
    return reports


def _paragraph_has_visual(paragraph) -> bool:
    return bool(paragraph._p.xpath(".//w:drawing | .//w:object | .//w:pict | .//w:sectPr"))


def _trim_paragraph_runs(paragraph) -> int:
    nonempty = [run for run in paragraph.runs if run.text]
    if not nonempty:
        return 0
    before = "".join(run.text for run in nonempty)
    nonempty[0].text = nonempty[0].text.lstrip()
    nonempty[-1].text = nonempty[-1].text.rstrip()
    return int(before != "".join(run.text for run in nonempty))


def _remove_manual_page_breaks(document) -> int:
    removed = 0
    for paragraph in list(document.paragraphs):
        page_breaks = list(paragraph._p.xpath(".//w:br[@w:type='page']"))
        for line_break in page_breaks:
            line_break.getparent().remove(line_break)
            removed += 1
        if page_breaks and not paragraph.text.strip() and not _paragraph_has_visual(paragraph) and not paragraph._p.xpath(".//w:br"):
            paragraph._element.getparent().remove(paragraph._element)
    return removed


def _remove_empty_paragraphs(document) -> int:
    removed = 0
    for paragraph in list(document.paragraphs):
        if not paragraph.text.strip() and not _paragraph_has_visual(paragraph) and not paragraph._p.xpath(".//w:br"):
            paragraph._element.getparent().remove(paragraph._element)
            removed += 1
    return removed


def _remove_empty_table_rows(document) -> int:
    removed = 0
    for table in document.tables:
        for row in list(table.rows):
            if all(not cell.text.strip() for cell in row.cells):
                table._tbl.remove(row._tr)
                removed += 1
    return removed


def _replace_text(document, old: str, new: str) -> int:
    if not old:
        raise ValueError("替换文本不能为空")
    replaced = 0
    paragraphs = list(document.paragraphs)
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    for paragraph in paragraphs:
        for run in paragraph.runs:
            count = run.text.count(old)
            if count:
                run.text = run.text.replace(old, new)
                replaced += count
    return replaced


def _apply_word_operations(document, operations: list[dict]) -> list[str]:
    reports = []
    allowed = {"trim_whitespace", "remove_empty_paragraphs", "remove_manual_page_breaks", "remove_empty_table_rows", "replace_text"}
    for operation in operations:
        operation_type = str(operation.get("type", ""))
        if operation_type not in allowed:
            raise ValueError(f"不支持的 Word 操作：{operation_type}")
        if operation_type == "trim_whitespace":
            paragraphs = list(document.paragraphs)
            for table in document.tables:
                for row in table.rows:
                    for cell in row.cells:
                        paragraphs.extend(cell.paragraphs)
            count = sum(_trim_paragraph_runs(paragraph) for paragraph in paragraphs)
            reports.append(f"清理 {count} 个段落首尾空白")
        elif operation_type == "remove_empty_paragraphs":
            reports.append(f"删除 {_remove_empty_paragraphs(document)} 个空段落")
        elif operation_type == "remove_manual_page_breaks":
            reports.append(f"删除 {_remove_manual_page_breaks(document)} 个人工分页符")
        elif operation_type == "remove_empty_table_rows":
            reports.append(f"删除 {_remove_empty_table_rows(document)} 个空表格行")
        else:
            count = _replace_text(document, str(operation.get("old", "")), str(operation.get("new", "")))
            reports.append(f"完成 {count} 处文本替换")
    return reports


def clean_office(source: Path, output_dir: str, kind: str, options: dict) -> dict:
    if kind == "excel_clean":
        if source.suffix.lower() not in EXCEL_SUFFIXES:
            raise ValueError("Excel 清理仅支持 XLSX/XLSM 文件")
        operations = []
        if options.get("trim_text", True):
            operations.append({"type": "trim_text", "sheet": "*"})
        if options.get("remove_blank_rows", True):
            operations.append({"type": "remove_blank_rows", "sheet": "*", "start_row": 2})
        if options.get("deduplicate_rows", False):
            operations.append({"type": "deduplicate_rows", "sheet": "*", "start_row": 2})
        return execute_office_plan(source, output_dir, {"summary": "Excel 本地清理", "operations": operations})

    if source.suffix.lower() not in WORD_SUFFIXES:
        raise ValueError("Word 清理仅支持 DOCX 文件")
    operations = []
    if options.get("trim_whitespace", True):
        operations.append({"type": "trim_whitespace"})
    if options.get("remove_empty_paragraphs", True):
        operations.append({"type": "remove_empty_paragraphs"})
    if options.get("remove_manual_page_breaks", True):
        operations.append({"type": "remove_manual_page_breaks"})
    if options.get("remove_empty_table_rows", False):
        operations.append({"type": "remove_empty_table_rows"})
    return execute_office_plan(source, output_dir, {"summary": "Word 本地清理", "operations": operations})


def execute_office_plan(source: Path, output_dir: str, plan: dict) -> dict:
    operations = plan.get("operations") or []
    if not operations:
        raise ValueError("没有可执行的操作")
    suffix = source.suffix.lower()
    output = _output_path(source, output_dir, "已处理")
    if suffix in EXCEL_SUFFIXES:
        from openpyxl import load_workbook

        workbook = load_workbook(source, keep_vba=suffix == ".xlsm")
        try:
            reports = _apply_excel_operations(workbook, operations)
            workbook.save(output)
        finally:
            workbook.close()
    elif suffix in WORD_SUFFIXES:
        from docx import Document

        document = Document(source)
        reports = _apply_word_operations(document, operations)
        document.save(output)
    else:
        raise ValueError("仅支持 XLSX、XLSM 和 DOCX 文件")
    return {
        "result": plan.get("summary") or f"已执行 {len(operations)} 个操作",
        "output": str(output),
        "operations": reports,
        "source_preserved": True,
    }
