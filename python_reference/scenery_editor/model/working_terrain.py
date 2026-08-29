from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .entities import PrefabInstance
from .terrain_reference import TerrainFingerprint, TerrainReference
from .validation import ValidationError, finite_number


@dataclass(frozen=True)
class WorkingTerrain:
    """A derived float32 surface. The imported TerrainReference remains immutable."""

    base: TerrainReference
    heights: np.ndarray
    sha256: str

    @classmethod
    def compose(cls, base: TerrainReference, prefabs: list[PrefabInstance]) -> "WorkingTerrain":
        heights = np.array(base.heights, dtype=np.float32, copy=True, order="C")
        for prefab in prefabs:
            if prefab.visible and prefab.terrain_pad.enabled:
                _apply_pad(heights, base, prefab)
        np.clip(heights, base.minimum_elevation_m, base.maximum_elevation_m, out=heights)
        heights.setflags(write=False)
        digest = hashlib.sha256(heights.tobytes(order="C")).hexdigest()
        return cls(base=base, heights=heights, sha256=digest)

    @property
    def world_width_m(self) -> float:
        return self.base.world_width_m

    @property
    def world_depth_m(self) -> float:
        return self.base.world_depth_m

    @property
    def spacing_m(self) -> float:
        return self.base.spacing_m

    @property
    def cell_count_x(self) -> int:
        return self.base.cell_count_x

    @property
    def cell_count_z(self) -> int:
        return self.base.cell_count_z

    @property
    def point_count_x(self) -> int:
        return self.base.point_count_x

    @property
    def point_count_z(self) -> int:
        return self.base.point_count_z

    @property
    def minimum_elevation_m(self) -> float:
        return self.base.minimum_elevation_m

    @property
    def sea_level_m(self) -> float:
        return self.base.sea_level_m

    @property
    def lowland_reference_elevation_m(self) -> float:
        return self.base.lowland_reference_elevation_m

    @property
    def maximum_elevation_m(self) -> float:
        return self.base.maximum_elevation_m

    @property
    def npy_path(self) -> Path:
        return self.base.npy_path

    @property
    def descriptor_path(self) -> Path:
        return self.base.descriptor_path

    @property
    def fingerprint(self) -> TerrainFingerprint:
        return TerrainFingerprint(
            sha256=self.sha256,
            world_width_m=self.world_width_m,
            world_depth_m=self.world_depth_m,
            spacing_m=self.spacing_m,
            cell_count_x=self.cell_count_x,
            cell_count_z=self.cell_count_z,
            point_count_x=self.point_count_x,
            point_count_z=self.point_count_z,
        )

    def _cell(self, x_m: float, z_m: float) -> tuple[int, int, float, float]:
        x = finite_number(x_m, "x_m")
        z = finite_number(z_m, "z_m")
        if not 0.0 <= x <= self.world_width_m or not 0.0 <= z <= self.world_depth_m:
            raise ValidationError("terrain query is outside the world")
        grid_x, grid_z = x / self.spacing_m, z / self.spacing_m
        cell_x = min(math.floor(grid_x), self.cell_count_x - 1)
        cell_z = min(math.floor(grid_z), self.cell_count_z - 1)
        return cell_x, cell_z, grid_x - cell_x, grid_z - cell_z

    def height_at(self, x_m: float, z_m: float) -> float:
        cell_x, cell_z, local_x, local_z = self._cell(x_m, z_m)
        nw = float(self.heights[cell_z, cell_x])
        ne = float(self.heights[cell_z, cell_x + 1])
        sw = float(self.heights[cell_z + 1, cell_x])
        se = float(self.heights[cell_z + 1, cell_x + 1])
        if local_z <= local_x:
            return nw + local_x * (ne - nw) + local_z * (se - ne)
        return nw + local_z * (sw - nw) + local_x * (se - sw)

    def slope_at(self, x_m: float, z_m: float) -> float:
        cell_x, cell_z, local_x, local_z = self._cell(x_m, z_m)
        nw = float(self.heights[cell_z, cell_x])
        ne = float(self.heights[cell_z, cell_x + 1])
        sw = float(self.heights[cell_z + 1, cell_x])
        se = float(self.heights[cell_z + 1, cell_x + 1])
        if local_z <= local_x:
            dh_dx, dh_dz = (ne - nw) / self.spacing_m, (se - ne) / self.spacing_m
        else:
            dh_dx, dh_dz = (se - sw) / self.spacing_m, (sw - nw) / self.spacing_m
        return math.degrees(math.atan(math.hypot(dh_dx, dh_dz)))

    def footprint_site_info(self, points: list[tuple[float, float]], origin: tuple[float, float]) -> dict[str, float | bool]:
        samples = list(points)
        samples.extend(
            (
                (points[i][0] + points[(i + 1) % len(points)][0]) / 2.0,
                (points[i][1] + points[(i + 1) % len(points)][1]) / 2.0,
            )
            for i in range(len(points))
        )
        samples.append(origin)
        outside = any(
            x < 0.0 or x > self.world_width_m or z < 0.0 or z > self.world_depth_m
            for x, z in points
        )
        inside = [
            (min(self.world_width_m, max(0.0, x)), min(self.world_depth_m, max(0.0, z)))
            for x, z in samples
        ]
        elevations = [self.height_at(x, z) for x, z in inside]
        slopes = [self.slope_at(x, z) for x, z in inside]
        return {
            "origin_elevation_m": self.height_at(*origin),
            "minimum_elevation_m": min(elevations),
            "maximum_elevation_m": max(elevations),
            "elevation_range_m": max(elevations) - min(elevations),
            "maximum_slope_deg": max(slopes),
            "average_slope_deg": sum(slopes) / len(slopes),
            "footprint_outside_world": outside,
        }


