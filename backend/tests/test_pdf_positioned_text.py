from pathlib import Path

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


def write_pdf(
    path: Path, content: bytes, *, page_number: int = 1, rotation: int = 0
) -> None:
    writer = PdfWriter()
    for _ in range(page_number):
        page = writer.add_blank_page(width=300, height=400)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject(
                {NameObject("/F1"): writer._add_object(font)}
            ),
        }
    )
    stream = DecodedStreamObject()
    stream.set_data(content)
    page[NameObject("/Contents")] = writer._add_object(stream)
    if rotation:
        page.rotate(rotation)
    writer.write(path)


def test_original_page_numbers_and_transformed_top_left_baselines(tmp_path):
    from app.pdf_worker import positioned_pdf_text

    path = tmp_path / "positions.pdf"
    write_pdf(
        path,
        b"q 1 0 0 1 10 20 cm BT /F1 12 Tf 1 0 0 1 30 60 Tm (Parking) Tj ET Q "
        b"q 2 0 0 2 10 20 cm BT /F1 12 Tf 1 0 0 1 30 60 Tm (Travel) Tj ET Q",
        page_number=18,
    )
    assert positioned_pdf_text(path, [18]) == {
        18: [
            {"x": 40.0, "y": 320.0, "text": "Parking"},
            {"x": 70.0, "y": 260.0, "text": "Travel"},
        ],
    }


@pytest.mark.parametrize(
    "matrix,rotation,uncertain_count",
    [(b"0 1 -1 0 30 60", 0, 1), (b"1 0.2 0 1 30 60", 0, 1), (b"1 0 0 1 30 60", 90, 0)],
)
def test_uncertain_fragments_are_flagged_without_trusted_positions(
    tmp_path, matrix, rotation, uncertain_count
):
    from app.pdf_worker import positioned_pdf_text

    path = tmp_path / "uncertain.pdf"
    write_pdf(
        path, b"BT /F1 12 Tf " + matrix + b" Tm (Uncertain) Tj ET", rotation=rotation
    )
    fragments = positioned_pdf_text(path, [1])[1]
    assert len(fragments) == uncertain_count
    assert all(fragment.get("uncertain") is True for fragment in fragments)


def test_out_of_page_text_does_not_leave_trusted_partial_page(tmp_path):
    from app.pdf_worker import positioned_pdf_text

    path = tmp_path / "outside.pdf"
    write_pdf(
        path,
        b"BT /F1 12 Tf 1 0 0 1 30 60 Tm (Valid) Tj ET "
        b"BT /F1 12 Tf 1 0 0 1 400 60 Tm (Outside) Tj ET",
    )
    assert positioned_pdf_text(path, [1]) == {1: []}
