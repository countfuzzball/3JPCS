from __future__ import annotations

import math
import tkinter as tk
from typing import Any

from PIL import Image, ImageTk

from scenery_editor.model.entities import LandUseRegion, LinearFeature, PlaceRegion, PrefabInstance, Road
from scenery_editor.model.geometry import (
    distance_to_polyline,
    distance_to_segment,
    point_in_polygon,
    prefab_footprint,
    prefab_front_marker,
)
from scenery_editor.model.asset_catalog import AssetCatalog, AssetDefinition
from scenery_editor.model.project import SceneryProject
from scenery_editor.model.terrain_reference import TerrainReference
from scenery_editor.model.working_terrain import WorkingTerrain
from scenery_editor.project_io.reference_import import CountyReference, VegetationReference
from scenery_editor.rendering.terrain_preview import build_terrain_preview


class TerrainCanvas(tk.Canvas):
    def __init__(self, master):
        super().__init__(master, background="#22272b", highlightthickness=0, cursor="crosshair")
        self.terrain: TerrainReference | WorkingTerrain | None = None
        self.preview: Image.Image | None = None
        self._tk_preview: ImageTk.PhotoImage | None = None
        self.scale = 1.0
        self.offset_x = 20.0
        self.offset_y = 20.0
        self._pan_anchor: tuple[float, float, float, float] | None = None

    def set_terrain(self, terrain: TerrainReference | WorkingTerrain | None, *, preserve_view: bool = False) -> None:
        had_terrain = self.terrain is not None
        self.terrain = terrain
        self.preview = None
        if terrain and not (preserve_view and had_terrain):
            self.after_idle(self.fit_terrain)
        else:
            self.delete("all")

    def fit_terrain(self) -> None:
        if not self.terrain:
            return
        self.update_idletasks()
        width = max(100, self.winfo_width())
        height = max(100, self.winfo_height())
        margin = 28.0
        self.scale = min((width - 2 * margin) / self.terrain.world_width_m,
                         (height - 2 * margin) / self.terrain.world_depth_m)
        self.offset_x = (width - self.terrain.world_width_m * self.scale) / 2.0
        self.offset_y = (height - self.terrain.world_depth_m * self.scale) / 2.0

    def world_to_canvas(self, x_m: float, z_m: float) -> tuple[float, float]:
        return self.offset_x + x_m * self.scale, self.offset_y + z_m * self.scale

    def canvas_to_world(self, x_px: float, y_px: float) -> tuple[float, float]:
        return (x_px - self.offset_x) / self.scale, (y_px - self.offset_y) / self.scale

    def in_world(self, point: tuple[float, float]) -> bool:
        return bool(self.terrain and 0.0 <= point[0] <= self.terrain.world_width_m and 0.0 <= point[1] <= self.terrain.world_depth_m)

    def clamp_world(self, point: tuple[float, float]) -> tuple[float, float]:
        if not self.terrain:
            return point
        return max(0.0, min(self.terrain.world_width_m, point[0])), max(0.0, min(self.terrain.world_depth_m, point[1]))

    def zoom_at(self, x_px: float, y_px: float, factor: float) -> None:
        if not self.terrain:
            return
        world = self.canvas_to_world(x_px, y_px)
        fit_scale = min(max(100, self.winfo_width()) / self.terrain.world_width_m,
                        max(100, self.winfo_height()) / self.terrain.world_depth_m)
        self.scale = max(fit_scale * 0.25, min(fit_scale * 40.0, self.scale * factor))
        self.offset_x = x_px - world[0] * self.scale
        self.offset_y = y_px - world[1] * self.scale

    def begin_pan(self, x_px: float, y_px: float) -> None:
        self._pan_anchor = (x_px, y_px, self.offset_x, self.offset_y)

    def pan_to(self, x_px: float, y_px: float) -> None:
        if self._pan_anchor:
            ax, ay, ox, oy = self._pan_anchor
            self.offset_x, self.offset_y = ox + x_px - ax, oy + y_px - ay

    def end_pan(self) -> None:
        self._pan_anchor = None

    def redraw(self, project: SceneryProject | None, vegetation: VegetationReference | None,
               county: CountyReference | None, asset_catalog: AssetCatalog | None,
               layers: dict[str, bool], selected_id: str | None, selected_vertex: int | None,
               draft: list[tuple[float, float]], draft_hover: tuple[float, float] | None,
               ghost: tuple[float, float, AssetDefinition] | None) -> None:
        self.delete("all")
        if not self.terrain:
            self.create_text(self.winfo_width() / 2, self.winfo_height() / 2,
                             text="File → New Scenery Project to load a terrain reference",
                             fill="#d9dee3", font=("Segoe UI", 13))
            return
        self._draw_background(layers)
        x0, y0 = self.world_to_canvas(0.0, 0.0)
        x1, y1 = self.world_to_canvas(self.terrain.world_width_m, self.terrain.world_depth_m)
        self.create_rectangle(x0, y0, x1, y1, outline="#bac1c8", width=1)
        if county:
            self._draw_county(county, layers)
        if vegetation and layers.get("vegetation", True):
            self._draw_vegetation(vegetation)
        if project:
            self._draw_native(project, asset_catalog, layers, selected_id, selected_vertex)
        self._draw_draft(draft, draft_hover)
        if ghost:
            width, depth = _catalogue_proxy_size(asset_catalog, ghost[2].category, 1.0)
            self._draw_prefab_shape(ghost[0], ghost[1], width, depth, 0.0,
                                    "#f4d35e", "", dash=(5, 3))

    def _draw_background(self, layers: dict[str, bool]) -> None:
        assert self.terrain is not None
        key = (layers.get("terrain", True), layers.get("hillshade", True), layers.get("contours", True))
        if self.preview is None or getattr(self, "_preview_key", None) != key:
            self.preview = build_terrain_preview(self.terrain, *key)
            self._preview_key = key
        canvas_w, canvas_h = self.winfo_width(), self.winfo_height()
        world_left, world_top = self.world_to_canvas(0.0, 0.0)
        world_right, world_bottom = self.world_to_canvas(self.terrain.world_width_m, self.terrain.world_depth_m)
        left, top = max(0.0, world_left), max(0.0, world_top)
        right, bottom = min(float(canvas_w), world_right), min(float(canvas_h), world_bottom)
        if right <= left or bottom <= top:
            return
        source_w, source_h = self.preview.size
        crop = (
            (left - world_left) / (world_right - world_left) * (source_w - 1),
            (top - world_top) / (world_bottom - world_top) * (source_h - 1),
            (right - world_left) / (world_right - world_left) * (source_w - 1) + 1,
            (bottom - world_top) / (world_bottom - world_top) * (source_h - 1) + 1,
        )
        image = self.preview.crop(crop).resize((max(1, round(right - left)), max(1, round(bottom - top))), Image.Resampling.BILINEAR)
        self._tk_preview = ImageTk.PhotoImage(image)
        self.create_image(left, top, image=self._tk_preview, anchor="nw")

    def _draw_county(self, county: CountyReference, layers: dict[str, bool]) -> None:
        if layers.get("county_settlements", True):
            for item in county.settlement_regions:
                if item["visible"]:
                    coords = self._flat(item["points"])
                    self.create_polygon(*coords, outline="#d9a7ff", fill="", width=2, dash=(6, 4))
        if layers.get("county_roads", True):
            for item in county.roads:
                if item["visible"]:
                    self.create_line(*self._flat(item["points"]), fill="#d7c0a1",
                                     width=max(2, min(12, item["width_m"] * self.scale)), dash=(6, 3))
        if layers.get("county_buildings", True):
            for item in county.buildings:
                if item["visible"]:
                    self._draw_prefab_shape(item["x_m"], item["z_m"], item["footprint_width_m"],
                                            item["footprint_depth_m"], item["rotation_deg"], "#dfa2a2", "", dash=(3, 2))

    def _draw_vegetation(self, vegetation: VegetationReference) -> None:
        count = len(vegetation.objects)
        step = max(1, math.ceil(count / 5000))
        colors = {"forest_tree": "#175f35", "scattered_tree": "#62a846", "shrub": "#9bbd57"}
        radii = {"forest_tree": 2.2, "scattered_tree": 2.8, "shrub": 1.5}
        for item in vegetation.objects[::step]:
            x, y = self.world_to_canvas(item["x_m"], item["z_m"])
            radius = radii[item["type"]]
            self.create_oval(x - radius, y - radius, x + radius, y + radius,
                             fill=colors[item["type"]], outline="")

    def _draw_native(self, project: SceneryProject, asset_catalog: AssetCatalog | None,
                     layers: dict[str, bool], selected_id: str | None, selected_vertex: int | None) -> None:
        if layers.get("places", True):
            colors = {"town": "#f5c04a", "village": "#f8d57d", "farm": "#d7a950", "military_area": "#e57b63"}
            for item in project.places:
                if item.visible:
                    self._draw_region(item, colors[item.place_type], selected_id, selected_vertex)
        if layers.get("land_use", True):
            colors = {"pasture": "#78be72", "rough_grazing": "#9cae68", "woodland": "#46875a"}
            for item in project.land_use_regions:
                if item.visible:
                    self._draw_region(item, colors[item.land_use_type], selected_id, selected_vertex)
        if layers.get("roads", True):
            for item in project.roads:
                if item.visible:
                    selected = item.id == selected_id
                    self.create_line(*self._flat(item.points), fill="#fff1ce" if selected else "#9a7254",
                                     width=max(2, min(14, item.width_m * self.scale)), capstyle="round", joinstyle="round")
                    if selected:
                        self._draw_handles(item.points, selected_vertex)
        if layers.get("hedgerows", True):
            for item in project.linear_features:
                if item.visible:
                    selected = item.id == selected_id
                    self.create_line(*self._flat(item.points), fill="#d9ff8a" if selected else "#346b3b",
                                     width=max(2, min(8, item.nominal_width_m * self.scale)), dash=(7, 3))
                    if selected:
                        self._draw_handles(item.points, selected_vertex)
        definitions = asset_catalog.by_asset_id if asset_catalog else {}
        for item in project.prefab_instances:
            if item.visible and item.terrain_pad.enabled and (
                layers.get("terrain_pads", True) or item.id == selected_id
            ):
                self._draw_terrain_pad(item, item.id == selected_id)
        if layers.get("prefabs", True):
            for item in project.prefab_instances:
                if item.visible:
                    definition = definitions.get(item.asset_id)
                    width, depth = _catalogue_proxy_size(asset_catalog, item.category, item.scale)
                    color = "#f2e5b8" if item.id == selected_id else ("#e79962" if definition else "#ff4d68")
                    self._draw_prefab_shape(item.x_m, item.z_m, width, depth, item.rotation_deg,
                                            color, item.name if self.scale * max(width, depth) > 14 else "")

    def _draw_terrain_pad(self, item: PrefabInstance, selected: bool) -> None:
        pad = item.terrain_pad
        color = "#6ee7ff" if selected else "#3aa9bd"
        if pad.blend_m > 0.0:
            outer = prefab_footprint(
                item.x_m,
                item.z_m,
                pad.width_m + 2.0 * pad.blend_m,
                pad.depth_m + 2.0 * pad.blend_m,
                item.rotation_deg,
            )
            self.create_polygon(*self._flat(outer), fill="", outline=color, width=1, dash=(3, 4))
        core = prefab_footprint(item.x_m, item.z_m, pad.width_m, pad.depth_m, item.rotation_deg)
        self.create_polygon(*self._flat(core), fill="", outline=color, width=2, dash=(7, 3))

    def _draw_region(self, item: PlaceRegion | LandUseRegion, color: str,
                     selected_id: str | None, selected_vertex: int | None) -> None:
        selected = item.id == selected_id
        self.create_polygon(*self._flat(item.points), fill=color, stipple="gray25",
                            outline="#ffffff" if selected else color, width=3 if selected else 2)
        if selected:
            self._draw_handles(item.points, selected_vertex)

    def _draw_handles(self, points, selected_vertex: int | None) -> None:
        for index, point in enumerate(points):
            x, y = self.world_to_canvas(*point)
            radius = 5 if index == selected_vertex else 4
            self.create_rectangle(x - radius, y - radius, x + radius, y + radius,
                                  fill="#ff5f5f" if index == selected_vertex else "#ffffff", outline="#222")

    def _draw_prefab_shape(self, x_m: float, z_m: float, width_m: float, depth_m: float,
                           rotation_deg: float, color: str, label: str, dash=None) -> None:
        corners = prefab_footprint(x_m, z_m, width_m, depth_m, rotation_deg)
        self.create_polygon(*self._flat(corners), fill="", outline=color, width=2, dash=dash)
        start, end = prefab_front_marker(x_m, z_m, depth_m, rotation_deg)
        self.create_line(*self.world_to_canvas(*start), *self.world_to_canvas(*end), fill=color, width=2, arrow="last")
        if label:
            x, y = self.world_to_canvas(x_m, z_m)
            self.create_text(x, y, text=label, fill="#ffffff", font=("Segoe UI", 8))

    def _draw_draft(self, draft: list[tuple[float, float]], hover: tuple[float, float] | None) -> None:
        points = list(draft)
        if hover and draft:
            points.append(hover)
        if points:
            coords = self._flat(points)
            if len(points) == 1:
                x, y = self.world_to_canvas(*points[0])
                self.create_oval(x - 3, y - 3, x + 3, y + 3, fill="#ffffff", outline="")
            else:
                self.create_line(*coords, fill="#ffffff", width=2, dash=(4, 2))
            for point in draft:
                x, y = self.world_to_canvas(*point)
                self.create_oval(x - 3, y - 3, x + 3, y + 3, fill="#ffffff", outline="#222")

    def _flat(self, points) -> list[float]:
        return [coordinate for point in points for coordinate in self.world_to_canvas(*point)]

    def hit_test(self, world: tuple[float, float], project: SceneryProject,
                 asset_catalog: AssetCatalog | None, layers: dict[str, bool], selected_id: str | None) -> tuple[str | None, int | None]:
        tolerance = 8.0 / self.scale
        selected = project.find(selected_id) if selected_id else None
        if isinstance(selected, (PlaceRegion, LandUseRegion, Road, LinearFeature)):
            for index, point in enumerate(selected.points):
                if math.dist(world, point) <= tolerance:
                    return selected.id, index
        if layers.get("prefabs", True):
            for item in reversed(project.prefab_instances):
                if item.visible:
                    width, depth = _catalogue_proxy_size(asset_catalog, item.category, item.scale)
                    if point_in_polygon(world, prefab_footprint(item.x_m, item.z_m, width, depth, item.rotation_deg)):
                        return item.id, None
        for enabled, collection in (("hedgerows", project.linear_features), ("roads", project.roads)):
            if layers.get(enabled, True):
                for item in reversed(collection):
                    if item.visible and distance_to_polyline(world, list(item.points)) <= tolerance:
                        return item.id, None
        for enabled, collection in (("land_use", project.land_use_regions), ("places", project.places)):
            if layers.get(enabled, True):
                for item in reversed(collection):
                    if item.visible and point_in_polygon(world, item.points):
                        return item.id, None
        return None, None

    def nearest_segment(self, world: tuple[float, float], points) -> tuple[int, float]:
        choices = [(index, distance_to_segment(world, start, end)[0])
                   for index, (start, end) in enumerate(zip(points, points[1:]))]
        return min(choices, key=lambda value: value[1])


def _catalogue_proxy_size(asset_catalog: AssetCatalog | None, category: str, scale: float) -> tuple[float, float]:
    proxy = asset_catalog.proxy_for_category(category) if asset_catalog else None
    return (
        (proxy.width_m if proxy else 12.0) * scale,
        (proxy.depth_m if proxy else 12.0) * scale,
    )
