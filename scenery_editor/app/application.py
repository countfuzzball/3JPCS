from __future__ import annotations

import copy
import math
import tkinter as tk
from dataclasses import replace
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any

from scenery_editor.model.entities import LandUseRegion, LinearFeature, PlaceRegion, PrefabInstance, Road, TerrainPad
from scenery_editor.model.geometry import prefab_footprint
from scenery_editor.model.history import CommandHistory
from scenery_editor.model.asset_catalog import AssetCatalog, AssetDefinition
from scenery_editor.model.project import SceneryProject, SourceReferences, WorldSpec
from scenery_editor.model.terrain_reference import TerrainReference
from scenery_editor.model.validation import ValidationError
from scenery_editor.model.working_terrain import WorkingTerrain
from scenery_editor.project_io.final_export import export_final_heightmap, export_resampled_vegetation
from scenery_editor.project_io.reference_import import (
    CountyReference,
    VegetationReference,
    convert_county_to_native,
    load_county_features,
    load_asset_catalog,
    load_vegetation,
)
from scenery_editor.project_io.runtime_export import export_runtime_scenery
from scenery_editor.project_io.scenery_project_io import load_project, save_project

from .canvas_view import TerrainCanvas
from .properties_panel import PropertiesPanel
from .toolbox import ToolPanel


class SceneryEditorApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Polygon County Scenery Editor v0.2")
        self.root.geometry("1380x860")
        self.root.minsize(1020, 650)
        self.project: SceneryProject | None = None
        self.terrain: TerrainReference | None = None
        self.working_terrain: WorkingTerrain | None = None
        self.vegetation: VegetationReference | None = None
        self.county: CountyReference | None = None
        self.asset_catalog: AssetCatalog | None = None
        self.project_path: Path | None = None
        self.history = CommandHistory()
        self.dirty = False
        self.tool = "select"
        self.selected_id: str | None = None
        self.selected_vertex: int | None = None
        self.draft: list[tuple[float, float]] = []
        self.draft_hover: tuple[float, float] | None = None
        self.ghost: tuple[float, float, AssetDefinition] | None = None
        self.drag: dict[str, Any] | None = None
        self._resize_job: str | None = None
        self._prefab_display_to_id: dict[str, str] = {}
        self._configure_style()
        self._build_menu()
        self._build_layout()
        self._bind_events()
        self._refresh()
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def _configure_style(self) -> None:
        style = ttk.Style()
        style.configure("Heading.TLabel", font=("Segoe UI", 9, "bold"))

    def _build_menu(self) -> None:
        menu = tk.Menu(self.root)
        file_menu = tk.Menu(menu, tearoff=False)
        file_menu.add_command(label="New Scenery Project…", accelerator="Ctrl+N", command=self.new_project)
        file_menu.add_command(label="Open…", accelerator="Ctrl+O", command=self.open_project)
        file_menu.add_separator()
        file_menu.add_command(label="Save", accelerator="Ctrl+S", command=self.save)
        file_menu.add_command(label="Save As…", accelerator="Ctrl+Shift+S", command=self.save_as)
        file_menu.add_separator()
        file_menu.add_command(label="Load Vegetation Reference…", command=self.load_vegetation_reference)
        file_menu.add_command(label="Load County Features Reference…", command=self.load_county_reference)
        file_menu.add_command(label="Import County Features into Scenery…", command=self.import_county)
        file_menu.add_command(label="Load Asset Catalogue…", command=self.load_asset_catalog_reference)
        file_menu.add_separator()
        file_menu.add_command(label="Export Final Terrain PNG + Metadata…", command=self.export_final_terrain)
        file_menu.add_command(label="Export Resampled Vegetation…", command=self.export_final_vegetation)
        file_menu.add_command(label="Export Runtime Scenery…", command=self.export_runtime)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.close)
        menu.add_cascade(label="File", menu=file_menu)
        edit_menu = tk.Menu(menu, tearoff=False)
        edit_menu.add_command(label="Undo", accelerator="Ctrl+Z", command=self.undo)
        edit_menu.add_command(label="Redo", accelerator="Ctrl+Y", command=self.redo)
        edit_menu.add_separator()
        edit_menu.add_command(label="Delete Object", accelerator="Delete", command=self.delete_selected)
        edit_menu.add_command(label="Delete Selected Vertex", accelerator="Shift+Delete", command=self.delete_selected_vertex)
        menu.add_cascade(label="Edit", menu=edit_menu)
        view_menu = tk.Menu(menu, tearoff=False)
        view_menu.add_command(label="Fit Terrain", accelerator="F", command=self.fit_terrain)
        menu.add_cascade(label="View", menu=view_menu)
        help_menu = tk.Menu(menu, tearoff=False)
        help_menu.add_command(label="Controls", command=self.show_controls)
        help_menu.add_command(label="About", command=lambda: messagebox.showinfo("About", "Polygon County Scenery Editor v0.2\nEngine-agnostic scenery and derived terrain pads."))
        menu.add_cascade(label="Help", menu=help_menu)
        self.root.config(menu=menu)

    def _build_layout(self) -> None:
        main = ttk.Panedwindow(self.root, orient="horizontal")
        main.pack(fill="both", expand=True)
        self.tools = ToolPanel(main, self.set_tool, self._refresh)
        self.canvas = TerrainCanvas(main)
        self.properties = PropertiesPanel(main, self.apply_properties, self.delete_selected,
                                          self.rotate_selected, self.delete_selected_vertex,
                                          self.reset_selected_pad)
        main.add(self.tools, weight=0)
        main.add(self.canvas, weight=1)
        main.add(self.properties, weight=0)
        self.status = tk.StringVar(value="No terrain loaded")
        ttk.Label(self.root, textvariable=self.status, anchor="w", padding=(7, 3), relief="sunken").pack(fill="x")

    def _bind_events(self) -> None:
        c = self.canvas
        c.bind("<Button-1>", self._left_down)
        c.bind("<Double-Button-1>", self._double_click)
        c.bind("<B1-Motion>", self._left_drag)
        c.bind("<ButtonRelease-1>", self._left_up)
        c.bind("<Motion>", self._motion)
        c.bind("<MouseWheel>", self._wheel)
        c.bind("<Button-4>", lambda event: self._wheel_factor(event, 1.2))
        c.bind("<Button-5>", lambda event: self._wheel_factor(event, 1 / 1.2))
        for button in (2, 3):
            c.bind(f"<Button-{button}>", self._pan_down)
            c.bind(f"<B{button}-Motion>", self._pan_drag)
            c.bind(f"<ButtonRelease-{button}>", self._pan_up)
        c.bind("<Configure>", self._resize)
        self.root.bind("<Return>", lambda _e: self.finish_draft())
        self.root.bind("<Escape>", lambda _e: self.cancel_draft())
        self.root.bind("<BackSpace>", lambda _e: self.remove_draft_point())
        self.root.bind("<Delete>", self._delete_key)
        self.root.bind("<Control-z>", lambda _e: self.undo())
        self.root.bind("<Control-y>", lambda _e: self.redo())
        self.root.bind("<Control-n>", lambda _e: self.new_project())
        self.root.bind("<Control-o>", lambda _e: self.open_project())
        self.root.bind("<Control-s>", self._save_key)
        self.root.bind("<KeyPress-f>", lambda _e: self.fit_terrain())
        self.root.bind("<KeyPress-q>", lambda _e: self.rotate_selected(-15.0))
        self.root.bind("<KeyPress-e>", lambda _e: self.rotate_selected(15.0))

    def _save_key(self, event) -> None:
        if event.state & 0x1:
            self.save_as()
        else:
            self.save()

    def _delete_key(self, event) -> None:
        if event.state & 0x1:
            self.delete_selected_vertex()
        else:
            self.delete_selected()

    def new_project(self) -> None:
        if not self._confirm_discard():
            return
        npy = filedialog.askopenfilename(title="Select Polygon County float32 terrain NPY", filetypes=[("NumPy terrain", "*.npy"), ("All files", "*.*")])
        if not npy:
            return
        descriptor = filedialog.askopenfilename(title="Select matching terrain descriptor JSON", initialdir=str(Path(npy).parent), filetypes=[("JSON", "*.json"), ("All files", "*.*")])
        if not descriptor:
            return
        try:
            terrain = TerrainReference.load(npy, descriptor)
        except ValidationError as exc:
            messagebox.showerror("Terrain validation failed", str(exc))
            return
        name = simpledialog.askstring("Project name", "Scenery project name:", initialvalue=f"{Path(npy).stem} Scenery")
        if name is None:
            return
        self.terrain = terrain
        self.project = SceneryProject(
            name=name.strip() or "Untitled Scenery",
            world=WorldSpec(terrain.world_width_m, terrain.world_depth_m, terrain.spacing_m),
            sources=SourceReferences(str(terrain.npy_path), str(terrain.descriptor_path)),
            terrain_fingerprint=terrain.fingerprint.to_dict(),
        )
        self.vegetation = self.county = self.asset_catalog = None
        self.project_path = None
        self.history.clear()
        self.dirty = True
        self._reset_interaction()
        self._rebuild_working_terrain(preserve_view=False)
        self.root.after_idle(self._fit_and_refresh)

    def open_project(self) -> None:
        if not self._confirm_discard():
            return
        path = filedialog.askopenfilename(title="Open scenery project", filetypes=[("Polygon County scenery", "*.scenery.json"), ("JSON", "*.json"), ("All files", "*.*")])
        if not path:
            return
        try:
            loaded = load_project(path)
        except (ValidationError, OSError) as exc:
            messagebox.showerror("Open failed", str(exc))
            return
        self.project, self.terrain = loaded.project, loaded.terrain
        self.vegetation, self.county, self.asset_catalog = (
            loaded.vegetation,
            loaded.county,
            loaded.asset_catalog,
        )
        self.project_path = Path(path).resolve()
        self.history.clear()
        self.dirty = False
        self._reset_interaction()
        self._rebuild_working_terrain(preserve_view=False)
        self._update_prefab_choices()
        self.root.after_idle(self._fit_and_refresh)
        if loaded.warnings:
            messagebox.showwarning("Project opened with warnings", "\n\n".join(loaded.warnings))

    def save(self) -> bool:
        if not self.project:
            return False
        if not self.project_path:
            return self.save_as()
        try:
            self.project.validate()
            save_project(self.project_path, self.project)
        except (ValidationError, OSError) as exc:
            messagebox.showerror("Save failed", str(exc))
            return False
        self.dirty = False
        self._update_title()
        self.status.set(f"Saved {self.project_path.name}")
        return True

    def save_as(self) -> bool:
        if not self.project:
            return False
        path = filedialog.asksaveasfilename(title="Save scenery project", defaultextension=".scenery.json",
                                            filetypes=[("Polygon County scenery", "*.scenery.json"), ("JSON", "*.json")])
        if not path:
            return False
        self.project_path = Path(path).resolve()
        return self.save()

    def load_vegetation_reference(self) -> None:
        if not self._require_project():
            return
        path = filedialog.askopenfilename(title="Load generated_vegetation.json", filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            reference = load_vegetation(path, self.terrain)
            if self.county and reference.project_id != self.county.project_id:
                raise ValidationError("vegetation and loaded county features have different project IDs")
        except ValidationError as exc:
            messagebox.showerror("Vegetation validation failed", str(exc))
            return
        self.vegetation = reference
        self.project.sources = replace(self.project.sources, vegetation=str(reference.path))
        self._mark_dirty()

    def load_county_reference(self) -> None:
        if not self._require_project():
            return
        path = filedialog.askopenfilename(title="Load county_features.json v3", filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            reference = load_county_features(path, self.terrain)
            if self.vegetation and reference.project_id != self.vegetation.project_id:
                raise ValidationError("county features and loaded vegetation have different project IDs")
        except ValidationError as exc:
            messagebox.showerror("County validation failed", str(exc))
            return
        self.county = reference
        self.project.sources = replace(self.project.sources, county_features=str(reference.path))
        self._mark_dirty()

    def import_county(self) -> None:
        if not self._require_project():
            return
        if not self.county:
            self.load_county_reference()
            if not self.county:
                return
        before = self.project.authored_snapshot()
        try:
            warnings = convert_county_to_native(self.project, self.county)
        except ValidationError as exc:
            self.project.restore_authored_snapshot(before)
            messagebox.showerror("County import failed", str(exc))
            return
        self._record("Import county features", before)
        if warnings:
            messagebox.showwarning("County import warnings", "\n".join(warnings))

    def load_asset_catalog_reference(self) -> None:
        if not self._require_project():
            return
        path = filedialog.askopenfilename(title="Load shared asset catalogue", filetypes=[("JSON", "*.json")])
        if not path:
            return
        try:
            asset_catalog = load_asset_catalog(path)
        except ValidationError as exc:
            messagebox.showerror("Asset catalogue validation failed", str(exc))
            return
        self.asset_catalog = asset_catalog
        self.project.sources = replace(self.project.sources, asset_catalog=str(Path(path).resolve()))
        self._update_prefab_choices()
        self._mark_dirty()

    def export_runtime(self) -> None:
        if not self._require_project():
            return
        path = filedialog.asksaveasfilename(title="Export semantic runtime scenery", defaultextension=".scenery.runtime.json",
                                            filetypes=[("Runtime scenery JSON", "*.json")])
        if not path:
            return
        try:
            self._rebuild_working_terrain()
            assert self.working_terrain is not None
            export_runtime_scenery(path, self.project, self.working_terrain, self.asset_catalog)
        except (ValidationError, OSError) as exc:
            messagebox.showerror("Runtime export failed", str(exc))
            return
        messagebox.showinfo("Runtime export", f"Exported semantic scenery to:\n{path}\n\nPrefab Y values were sampled from the derived working terrain.")

    def export_final_terrain(self) -> None:
        if not self._require_project():
            return
        path = filedialog.asksaveasfilename(
            title="Export final 16-bit terrain heightmap",
            defaultextension=".png",
            filetypes=[("16-bit PNG heightmap", "*.png")],
        )
        if not path:
            return
        try:
            self._rebuild_working_terrain()
            assert self.working_terrain is not None
            metadata_path = export_final_heightmap(path, self.working_terrain)
        except (ValidationError, OSError, ValueError) as exc:
            messagebox.showerror("Final terrain export failed", str(exc))
            return
        messagebox.showinfo(
            "Final terrain export",
            f"Exported final terrain to:\n{Path(path).with_suffix('.png')}\n\nMetadata:\n{metadata_path}",
        )

    def export_final_vegetation(self) -> None:
        if not self._require_project():
            return
        if not self.vegetation:
            messagebox.showwarning("No vegetation", "Load a vegetation reference before exporting resampled vegetation.")
            return
        path = filedialog.asksaveasfilename(
            title="Export vegetation resampled to final terrain",
            initialfile="generated_vegetation.json",
            defaultextension=".json",
            filetypes=[("Vegetation JSON", "*.json")],
        )
        if not path:
            return
        try:
            self._rebuild_working_terrain()
            assert self.working_terrain is not None
            export_resampled_vegetation(path, self.vegetation, self.working_terrain)
        except (ValidationError, OSError) as exc:
            messagebox.showerror("Vegetation export failed", str(exc))
            return
        messagebox.showinfo(
            "Vegetation export",
            f"Exported {len(self.vegetation.objects)} placements with fresh final-terrain Y values to:\n{path}\n\nNo placements were culled.",
        )

    def set_tool(self, tool: str) -> None:
        self.tool = tool
        self.draft.clear()
        self.draft_hover = None
        self.ghost = None
        instructions = {
            "select": "Click to select. Drag a handle or whole object. Ctrl-click a selected road/hedgerow segment to insert a point.",
            "road": "Click ordered road points. Enter/double-click finishes; Backspace removes; Escape cancels.",
            "hedgerow": "Click ordered hedgerow points. Enter/double-click finishes; Backspace removes; Escape cancels.",
            "prefab": "Choose an asset-catalogue entry, hover for its footprint, then click to place.",
        }
        if tool.startswith(("place:", "land:")):
            text = "Click polygon vertices. Enter/double-click finishes; Backspace removes; Escape cancels."
        else:
            text = instructions.get(tool, "")
        self.tools.instructions.configure(text=text)
        self._refresh()

    def _left_down(self, event) -> None:
        self.canvas.focus_set()
        if not self.project or not self.terrain:
            return
        world = self.canvas.canvas_to_world(event.x, event.y)
        if not self.canvas.in_world(world):
            return
        world = self.canvas.clamp_world(world)
        if self.tool == "select":
            hit_id, vertex = self.canvas.hit_test(world, self.project, self.asset_catalog,
                                                  self.tools.layer_state(), self.selected_id)
            self.selected_id, self.selected_vertex = hit_id, vertex
            item = self.project.find(hit_id) if hit_id else None
            if item and not item.locked and (event.state & 0x4) and isinstance(item, (Road, LinearFeature)) and vertex is None:
                segment, distance = self.canvas.nearest_segment(world, item.points)
                if distance <= 10.0 / self.canvas.scale:
                    before = self.project.authored_snapshot()
                    points = list(item.points)
                    points.insert(segment + 1, world)
                    self.project.replace_object(item.copy_with(points=tuple(points)))
                    self.selected_vertex = segment + 1
                    self._record("Insert control point", before)
                    return
            if item and not item.locked:
                self.drag = {"start": world, "original": copy.deepcopy(item),
                             "vertex": vertex, "before": self.project.authored_snapshot()}
            self._refresh()
        elif self.tool == "prefab":
            self._place_prefab(world)
        else:
            self.draft.append(world)
            self._refresh()

    def _double_click(self, _event) -> None:
        if self.tool not in {"select", "prefab"}:
            self.finish_draft()

    def _left_drag(self, event) -> None:
        if not self.drag or not self.project or not self.terrain:
            return
        current = self.canvas.clamp_world(self.canvas.canvas_to_world(event.x, event.y))
        original = self.drag["original"]
        start = self.drag["start"]
        dx, dz = current[0] - start[0], current[1] - start[1]
        if isinstance(original, PrefabInstance):
            replacement = original.copy_with(x_m=max(0.0, min(self.terrain.world_width_m, original.x_m + dx)),
                                             z_m=max(0.0, min(self.terrain.world_depth_m, original.z_m + dz)))
        else:
            points = list(original.points)
            vertex = self.drag["vertex"]
            if vertex is not None:
                points[vertex] = self.canvas.clamp_world((points[vertex][0] + dx, points[vertex][1] + dz))
            else:
                min_x, max_x = min(p[0] for p in points), max(p[0] for p in points)
                min_z, max_z = min(p[1] for p in points), max(p[1] for p in points)
                dx = max(-min_x, min(self.terrain.world_width_m - max_x, dx))
                dz = max(-min_z, min(self.terrain.world_depth_m - max_z, dz))
                points = [(x + dx, z + dz) for x, z in points]
            replacement = original.copy_with(points=tuple(points))
        self.project.replace_object(replacement)
        self._refresh_canvas()

    def _left_up(self, _event) -> None:
        if self.drag and self.project:
            before = self.drag["before"]
            self.drag = None
            self._record("Move object" if self.selected_vertex is None else "Move vertex", before)
        self._refresh_properties()

    def _motion(self, event) -> None:
        if not self.terrain:
            return
        world = self.canvas.canvas_to_world(event.x, event.y)
        if self.canvas.in_world(world):
            surface = self.working_terrain or self.terrain
            elevation = surface.height_at(*world)
            slope = surface.slope_at(*world)
            self.status.set(f"X {world[0]:.2f} m    Z {world[1]:.2f} m    terrain elevation {elevation:.2f} m    slope {slope:.2f}°")
            if self.tool not in {"select", "prefab"} and self.draft:
                self.draft_hover = world
                self._refresh_canvas()
            elif self.tool == "prefab":
                definition = self._selected_prefab_definition()
                self.ghost = (world[0], world[1], definition) if definition else None
                self._refresh_canvas()
        else:
            self.status.set("Outside terrain bounds")
            if self.ghost or self.draft_hover:
                self.ghost = None
                self.draft_hover = None
                self._refresh_canvas()

    def _wheel(self, event) -> None:
        self._wheel_factor(event, 1.2 if event.delta > 0 else 1 / 1.2)

    def _wheel_factor(self, event, factor: float) -> None:
        self.canvas.zoom_at(event.x, event.y, factor)
        self._refresh_canvas()

    def _pan_down(self, event) -> None:
        self.canvas.begin_pan(event.x, event.y)

    def _pan_drag(self, event) -> None:
        self.canvas.pan_to(event.x, event.y)
        self._refresh_canvas()

    def _pan_up(self, _event) -> None:
        self.canvas.end_pan()

    def _resize(self, _event) -> None:
        if self._resize_job:
            self.root.after_cancel(self._resize_job)
        self._resize_job = self.root.after(80, self._refresh_canvas)

    def finish_draft(self) -> None:
        if not self.project or self.tool in {"select", "prefab"}:
            return
        points = self._dedupe_points(self.draft)
        required = 3 if self.tool.startswith(("place:", "land:")) else 2
        if len(points) < required:
            messagebox.showwarning("Incomplete geometry", f"This tool requires at least {required} distinct points.")
            return
        before = self.project.authored_snapshot()
        try:
            if self.tool.startswith("place:"):
                kind = self.tool.split(":", 1)[1]
                item = PlaceRegion(name=self._next_name(kind.replace("_", " ").title()), place_type=kind, points=tuple(points))
                self.project.places.append(item)
            elif self.tool.startswith("land:"):
                kind = self.tool.split(":", 1)[1]
                item = LandUseRegion(name=self._next_name(kind.replace("_", " ").title()), land_use_type=kind, points=tuple(points))
                self.project.land_use_regions.append(item)
            elif self.tool == "road":
                item = Road(name=self._next_name("Road"), points=tuple(points))
                self.project.roads.append(item)
            else:
                item = LinearFeature(name=self._next_name("Hedgerow"), points=tuple(points))
                self.project.linear_features.append(item)
            item.validate(self.project.world.width_m, self.project.world.depth_m)
        except ValidationError as exc:
            self.project.restore_authored_snapshot(before)
            messagebox.showerror("Invalid geometry", str(exc))
            return
        self.selected_id, self.selected_vertex = item.id, None
        self.draft.clear()
        self.draft_hover = None
        self.tools.set_tool("select")
        self._record(f"Create {item.name}", before)

    @staticmethod
    def _dedupe_points(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        result = []
        for point in points:
            if not result or math.dist(result[-1], point) > 1e-7:
                result.append(point)
        return result

    def cancel_draft(self) -> None:
        self.draft.clear()
        self.draft_hover = None
        self.ghost = None
        self._refresh_canvas()

    def remove_draft_point(self) -> None:
        if self.draft:
            self.draft.pop()
            self._refresh_canvas()

    def _place_prefab(self, world: tuple[float, float]) -> None:
        if not self.project:
            return
        definition = self._selected_prefab_definition()
        if not definition:
            messagebox.showwarning("No prefab", "Load an asset catalogue and choose an asset first.")
            return
        before = self.project.authored_snapshot()
        item = PrefabInstance(name=self._next_name(definition.display_name), category=definition.category,
                              asset_id=definition.asset_id, x_m=world[0], z_m=world[1])
        self.project.prefab_instances.append(item)
        self.selected_id, self.selected_vertex = item.id, None
        self.tools.set_tool("select")
        self._record(f"Place {definition.display_name}", before)

    def delete_selected(self) -> None:
        if not self.project or not self.selected_id:
            return
        item = self.project.find(self.selected_id)
        if not item:
            return
        if item.locked:
            messagebox.showwarning("Object locked", "Unlock this object in Properties before deleting it.")
            return
        before = self.project.authored_snapshot()
        removed = self.project.remove_object(item.id)
        if isinstance(removed, Road):
            self.project.prefab_instances = [p.copy_with(frontage_road_id=None) if p.frontage_road_id == removed.id else p
                                             for p in self.project.prefab_instances]
        self.selected_id = None
        self.selected_vertex = None
        self._record(f"Delete {item.name}", before)

    def delete_selected_vertex(self) -> None:
        if not self.project or not self.selected_id or self.selected_vertex is None:
            return
        item = self.project.find(self.selected_id)
        if not isinstance(item, (PlaceRegion, LandUseRegion, Road, LinearFeature)) or item.locked:
            return
        minimum = 3 if isinstance(item, (PlaceRegion, LandUseRegion)) else 2
        if len(item.points) <= minimum:
            messagebox.showwarning("Cannot delete vertex", f"This geometry must retain at least {minimum} points.")
            return
        before = self.project.authored_snapshot()
        points = list(item.points)
        points.pop(self.selected_vertex)
        self.project.replace_object(item.copy_with(points=tuple(points)))
        self.selected_vertex = None
        self._record("Delete vertex", before)

    def rotate_selected(self, delta: float) -> None:
        if not self.project or not self.selected_id:
            return
        item = self.project.find(self.selected_id)
        if not isinstance(item, PrefabInstance) or item.locked:
            return
        before = self.project.authored_snapshot()
        self.project.replace_object(item.copy_with(rotation_deg=(item.rotation_deg + delta) % 360.0))
        self._record("Rotate prefab", before)

    def apply_properties(self, values: dict[str, Any]) -> None:
        if not self.project or not self.selected_id:
            return
        item = self.project.find(self.selected_id)
        if not item:
            return
        before = self.project.authored_snapshot()
        try:
            changes: dict[str, Any] = {"name": str(values["name"]).strip(),
                                       "visible": bool(values["visible"]), "locked": bool(values["locked"])}
            if isinstance(item, PlaceRegion):
                changes["place_type"] = values["place_type"]
            elif isinstance(item, LandUseRegion):
                changes["land_use_type"] = values["land_use_type"]
            elif isinstance(item, Road):
                changes.update(road_class=values["road_class"], surface=values["surface"], width_m=float(values["width_m"]))
            elif isinstance(item, LinearFeature):
                changes.update(nominal_width_m=float(values["nominal_width_m"]), nominal_height_m=float(values["nominal_height_m"]))
            elif isinstance(item, PrefabInstance):
                asset_id = str(values["asset_id"])
                definition = self.asset_catalog.by_asset_id.get(asset_id) if self.asset_catalog else None
                frontage = str(values["frontage_road_id"]).strip() or None
                changes.update(asset_id=asset_id, category=definition.category if definition else str(values["category"]).strip(),
                               x_m=float(values["x_m"]), z_m=float(values["z_m"]),
                               rotation_deg=float(values["rotation_deg"]) % 360.0, scale=float(values["scale"]),
                               frontage_road_id=frontage,
                               terrain_pad=TerrainPad(
                                   enabled=bool(values["terrain_pad_enabled"]),
                                   width_m=float(values["terrain_pad_width_m"]),
                                   depth_m=float(values["terrain_pad_depth_m"]),
                                   blend_m=float(values["terrain_pad_blend_m"]),
                               ))
            replacement = item.copy_with(**changes)
            road_ids = {road.id for road in self.project.roads}
            if isinstance(replacement, PrefabInstance):
                replacement.validate(self.project.world.width_m, self.project.world.depth_m, road_ids)
            else:
                replacement.validate(self.project.world.width_m, self.project.world.depth_m)
            self.project.replace_object(replacement)
            self.project.validate()
        except (ValueError, ValidationError) as exc:
            self.project.restore_authored_snapshot(before)
            messagebox.showerror("Invalid properties", str(exc))
            return
        self._record("Edit properties", before)

    def reset_selected_pad(self) -> None:
        if not self.project or not self.selected_id:
            return
        item = self.project.find(self.selected_id)
        if not isinstance(item, PrefabInstance) or item.locked:
            return
        before = self.project.authored_snapshot()
        self.project.replace_object(item.copy_with(terrain_pad=TerrainPad()))
        self._record("Reset terrain pad", before)

    def undo(self) -> None:
        if self.project and self.history.undo(self.project):
            if self.selected_id and not self.project.find(self.selected_id):
                self.selected_id = self.selected_vertex = None
            self.dirty = True
            self._rebuild_working_terrain()
            self._refresh()

    def redo(self) -> None:
        if self.project and self.history.redo(self.project):
            if self.selected_id and not self.project.find(self.selected_id):
                self.selected_id = self.selected_vertex = None
            self.dirty = True
            self._rebuild_working_terrain()
            self._refresh()

    def fit_terrain(self) -> None:
        self.canvas.fit_terrain()
        self._refresh_canvas()

    def _fit_and_refresh(self) -> None:
        self.canvas.fit_terrain()
        self._refresh()

    def _record(self, label: str, before: dict[str, Any]) -> None:
        if not self.project:
            return
        self.history.record(label, before, self.project.authored_snapshot())
        self._rebuild_working_terrain()
        self._mark_dirty()

    def _rebuild_working_terrain(self, *, preserve_view: bool = True) -> None:
        if not self.project or not self.terrain:
            self.working_terrain = None
            self.canvas.set_terrain(None)
            return
        self.working_terrain = WorkingTerrain.compose(self.terrain, self.project.prefab_instances)
        self.canvas.set_terrain(self.working_terrain, preserve_view=preserve_view)

    def _mark_dirty(self) -> None:
        self.dirty = True
        self._refresh()

    def _refresh(self) -> None:
        self._refresh_canvas()
        self._refresh_properties()
        self._update_title()

    def _refresh_canvas(self) -> None:
        self._resize_job = None
        self.canvas.redraw(self.project, self.vegetation, self.county, self.asset_catalog,
                           self.tools.layer_state(), self.selected_id, self.selected_vertex,
                           self.draft, self.draft_hover, self.ghost)

    def _refresh_properties(self) -> None:
        item = self.project.find(self.selected_id) if self.project and self.selected_id else None
        site = None
        if isinstance(item, PrefabInstance) and self.working_terrain and item.terrain_pad.enabled:
            width = item.terrain_pad.width_m
            depth = item.terrain_pad.depth_m
            site = self.working_terrain.footprint_site_info(
                prefab_footprint(item.x_m, item.z_m, width, depth, item.rotation_deg),
                (item.x_m, item.z_m),
            )
        self.properties.show(
            item,
            sorted(self.asset_catalog.by_asset_id) if self.asset_catalog else [],
            site,
            self.selected_vertex,
        )

    def _update_title(self) -> None:
        name = self.project.name if self.project else "No Project"
        marker = " *" if self.dirty else ""
        self.root.title(f"{name}{marker} — Polygon County Scenery Editor v0.2")

    def _update_prefab_choices(self) -> None:
        self._prefab_display_to_id.clear()
        if self.asset_catalog:
            for item in self.asset_catalog.assets:
                display = f"{item.display_name} [{item.asset_id}]"
                self._prefab_display_to_id[display] = item.asset_id
        self.tools.set_prefabs(list(self._prefab_display_to_id))

    def _selected_prefab_definition(self) -> AssetDefinition | None:
        if not self.asset_catalog:
            return None
        asset_id = self._prefab_display_to_id.get(self.tools.prefab_var.get())
        return self.asset_catalog.by_asset_id.get(asset_id) if asset_id else None

    def _next_name(self, stem: str) -> str:
        if not self.project:
            return stem
        existing = {item.name for item in self.project.all_objects()}
        if stem not in existing:
            return stem
        number = 2
        while f"{stem} {number}" in existing:
            number += 1
        return f"{stem} {number}"

    def _reset_interaction(self) -> None:
        self.selected_id = self.selected_vertex = None
        self.draft.clear()
        self.draft_hover = self.ghost = self.drag = None
        self.tools.tool_var.set("select")
        self.tool = "select"
        self._update_prefab_choices()

    def _require_project(self) -> bool:
        if not self.project or not self.terrain or not self.working_terrain:
            messagebox.showwarning("No project", "Create or open a scenery project first.")
            return False
        return True

    def _confirm_discard(self) -> bool:
        if not self.dirty:
            return True
        answer = messagebox.askyesnocancel("Unsaved changes", "Save changes before continuing?")
        if answer is None:
            return False
        return self.save() if answer else True

    def close(self) -> None:
        if self._confirm_discard():
            self.root.destroy()

    def show_controls(self) -> None:
        messagebox.showinfo(
            "Controls",
            "Mouse wheel: zoom at cursor\nMiddle/right drag: pan\nF: fit terrain\n\n"
            "Drawing: click points, Enter/double-click to finish, Backspace removes latest, Escape cancels\n"
            "Selection: drag handles or whole geometry; Ctrl-click a road/hedgerow segment inserts a point\n"
            "Delete: object; Shift+Delete: selected vertex\nQ / E: rotate selected prefab by 15°\n\n"
            "The imported terrain and reference JSON files are never overwritten. Terrain pads affect only a derived working copy and explicit final exports.",
        )


def run() -> None:
    root = tk.Tk()
    SceneryEditorApp(root)
    root.mainloop()
