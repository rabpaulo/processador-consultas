"""Catálogo BD_Vendas e dados fictícios compartilhados pela aplicação."""

import json
from pathlib import Path

_catalog = json.loads((Path(__file__).resolve().parent.parent / "data" / "catalog.json").read_text(encoding="utf-8"))
SCHEMA = _catalog["schema"]
SAMPLE_DATA = _catalog["sampleData"]
EXAMPLES = _catalog["examples"]


def metadata():
    """A interface recebe o catálogo, contagens e exemplos do backend."""
    return {
        "schema": SCHEMA,
        "sampleCounts": {table: len(rows) for table, rows in SAMPLE_DATA.items()},
        "examples": EXAMPLES,
        "backend": "Python",
    }
