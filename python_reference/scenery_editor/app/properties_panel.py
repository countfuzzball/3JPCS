from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Any, Callable

from scenery_editor.model.entities import LandUseRegion, LinearFeature, PlaceRegion, PrefabInstance, Road


class PropertiesPanel(ttk.Frame):
    def __init__(self, master, on_apply: Callable[[dict[str, Any]], None], on_delete: Callable[[], None],
                 on_rotate: Callable[[float], None], on_delete_vertex: Callable[[], None],
                 on_reset_pad: Callable[[], None]):
        super().__init__(master, padding=8)
        self.on_apply = on_apply
        self.on_delete = on_delete
        self.on_rotate = on_rotate
        self.on_delete_vertex = on_delete_vertex
        self.on_reset_pad = on_reset_pad
        self._vars: dict[str, tk.Variable] = {}
        self._body = ttk.Frame(self)
        ttk.Label(self, text="PROPERTIES", style="Heading.TLabel").pack(anchor="w", pady=(0, 8))
        self._body.pack(fill="both", expand=True)
        self.show(None, [], None)

    def show(self, item, prefab_asset_ids: list[str], site_info: dict[str, float | bool] | None,
             selected_vertex: int | None = None) -> None:
        for child in self._body.winfo_children():
            child.destroy()
        self._vars.clear()
        if item is None:
            ttk.Label(self._body, text="Nothing selected.", foreground="#666").grid(row=0, column=0, sticky="nw")
            return
        row = 0
        row = self._entry(row, "Name", "name", item.name)
        row = self._check(row, "Visible", "visible", item.visible)
        row = self._check(row, "Locked", "locked", item.locked)
        if isinstance(item, PlaceRegion):
            row = self._combo(row, "Place type", "place_type", item.place_type, sorted(item.TYPES))
        elif isinstance(item, LandUseRegion):
            row = self._combo(row, "Land use", "land_use_type", item.land_use_type, sorted(item.TYPES))
        elif isinstance(item, Road):
            row = self._combo(row, "Road class", "road_class", item.road_class, sorted(item.CLASSES))
            row = self._combo(row, "Surface", "surface", item.surface, sorted(item.SURFACES))
            row = self._entry(row, "Full width (m)", "width_m", item.width_m)
        elif isinstance(item, LinearFeature):
            row = self._entry(row, "Nominal width (m)", "nominal_width_m", item.nominal_width_m)
            row = self._entry(row, "Nominal height (m)", "nominal_height_m", item.nominal_height_m)
        elif isinstance(item, PrefabInstance):
            values = prefab_asset_ids or [item.asset_id]
            if item.asset_id not in values:
                values = [item.asset_id] + values
            row = self._combo(row, "Asset", "asset_id", item.asset_id, values)
            row = self._entry(row, "Category", "category", item.category)
            row = self._entry(row, "X (m)", "x_m", item.x_m)
            row = self._entry(row, "Z (m)", "z_m", item.z_m)
            row = self._entry(row, "Rotation (deg)", "rotation_deg", item.rotation_deg % 360.0)
            row = self._entry(row, "Scale", "scale", item.scale)
            row = self._entry(row, "Frontage road UUID", "frontage_road_id", item.frontage_road_id or "")
            buttons = ttk.Frame(self._body)
            buttons.grid(row=row, column=0, columnspan=2, sticky="ew", pady=4)
            ttk.Button(buttons, text="Rotate -15°", command=lambda: self.on_rotate(-15.0)).pack(side="left")
            ttk.Button(buttons, text="Rotate +15°", command=lambda: self.on_rotate(15.0)).pack(side="left", padx=4)
            row += 1
            ttk.Separator(self._body).grid(row=row, column=0, columnspan=2, sticky="ew", pady=7)
            row += 1
            ttk.Label(self._body, text="TERRAIN PAD", style="Heading.TLabel").grid(row=row, column=0, columnspan=2, sticky="w")
            row += 1
            row = self._check(row, "Enabled", "terrain_pad_enabled", item.terrain_pad.enabled)
            row = self._entry(row, "Pad width (m)", "terrain_pad_width_m", item.terrain_pad.width_m)
            row = self._entry(row, "Pad depth (m)", "terrain_pad_depth_m", item.terrain_pad.depth_m)
            row = self._entry(row, "Blend distance (m)", "terrain_pad_blend_m", item.terrain_pad.blend_m)
            ttk.Label(self._body, text="Target: base terrain at object origin", foreground="#555").grid(
                row=row, column=0, columnspan=2, sticky="w", pady=(2, 4)
            )
            row += 1
            ttk.Button(self._body, text="Reset Pad to Catalog Default", command=self.on_reset_pad).grid(
                row=row, column=0, columnspan=2, sticky="ew", pady=2
            )
            row += 1
            if site_info:
                ttk.Separator(self._body).grid(row=row, column=0, columnspan=2, sticky="ew", pady=7)
                row += 1
                lines = [
                    f"Origin elevation: {site_info['origin_elevation_m']:.2f} m",
                    f"Footprint min/max: {site_info['minimum_elevation_m']:.2f} / {site_info['maximum_elevation_m']:.2f} m",
                    f"Elevation range: {site_info['elevation_range_m']:.2f} m",
                    f"Max / average slope: {site_info['maximum_slope_deg']:.2f}° / {site_info['average_slope_deg']:.2f}°",
                ]
                warning = bool(site_info.get("footprint_outside_world", 0.0))
                if site_info.get("footprint_outside_world", 0.0):
                    lines.append("⚠ Part of the footprint lies outside the terrain world.")
                ttk.Label(self._body, text="\n".join(lines), wraplength=260,
                          foreground="#a64020" if warning else "#444").grid(row=row, column=0, columnspan=2, sticky="w")
                row += 1
        ttk.Button(self._body, text="Apply Properties", command=self._apply).grid(row=row, column=0, columnspan=2, sticky="ew", pady=(10, 4))
        row += 1
        if selected_vertex is not None and isinstance(item, (PlaceRegion, LandUseRegion, Road, LinearFeature)):
            ttk.Button(self._body, text=f"Delete Vertex {selected_vertex + 1}", command=self.on_delete_vertex).grid(row=row, column=0, columnspan=2, sticky="ew", pady=2)
            row += 1
        ttk.Button(self._body, text="Delete Object", command=self.on_delete).grid(row=row, column=0, columnspan=2, sticky="ew", pady=2)
        self._body.columnconfigure(1, weight=1)

    def _entry(self, row: int, label: str, key: str, value: Any) -> int:
        ttk.Label(self._body, text=label).grid(row=row, column=0, sticky="w", pady=2)
        variable = tk.StringVar(value=str(value))
        self._vars[key] = variable
        ttk.Entry(self._body, textvariable=variable).grid(row=row, column=1, sticky="ew", pady=2)
        return row + 1

    def _check(self, row: int, label: str, key: str, value: bool) -> int:
        variable = tk.BooleanVar(value=value)
        self._vars[key] = variable
        ttk.Checkbutton(self._body, text=label, variable=variable).grid(row=row, column=0, columnspan=2, sticky="w")
        return row + 1

    def _combo(self, row: int, label: str, key: str, value: str, values: list[str]) -> int:
        ttk.Label(self._body, text=label).grid(row=row, column=0, sticky="w", pady=2)
        variable = tk.StringVar(value=value)
        self._vars[key] = variable
        ttk.Combobox(self._body, textvariable=variable, values=values, state="readonly").grid(row=row, column=1, sticky="ew", pady=2)
        return row + 1

    def _apply(self) -> None:
        self.on_apply({key: variable.get() for key, variable in self._vars.items()})
