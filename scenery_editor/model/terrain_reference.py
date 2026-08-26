from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .validation import ValidationError, finite_number, positive_number


@dataclass(frozen=True)
class TerrainFingerprint:
    sha256: str
    world_width_m: float
    world_depth_m: float
    spacing_m: float
    cell_count_x: int
    cell_count_z: int
    point_count_x: int
    point_count_z: int

    def to_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass(frozen=True)
class TerrainReference:
    heights: np.ndarray
    world_width_m: float
    world_depth_m: float
    spacing_m: float
    cell_count_x: int
    cell_count_z: int
    point_count_x: int
    point_count_z: int
    minimum_elevation_m: float
    sea_level_m: float
    lowland_reference_elevation_m: float
    maximum_elevation_m: float
    npy_path: Path
    descriptor_path: Path
    sha256: str

    @classmethod
    def load(cls, npy_path: str | Path, descriptor_path: str | Path) -> "TerrainReference":
        npy_path = Path(npy_path).resolve()
        descriptor_path = Path(descriptor_path).resolve()
        try:
            descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValidationError(f"cannot read terrain descriptor: {exc}") from exc
        cls._validate_descriptor(descriptor)
        try:
            heights = np.load(npy_path, allow_pickle=False)
        except (OSError, ValueError) as exc:
            raise ValidationError(f"cannot read terrain NPY: {exc}") from exc
        if heights.dtype != np.dtype("float32"):
            raise ValidationError(f"terrain NPY must be float32, got {heights.dtype}")
        point_x = descriptor["elevation_points"]["x"]
        point_z = descriptor["elevation_points"]["z"]
        if heights.shape != (point_z, point_x):
            raise ValidationError(
                f"terrain NPY shape {heights.shape} does not match descriptor (z={point_z}, x={point_x})"
            )
        if not np.isfinite(heights).all():
            raise ValidationError("terrain NPY contains non-finite elevations")
        if float(np.min(heights)) < descriptor["minimum_elevation_m"] - 1e-4 or float(np.max(heights)) > descriptor["maximum_elevation_m"] + 1e-4:
            raise ValidationError("terrain NPY elevations exceed descriptor endpoints")
        heights.setflags(write=False)
        digest = _sha256_file(npy_path)
        return cls(
            heights=heights,
            world_width_m=float(descriptor["world_width_m"]),
            world_depth_m=float(descriptor["world_depth_m"]),
            spacing_m=float(descriptor["terrain_spacing_m"]),
            cell_count_x=descriptor["terrain_cells"]["x"],
            cell_count_z=descriptor["terrain_cells"]["z"],
            point_count_x=point_x,
            point_count_z=point_z,
            minimum_elevation_m=float(descriptor["minimum_elevation_m"]),
            sea_level_m=float(descriptor["sea_level_m"]),
            lowland_reference_elevation_m=float(descriptor["lowland_reference_elevation_m"]),
            maximum_elevation_m=float(descriptor["maximum_elevation_m"]),
            npy_path=npy_path,
            descriptor_path=descriptor_path,
            sha256=digest,
        )

    @staticmethod
    def _validate_descriptor(value: Any) -> None:
        required = {
            "world_width_m", "world_depth_m", "terrain_spacing_m", "terrain_cells",
            "elevation_points", "minimum_elevation_m", "sea_level_m",
            "lowland_reference_elevation_m", "maximum_elevation_m", "uint16_reference_values",
            "vertical_encoding", "grid_layout", "cell_diagonal",
        }
        if not isinstance(value, dict) or not required.issubset(value):
            missing = sorted(required - set(value if isinstance(value, dict) else ()))
            raise ValidationError(f"terrain descriptor is missing required fields: {missing}")
        width = positive_number(value["world_width_m"], "world_width_m")
        depth = positive_number(value["world_depth_m"], "world_depth_m")
        spacing = positive_number(value["terrain_spacing_m"], "terrain_spacing_m")
        for name in ("terrain_cells", "elevation_points"):
            section = value[name]
            if not isinstance(section, dict) or set(section) != {"x", "z", "total"}:
                raise ValidationError(f"{name} must contain exactly x, z, and total")
            if any(isinstance(section[key], bool) or not isinstance(section[key], int) or section[key] <= 0 for key in section):
                raise ValidationError(f"{name} values must be positive integers")
            if section["total"] != section["x"] * section["z"]:
                raise ValidationError(f"{name}.total is inconsistent")
        cells, points = value["terrain_cells"], value["elevation_points"]
        if points["x"] != cells["x"] + 1 or points["z"] != cells["z"] + 1:
            raise ValidationError("elevation point dimensions must be cell dimensions plus one")
        if not math.isclose(width, cells["x"] * spacing, rel_tol=1e-9, abs_tol=1e-6):
            raise ValidationError("world_width_m does not equal terrain_cells.x * spacing")
        if not math.isclose(depth, cells["z"] * spacing, rel_tol=1e-9, abs_tol=1e-6):
            raise ValidationError("world_depth_m does not equal terrain_cells.z * spacing")
        minimum = finite_number(value["minimum_elevation_m"], "minimum_elevation_m")
        sea = finite_number(value["sea_level_m"], "sea_level_m")
        lowland = finite_number(value["lowland_reference_elevation_m"], "lowland_reference_elevation_m")
        maximum = finite_number(value["maximum_elevation_m"], "maximum_elevation_m")
        if not minimum <= sea <= lowland <= maximum or maximum <= minimum:
            raise ValidationError("terrain elevation references are inconsistent")
        refs = value["uint16_reference_values"]
        if not isinstance(refs, dict) or set(refs) != {"sea_level", "lowland_reference"}:
            raise ValidationError("uint16_reference_values must contain sea_level and lowland_reference")
        for key, elevation in (("sea_level", sea), ("lowland_reference", lowland)):
            encoded = refs[key]
            expected = round(max(0.0, min(1.0, (elevation - minimum) / (maximum - minimum))) * 65535)
            if isinstance(encoded, bool) or not isinstance(encoded, int) or encoded != expected:
                raise ValidationError(f"uint16_reference_values.{key} is inconsistent")
        if not isinstance(value["grid_layout"], str) or "Rows increase along +Z" not in value["grid_layout"]:
            raise ValidationError("descriptor grid_layout must declare rows increasing along +Z")
        if not isinstance(value["cell_diagonal"], str) or "northwest to southeast" not in value["cell_diagonal"].lower():
            raise ValidationError("descriptor cell_diagonal must be northwest to southeast")
        if not isinstance(value["vertical_encoding"], str) or not value["vertical_encoding"].strip():
            raise ValidationError("descriptor vertical_encoding must be present")

    @property
    def fingerprint(self) -> TerrainFingerprint:
        return TerrainFingerprint(
            sha256=self.sha256, world_width_m=self.world_width_m, world_depth_m=self.world_depth_m,
            spacing_m=self.spacing_m, cell_count_x=self.cell_count_x, cell_count_z=self.cell_count_z,
            point_count_x=self.point_count_x, point_count_z=self.point_count_z,
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
        footprint_outside_world = any(
            x < 0.0 or x > self.world_width_m or z < 0.0 or z > self.world_depth_m
            for x, z in points
        )
        inside = [(min(self.world_width_m, max(0.0, x)), min(self.world_depth_m, max(0.0, z))) for x, z in samples]
        elevations = [self.height_at(x, z) for x, z in inside]
        slopes = [self.slope_at(x, z) for x, z in inside]
        return {"origin_elevation_m": self.height_at(*origin), "minimum_elevation_m": min(elevations),
                "maximum_elevation_m": max(elevations), "elevation_range_m": max(elevations) - min(elevations),
                "maximum_slope_deg": max(slopes), "average_slope_deg": sum(slopes) / len(slopes),
                "footprint_outside_world": footprint_outside_world}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()
