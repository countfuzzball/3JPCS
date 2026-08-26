from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from typing import Any, ClassVar

from .validation import (
    ValidationError,
    finite_number,
    non_negative_number,
    non_empty_string,
    point_list,
    positive_number,
    require_exact_keys,
    uuid_string,
)


def new_id() -> str:
    return str(uuid.uuid4())


@dataclass(frozen=True)
class TerrainPad:
    """Engine-agnostic terrain preparation attached to one prefab instance."""

    enabled: bool = False
    width_m: float = 12.0
    depth_m: float = 12.0
    blend_m: float = 8.0
    target_mode: str = "base_terrain_at_origin"

    def validate(self, context: str = "terrain_pad") -> None:
        if not isinstance(self.enabled, bool):
            raise ValidationError(f"{context}.enabled must be a boolean")
        positive_number(self.width_m, f"{context}.width_m")
        positive_number(self.depth_m, f"{context}.depth_m")
        non_negative_number(self.blend_m, f"{context}.blend_m")
        if self.target_mode != "base_terrain_at_origin":
            raise ValidationError(f"{context}.target_mode is unsupported")

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "width_m": self.width_m,
            "depth_m": self.depth_m,
            "blend_m": self.blend_m,
            "target_mode": self.target_mode,
        }

    @classmethod
    def from_dict(cls, value: Any, context: str = "terrain_pad") -> "TerrainPad":
        if not isinstance(value, dict):
            raise ValidationError(f"{context} must be an object")
        require_exact_keys(
            value,
            {"enabled", "width_m", "depth_m", "blend_m", "target_mode"},
            context,
        )
        result = cls(
            enabled=value["enabled"],
            width_m=positive_number(value["width_m"], f"{context}.width_m"),
            depth_m=positive_number(value["depth_m"], f"{context}.depth_m"),
            blend_m=non_negative_number(value["blend_m"], f"{context}.blend_m"),
            target_mode=value["target_mode"],
        )
        result.validate(context)
        return result


@dataclass(frozen=True)
class AuthoredObject:
    name: str
    id: str = field(default_factory=new_id)
    visible: bool = True
    locked: bool = False

    def validate_common(self) -> None:
        uuid_string(self.id, "id")
        non_empty_string(self.name, "name")
        if not isinstance(self.visible, bool) or not isinstance(self.locked, bool):
            raise ValidationError("visible and locked must be booleans")

    def copy_with(self, **changes: Any):
        return replace(self, **changes)


@dataclass(frozen=True)
class PlaceRegion(AuthoredObject):
    place_type: str = "town"
    points: tuple[tuple[float, float], ...] = ()
    TYPES: ClassVar[set[str]] = {"town", "village", "farm", "military_area"}

    def validate(self, width: float, depth: float) -> None:
        self.validate_common()
        if self.place_type not in self.TYPES:
            raise ValidationError(f"unsupported place_type: {self.place_type}")
        point_list(list(self.points), 3, width, depth, "place points")

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "place_type": self.place_type,
                "points": [list(p) for p in self.points], "visible": self.visible, "locked": self.locked}

    @classmethod
    def from_dict(cls, value: dict[str, Any], width: float, depth: float) -> "PlaceRegion":
        require_exact_keys(value, {"id", "name", "place_type", "points", "visible", "locked"}, "place")
        result = cls(id=uuid_string(value["id"], "place.id"), name=non_empty_string(value["name"], "place.name"),
                     place_type=value["place_type"], points=tuple(point_list(value["points"], 3, width, depth, "place.points")),
                     visible=value["visible"], locked=value["locked"])
        result.validate(width, depth)
        return result


@dataclass(frozen=True)
class LandUseRegion(AuthoredObject):
    land_use_type: str = "pasture"
    points: tuple[tuple[float, float], ...] = ()
    TYPES: ClassVar[set[str]] = {"pasture", "rough_grazing", "woodland"}

    def validate(self, width: float, depth: float) -> None:
        self.validate_common()
        if self.land_use_type not in self.TYPES:
            raise ValidationError(f"unsupported land_use_type: {self.land_use_type}")
        point_list(list(self.points), 3, width, depth, "land-use points")

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "land_use_type": self.land_use_type,
                "points": [list(p) for p in self.points], "visible": self.visible, "locked": self.locked}

    @classmethod
    def from_dict(cls, value: dict[str, Any], width: float, depth: float) -> "LandUseRegion":
        require_exact_keys(value, {"id", "name", "land_use_type", "points", "visible", "locked"}, "land_use_region")
        result = cls(id=uuid_string(value["id"], "land_use.id"), name=non_empty_string(value["name"], "land_use.name"),
                     land_use_type=value["land_use_type"], points=tuple(point_list(value["points"], 3, width, depth, "land_use.points")),
                     visible=value["visible"], locked=value["locked"])
        result.validate(width, depth)
        return result