def _apply_pad(heights: np.ndarray, base: TerrainReference, prefab: PrefabInstance) -> None:
    pad = prefab.terrain_pad
    angle = math.radians(prefab.rotation_deg)
    cosine, sine = math.cos(angle), math.sin(angle)

    # Expand the core by the projection of half a cell. This cell-aware rule
    # ensures a pad smaller than a coarse grid cell still changes that cell.
    cell_projection = base.spacing_m * 0.5 * (abs(cosine) + abs(sine))
    half_width = pad.width_m * 0.5 + cell_projection
    half_depth = pad.depth_m * 0.5 + cell_projection
    bound_x = abs(cosine) * half_width + abs(sine) * half_depth + pad.blend_m
    bound_z = abs(sine) * half_width + abs(cosine) * half_depth + pad.blend_m

    x0 = max(0, math.floor((prefab.x_m - bound_x) / base.spacing_m))
    x1 = min(base.point_count_x - 1, math.ceil((prefab.x_m + bound_x) / base.spacing_m))
    z0 = max(0, math.floor((prefab.z_m - bound_z) / base.spacing_m))
    z1 = min(base.point_count_z - 1, math.ceil((prefab.z_m + bound_z) / base.spacing_m))
    if x0 > x1 or z0 > z1:
        return

    xs = np.arange(x0, x1 + 1, dtype=np.float64) * base.spacing_m - prefab.x_m
    zs = np.arange(z0, z1 + 1, dtype=np.float64) * base.spacing_m - prefab.z_m
    dx, dz = np.meshgrid(xs, zs)
    local_x = cosine * dx + sine * dz
    local_z = -sine * dx + cosine * dz
    outside_x = np.maximum(np.abs(local_x) - half_width, 0.0)
    outside_z = np.maximum(np.abs(local_z) - half_depth, 0.0)
    distance = np.hypot(outside_x, outside_z)

    if pad.blend_m == 0.0:
        weight = (distance == 0.0).astype(np.float32)
    else:
        t = np.clip(1.0 - distance / pad.blend_m, 0.0, 1.0)
        weight = (t * t * (3.0 - 2.0 * t)).astype(np.float32)
    target = np.float32(base.height_at(prefab.x_m, prefab.z_m))
    region = heights[z0:z1 + 1, x0:x1 + 1]
    region += weight * (target - region)
