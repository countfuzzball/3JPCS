import json

import numpy as np
import pytest

from scenery_editor.model.terrain_reference import TerrainReference
from scenery_editor.model.validation import ValidationError


def test_npy_descriptor_compatibility(terrain_files):
    terrain = TerrainReference.load(terrain_files[0], terrain_files[1])
    assert terrain.heights.shape == (3, 3)
    assert terrain.heights.dtype == np.float32
    assert not terrain.heights.flags.writeable


def test_rejects_wrong_npy_shape(terrain_files):
    np.save(terrain_files[0], np.zeros((2, 3), dtype=np.float32))
    with pytest.raises(ValidationError, match="shape"):
        TerrainReference.load(terrain_files[0], terrain_files[1])


def test_rejects_non_float32(terrain_files):
    np.save(terrain_files[0], np.zeros((3, 3), dtype=np.float64))
    with pytest.raises(ValidationError, match="float32"):
        TerrainReference.load(terrain_files[0], terrain_files[1])


def test_triangle_interpolation_uses_nw_se_diagonal(terrain):
    assert terrain.height_at(8.0, 2.0) == pytest.approx(14.0)
    assert terrain.height_at(2.0, 8.0) == pytest.approx(20.0)


def test_terrain_edge_and_corner_sampling(terrain):
    assert terrain.height_at(0, 0) == 0
    assert terrain.height_at(20, 0) == 20
    assert terrain.height_at(0, 20) == 50
    assert terrain.height_at(20, 20) == 90


def test_slope_sampling_is_triangle_consistent(terrain):
    upper = terrain.slope_at(8.0, 2.0)
    lower = terrain.slope_at(2.0, 8.0)
    assert upper == pytest.approx(np.degrees(np.arctan(np.hypot(1.0, 3.0))))
    assert lower == pytest.approx(np.degrees(np.arctan(np.hypot(2.0, 2.0))))


def test_out_of_bounds_terrain_query_rejected(terrain):
    with pytest.raises(ValidationError, match="outside"):
        terrain.height_at(-0.01, 2)


def test_descriptor_arithmetic_is_validated(terrain_files):
    document = json.loads(terrain_files[1].read_text())
    document["world_width_m"] = 21.0
    terrain_files[1].write_text(json.dumps(document))
    with pytest.raises(ValidationError, match="world_width"):
        TerrainReference.load(terrain_files[0], terrain_files[1])