@dataclass(frozen=True)
class Road(AuthoredObject):
    points: tuple[tuple[float, float], ...] = ()
    width_m: float = 7.5
    road_class: str = "local_road"
    surface: str = "gravel"
    CLASSES: ClassVar[set[str]] = {"county_road", "local_road", "lane", "farm_track", "military_road"}
    SURFACES: ClassVar[set[str]] = {"paved", "gravel", "dirt"}

    def validate(self, width: float, depth: float) -> None:
        self.validate_common()
        point_list(list(self.points), 2, width, depth, "road points")
        positive_number(self.width_m, "road.width_m")
        if self.road_class not in self.CLASSES or self.surface not in self.SURFACES:
            raise ValidationError("unsupported road class or surface")

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "points": [list(p) for p in self.points],
                "width_m": self.width_m, "road_class": self.road_class, "surface": self.surface,
                "visible": self.visible, "locked": self.locked}

    @classmethod
    def from_dict(cls, value: dict[str, Any], width: float, depth: float) -> "Road":
        require_exact_keys(value, {"id", "name", "points", "width_m", "road_class", "surface", "visible", "locked"}, "road")
        result = cls(id=uuid_string(value["id"], "road.id"), name=non_empty_string(value["name"], "road.name"),
                     points=tuple(point_list(value["points"], 2, width, depth, "road.points")),
                     width_m=positive_number(value["width_m"], "road.width_m"), road_class=value["road_class"],
                     surface=value["surface"], visible=value["visible"], locked=value["locked"])
        result.validate(width, depth)
        return result


@dataclass(frozen=True)
class LinearFeature(AuthoredObject):
    feature_type: str = "hedgerow"
    points: tuple[tuple[float, float], ...] = ()
    nominal_width_m: float = 2.0
    nominal_height_m: float = 2.0

    def validate(self, width: float, depth: float) -> None:
        self.validate_common()
        if self.feature_type != "hedgerow":
            raise ValidationError(f"unsupported linear feature: {self.feature_type}")
        point_list(list(self.points), 2, width, depth, "linear-feature points")
        positive_number(self.nominal_width_m, "linear_feature.nominal_width_m")
        positive_number(self.nominal_height_m, "linear_feature.nominal_height_m")

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "feature_type": self.feature_type,
                "points": [list(p) for p in self.points], "nominal_width_m": self.nominal_width_m,
                "nominal_height_m": self.nominal_height_m, "visible": self.visible, "locked": self.locked}

    @classmethod
    def from_dict(cls, value: dict[str, Any], width: float, depth: float) -> "LinearFeature":
        require_exact_keys(value, {"id", "name", "feature_type", "points", "nominal_width_m", "nominal_height_m", "visible", "locked"}, "linear_feature")
        result = cls(id=uuid_string(value["id"], "linear_feature.id"), name=non_empty_string(value["name"], "linear_feature.name"),
                     feature_type=value["feature_type"], points=tuple(point_list(value["points"], 2, width, depth, "linear_feature.points")),
                     nominal_width_m=positive_number(value["nominal_width_m"], "linear_feature.nominal_width_m"),
                     nominal_height_m=positive_number(value["nominal_height_m"], "linear_feature.nominal_height_m"),
                     visible=value["visible"], locked=value["locked"])
        result.validate(width, depth)
        return result


@dataclass(frozen=True)
class PrefabInstance(AuthoredObject):
    category: str = "miscellaneous"
    asset_id: str = "missing"
    x_m: float = 0.0
    z_m: float = 0.0
    rotation_deg: float = 0.0
    scale: float = 1.0
    frontage_road_id: str | None = None
    terrain_pad: TerrainPad = field(default_factory=TerrainPad)

    def validate(self, width: float, depth: float, road_ids: set[str] | None = None) -> None:
        self.validate_common()
        non_empty_string(self.category, "prefab.category")
        non_empty_string(self.asset_id, "prefab.asset_id")
        x = finite_number(self.x_m, "prefab.x_m")
        z = finite_number(self.z_m, "prefab.z_m")
        finite_number(self.rotation_deg, "prefab.rotation_deg")
        positive_number(self.scale, "prefab.scale")
        self.terrain_pad.validate("prefab.terrain_pad")
        if not 0.0 <= x <= width or not 0.0 <= z <= depth:
            raise ValidationError("prefab origin is outside the terrain world")
        if self.frontage_road_id is not None:
            uuid_string(self.frontage_road_id, "prefab.frontage_road_id")
            if road_ids is not None and self.frontage_road_id not in road_ids:
                raise ValidationError("prefab frontage_road_id does not resolve")

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "category": self.category, "asset_id": self.asset_id,
                "x_m": self.x_m, "z_m": self.z_m, "rotation_deg": self.rotation_deg,
                "scale": self.scale, "frontage_road_id": self.frontage_road_id,
                "terrain_pad": self.terrain_pad.to_dict(),
                "visible": self.visible, "locked": self.locked}

    @classmethod
    def from_dict(
        cls,
        value: dict[str, Any],
        width: float,
        depth: float,
        road_ids: set[str],
        *,
        schema_version: int = 3,
    ) -> "PrefabInstance":
        keys = {"id", "name", "category", "asset_id", "x_m", "z_m", "rotation_deg", "scale", "frontage_road_id", "visible", "locked"}
        if schema_version >= 2:
            keys.add("terrain_pad")
        require_exact_keys(value, keys, "prefab_instance")
        result = cls(id=uuid_string(value["id"], "prefab.id"), name=non_empty_string(value["name"], "prefab.name"),
                     category=non_empty_string(value["category"], "prefab.category"), asset_id=non_empty_string(value["asset_id"], "prefab.asset_id"),
                     x_m=finite_number(value["x_m"], "prefab.x_m"), z_m=finite_number(value["z_m"], "prefab.z_m"),
                     rotation_deg=finite_number(value["rotation_deg"], "prefab.rotation_deg"), scale=positive_number(value["scale"], "prefab.scale"),
                     frontage_road_id=None if value["frontage_road_id"] is None else uuid_string(value["frontage_road_id"], "prefab.frontage_road_id"),
                     terrain_pad=TerrainPad() if schema_version == 1 else TerrainPad.from_dict(value["terrain_pad"], "prefab.terrain_pad"),
                     visible=value["visible"], locked=value["locked"])
        result.validate(width, depth, road_ids)
        return result
