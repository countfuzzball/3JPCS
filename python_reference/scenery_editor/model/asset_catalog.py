from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

from .validation import ValidationError, non_empty_string, positive_number, require_exact_keys

ASSET_CATALOG_FORMAT = "polygon-county-asset-catalog"
ASSET_CATALOG_SCHEMA_VERSION = 3


@dataclass(frozen=True)
class CategoryProxy:
    width_m: float
    depth_m: float
    wall_height_m: float


@dataclass(frozen=True)
class AssetDefinition:
    asset_id: str
    category: str
    resource: str

    @property
    def display_name(self) -> str:
        return self.asset_id.replace("_", " ").strip().title()


@dataclass(frozen=True)
class AssetCatalog:
    category_defaults: Mapping[str, CategoryProxy]
    assets: tuple[AssetDefinition, ...]

    @property
    def by_asset_id(self) -> dict[str, AssetDefinition]:
        return {asset.asset_id: asset for asset in self.assets}

    def proxy_for_category(self, category: str) -> CategoryProxy | None:
        return self.category_defaults.get(category)

    @classmethod
    def from_document(cls, document: Any) -> "AssetCatalog":
        if not isinstance(document, dict):
            raise ValidationError("asset catalogue must be an object")
        require_exact_keys(document, {"format", "schema_version", "category_defaults", "assets"}, "asset catalogue")
        if document["format"] != ASSET_CATALOG_FORMAT:
            raise ValidationError(f"asset catalogue format must be {ASSET_CATALOG_FORMAT!r}")
        if document["schema_version"] != ASSET_CATALOG_SCHEMA_VERSION:
            raise ValidationError(
                f"asset catalogue schema_version must be {ASSET_CATALOG_SCHEMA_VERSION}; "
                "legacy prefab catalogues are not runtime-compatible"
            )
        if not isinstance(document["category_defaults"], dict):
            raise ValidationError("category_defaults must be an object")
        if not isinstance(document["assets"], dict):
            raise ValidationError("assets must be an object")
        defaults: dict[str, CategoryProxy] = {}
        for category, value in document["category_defaults"].items():
            category_name = non_empty_string(category, "category default key")
            if not isinstance(value, dict):
                raise ValidationError(f"category_defaults.{category_name} must be an object")
            require_exact_keys(value, {"proxy"}, f"category_defaults.{category_name}")
            proxy = value["proxy"]
            if not isinstance(proxy, dict):
                raise ValidationError(f"category_defaults.{category_name}.proxy must be an object")
            require_exact_keys(proxy, {"width_m", "depth_m", "wall_height_m"}, f"category_defaults.{category_name}.proxy")
            defaults[category_name] = CategoryProxy(
                width_m=positive_number(proxy["width_m"], f"category_defaults.{category_name}.proxy.width_m"),
                depth_m=positive_number(proxy["depth_m"], f"category_defaults.{category_name}.proxy.depth_m"),
                wall_height_m=positive_number(proxy["wall_height_m"], f"category_defaults.{category_name}.proxy.wall_height_m"),
            )
        assets: list[AssetDefinition] = []
        for asset_id, value in document["assets"].items():
            identifier = non_empty_string(asset_id, "asset ID")
            if not isinstance(value, dict):
                raise ValidationError(f"assets.{identifier} must be an object")
            require_exact_keys(value, {"category", "resource"}, f"assets.{identifier}")
            assets.append(AssetDefinition(
                asset_id=identifier,
                category=non_empty_string(value["category"], f"assets.{identifier}.category"),
                resource=non_empty_string(value["resource"], f"assets.{identifier}.resource"),
            ))
        return cls(MappingProxyType(defaults), tuple(assets))

    def to_document(self) -> dict[str, Any]:
        return {
            "format": ASSET_CATALOG_FORMAT,
            "schema_version": ASSET_CATALOG_SCHEMA_VERSION,
            "category_defaults": {
                category: {"proxy": {
                    "width_m": proxy.width_m,
                    "depth_m": proxy.depth_m,
                    "wall_height_m": proxy.wall_height_m,
                }} for category, proxy in self.category_defaults.items()
            },
            "assets": {
                asset.asset_id: {"category": asset.category, "resource": asset.resource}
                for asset in self.assets
            },
        }
