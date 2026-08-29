from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from .entities import LandUseRegion, LinearFeature, PlaceRegion, PrefabInstance, Road
from .validation import ValidationError, ensure_unique, positive_number


@dataclass(frozen=True)
class WorldSpec:
    width_m: float
    depth_m: float
    terrain_spacing_m: float

    def to_dict(self) -> dict[str, float]:
        return self.__dict__.copy()


@dataclass(frozen=True)
class SourceReferences:
    terrain_npy: str
    terrain_descriptor: str
    vegetation: str | None = None
    county_features: str | None = None
    asset_catalog: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return self.__dict__.copy()


@dataclass
class SceneryProject:
    name: str
    world: WorldSpec
    sources: SourceReferences
    terrain_fingerprint: dict[str, Any]
    places: list[PlaceRegion] = field(default_factory=list)
    land_use_regions: list[LandUseRegion] = field(default_factory=list)
    roads: list[Road] = field(default_factory=list)
    linear_features: list[LinearFeature] = field(default_factory=list)
    prefab_instances: list[PrefabInstance] = field(default_factory=list)

    def validate(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValidationError("project name must be non-empty")
        positive_number(self.world.width_m, "world.width_m")
        positive_number(self.world.depth_m, "world.depth_m")
        positive_number(self.world.terrain_spacing_m, "world.terrain_spacing_m")
        if not self.sources.terrain_npy or not self.sources.terrain_descriptor:
            raise ValidationError("terrain NPY and descriptor sources are required")
        road_ids = {road.id for road in self.roads}
        for collection in (self.places, self.land_use_regions, self.roads, self.linear_features):
            for item in collection:
                item.validate(self.world.width_m, self.world.depth_m)
        for item in self.prefab_instances:
            item.validate(self.world.width_m, self.world.depth_m, road_ids)
        ensure_unique((item.id for item in self.all_objects()), "authored object id")

    def all_objects(self):
        yield from self.places
        yield from self.land_use_regions
        yield from self.roads
        yield from self.linear_features
        yield from self.prefab_instances

    def find(self, object_id: str):
        return next((item for item in self.all_objects() if item.id == object_id), None)

    def replace_object(self, replacement) -> None:
        for name in ("places", "land_use_regions", "roads", "linear_features", "prefab_instances"):
            collection = getattr(self, name)
            for index, item in enumerate(collection):
                if item.id == replacement.id:
                    collection[index] = replacement
                    return
        raise KeyError(replacement.id)

    def remove_object(self, object_id: str):
        for name in ("places", "land_use_regions", "roads", "linear_features", "prefab_instances"):
            collection = getattr(self, name)
            for index, item in enumerate(collection):
                if item.id == object_id:
                    return collection.pop(index)
        raise KeyError(object_id)

    def authored_snapshot(self) -> dict[str, Any]:
        return copy.deepcopy({
            "places": self.places, "land_use_regions": self.land_use_regions, "roads": self.roads,
            "linear_features": self.linear_features, "prefab_instances": self.prefab_instances,
        })

    def restore_authored_snapshot(self, snapshot: dict[str, Any]) -> None:
        for name, value in snapshot.items():
            setattr(self, name, copy.deepcopy(value))
