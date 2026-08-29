from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from scenery_editor.model.working_terrain import WorkingTerrain

from .common import write_json_atomic
from .reference_import import COORDINATE_SYSTEM, VegetationReference


def heightmap_metadata_document(terrain: WorkingTerrain) -> dict[str, Any]:
    minimum = terrain.minimum_elevation_m
    maximum = terrain.maximum_elevation_m

    def encode(elevation: float) -> int:
        return round(max(0.0, min(1.0, (elevation - minimum) / (maximum - minimum))) * 65535)

    return {
        "world_width_m": terrain.world_width_m,
        "world_depth_m": terrain.world_depth_m,
        "terrain_spacing_m": terrain.spacing_m,
        "terrain_cells": {
            "x": terrain.cell_count_x,
            "z": terrain.cell_count_z,
            "total": terrain.cell_count_x * terrain.cell_count_z,
        },
        "elevation_points": {
            "x": terrain.point_count_x,
            "z": terrain.point_count_z,
            "total": terrain.point_count_x * terrain.point_count_z,
        },
        "minimum_elevation_m": minimum,
        "sea_level_m": terrain.sea_level_m,
        "lowland_reference_elevation_m": terrain.lowland_reference_elevation_m,
        "maximum_elevation_m": maximum,
        "uint16_reference_values": {
            "sea_level": encode(terrain.sea_level_m),
            "lowland_reference": encode(terrain.lowland_reference_elevation_m),
        },
        "vertical_encoding": "Unsigned 16-bit greyscale: 0 maps to minimum_elevation_m and 65535 maps to maximum_elevation_m; values outside that range are clipped.",
        "grid_layout": "Rows increase along +Z; columns increase along +X.",
        "cell_diagonal": "Each cell is divided from northwest to southeast.",
    }


def export_final_heightmap(path: str | Path, terrain: WorkingTerrain) -> Path:
    destination = Path(path).resolve()
    if destination.suffix.lower() != ".png":
        destination = destination.with_suffix(".png")
    destination.parent.mkdir(parents=True, exist_ok=True)
    minimum = terrain.minimum_elevation_m
    maximum = terrain.maximum_elevation_m
    normalized = np.clip((terrain.heights.astype(np.float64) - minimum) / (maximum - minimum), 0.0, 1.0)
    encoded = np.rint(normalized * 65535.0).astype(np.uint16)

    fd, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
    os.close(fd)
    try:
        Image.fromarray(encoded).save(temporary_name, format="PNG")
        os.replace(temporary_name, destination)
    except Exception:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise
    metadata_path = destination.with_suffix(".json")
    write_json_atomic(metadata_path, heightmap_metadata_document(terrain))
    return metadata_path


def resampled_vegetation_document(
    vegetation: VegetationReference,
    terrain: WorkingTerrain,
) -> dict[str, Any]:
    objects = []
    for source in vegetation.objects:
        item = dict(source)
        item["terrain_y_m"] = terrain.height_at(item["x_m"], item["z_m"])
        objects.append(item)
    return {
        "schema_version": 1,
        "project_id": vegetation.project_id,
        "project_name": vegetation.project_name,
        "coordinate_system": COORDINATE_SYSTEM,
        "generated_object_count": len(objects),
        "objects": objects,
    }


def export_resampled_vegetation(
    path: str | Path,
    vegetation: VegetationReference,
    terrain: WorkingTerrain,
) -> None:
    write_json_atomic(path, resampled_vegetation_document(vegetation, terrain))
