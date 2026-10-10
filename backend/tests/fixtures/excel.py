from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook

FEEDBACK_HEADERS = [
    "ID",
    "Source",
    "Brand",
    "Sales Description",
    "Country",
    "Derivate (e-code)",
    "Engine Type",
    "Feedback Type",
    "Customer Feedback",
    "Vfc level2 3 Name",
    "Vfc level2 Name",
    "Vfc level3 Name",
]


def workbook(sheets):
    book = Workbook()
    book.remove(book.active)
    for name, rows in sheets.items():
        sheet = book.create_sheet(name)
        for row in rows:
            sheet.append(row)
    buffer = BytesIO()
    book.save(buffer)
    book.close()
    return buffer.getvalue()


def feedback_row(
    record_id="1", source="survey", country="Germany", text="Synthetic comfort"
):
    return [
        record_id,
        source,
        "Synthetic",
        None,
        country,
        "G60",
        "unknown-code",
        None,
        text,
        None,
        "comfort",
        None,
    ]


def worksheet_xml(data, transform):
    output = BytesIO()
    with (
        ZipFile(BytesIO(data)) as original,
        ZipFile(output, "w", ZIP_DEFLATED) as changed,
    ):
        for item in original.infolist():
            content = original.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                content = transform(content.decode()).encode()
            changed.writestr(item.filename, content)
    return output.getvalue()
