from scenery_editor.model.history import CommandHistory
from scenery_editor.rendering.terrain_preview import build_terrain_preview


def test_history_undo_redo_records_one_logical_change(project):
    history = CommandHistory()
    before = project.authored_snapshot()
    original = project.places[0]
    project.places[0] = original.copy_with(name="Renamed")
    history.record("rename", before, project.authored_snapshot())
    assert history.undo(project) == "rename"
    assert project.places[0].name == original.name
    assert history.redo(project) == "rename"
    assert project.places[0].name == "Renamed"


def test_terrain_preview_does_not_mutate_read_only_heights(terrain):
    before = terrain.heights.copy()
    image = build_terrain_preview(terrain, True, True, True)
    assert image.size == (terrain.point_count_x, terrain.point_count_z)
    assert (terrain.heights == before).all()
    assert not terrain.heights.flags.writeable


def test_footprint_site_information(terrain):
    info = terrain.footprint_site_info([(2, 2), (8, 2), (8, 8), (2, 8)], (5, 5))
    assert info["maximum_elevation_m"] >= info["minimum_elevation_m"]
    assert info["elevation_range_m"] >= 0
    assert info["footprint_outside_world"] is False
