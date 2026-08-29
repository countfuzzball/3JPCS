from __future__ import annotations

import json
from pathlib import Path

from scenery_editor.model.asset_catalog import AssetCatalog


REFERENCE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = REFERENCE_ROOT.parent


def test_checked_in_schemas_are_json_and_declare_expected_versions():
    for name, version in (("scenery_project.schema.json", 3), ("asset_catalog.schema.json", 3), ("runtime_scenery.schema.json", 2)):
        document = json.loads((REFERENCE_ROOT / "schemas" / name).read_text(encoding="utf-8"))
        assert document["properties"]["schema_version"]["const"] == version


def test_example_catalog_is_minimal_and_loadable():
    document = json.loads((REPOSITORY_ROOT / "examples" / "asset_catalog.json").read_text(encoding="utf-8"))
    catalog = AssetCatalog.from_document(document)
    assert catalog.assets
    assert set(next(iter(document["assets"].values()))) == {"category", "resource"}
