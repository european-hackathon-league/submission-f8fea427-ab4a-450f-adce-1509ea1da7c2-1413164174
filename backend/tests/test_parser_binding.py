from app.db import Source
from app.ingestion import cache_identity, parser_binding


def test_pdf_cache_separates_equipment_and_strategy_families():
    bindings = [
        parser_binding(
            Source(
                filename=name,
                detected_type="pdf",
                dataset_namespace="synthetic",
                namespace_warnings=[],
            )
        )
        for name in ("equipment.pdf", "report.pdf")
    ]
    assert (
        cache_identity("workspace", "same-content", bindings[0], "1:10", "")[0]
        != cache_identity("workspace", "same-content", bindings[1], "1:10", "")[0]
    )
