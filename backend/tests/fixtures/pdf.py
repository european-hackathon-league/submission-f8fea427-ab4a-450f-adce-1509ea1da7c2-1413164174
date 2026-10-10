"""Synthetic Docling export: never copied from supplied customer documents."""


def equipment_document():
    def cell(row, col, text, header=False, end_col=None):
        return {
            "start_row_offset_idx": row,
            "end_row_offset_idx": row + 1,
            "start_col_offset_idx": col,
            "end_col_offset_idx": end_col or col + 1,
            "text": text,
            "column_header": header,
            "bbox": {
                "l": col * 50,
                "t": row * 20,
                "r": col * 50 + 45,
                "b": row * 20 + 15,
                "coord_origin": "TOPLEFT",
            },
        }

    return {
        "pages": {"1": {"size": {"width": 600, "height": 800}}},
        "texts": [
            {
                "label": "section_header",
                "text": "Ausstattung Deutschland Juli 2026 G60",
                "prov": [
                    {
                        "page_no": 1,
                        "bbox": {
                            "l": 0,
                            "t": 790,
                            "r": 500,
                            "b": 760,
                            "coord_origin": "BOTTOMLEFT",
                        },
                    }
                ],
            },
            {
                "label": "text",
                "text": "● Serienausstattung; ○ Sonderausstattung; – nicht verfügbar",
                "prov": [
                    {
                        "page_no": 1,
                        "bbox": {
                            "l": 0,
                            "t": 700,
                            "r": 500,
                            "b": 680,
                            "coord_origin": "BOTTOMLEFT",
                        },
                    }
                ],
            },
            {
                "label": "footnote",
                "text": "1) Nur in Verbindung mit Paket 9AA",
                "prov": [
                    {
                        "page_no": 1,
                        "bbox": {
                            "l": 0,
                            "t": 100,
                            "r": 500,
                            "b": 80,
                            "coord_origin": "BOTTOMLEFT",
                        },
                    }
                ],
            },
        ],
        "tables": [
            {
                "prov": [
                    {
                        "page_no": 1,
                        "bbox": {
                            "l": 0,
                            "t": 600,
                            "r": 500,
                            "b": 300,
                            "coord_origin": "BOTTOMLEFT",
                        },
                    }
                ],
                "data": {
                    "num_rows": 3,
                    "num_cols": 4,
                    "table_cells": [
                        cell(0, 0, "Code", True),
                        cell(0, 1, "Ausstattung", True),
                        cell(0, 2, "520i", True),
                        cell(0, 3, "530e", True),
                        cell(1, 0, "4ZZ"),
                        cell(1, 1, "Sitzkomfort 1)"),
                        cell(1, 2, "●"),
                        cell(1, 3, "○"),
                        cell(2, 0, "6XX"),
                        cell(2, 1, "Anzeige"),
                        cell(2, 2, "?", end_col=4),
                    ],
                },
            }
        ],
    }
