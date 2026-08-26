from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Callable


LAYER_LABELS = {
    "terrain": "Terrain",
    "hillshade": "Hillshade",
    "contours": "Contours",
    "terrain_pads": "Terrain Pads",
    "vegetation": "Imported vegetation",
    "county_settlements": "Imported county settlements",
    "county_roads": "Imported county roads",
    "county_buildings": "Imported county buildings",
    "places": "Place Regions",
    "land_use": "Land Use",
    "roads": "Native Roads",
    "hedgerows": "Hedgerows",
    "prefabs": "Prefab Instances",
}


class ToolPanel(ttk.Frame):
    def __init__(self, master, on_tool: Callable[[str], None], on_layers: Callable[[], None]):
        super().__init__(master, padding=8)
        self.on_tool = on_tool
        self.tool_var = tk.StringVar(value="select")
        self.prefab_var = tk.StringVar()
        self.layer_vars = {name: tk.BooleanVar(value=True) for name in LAYER_LABELS}
        row = 0
        ttk.Label(self, text="TOOLS", style="Heading.TLabel").grid(row=row, column=0, sticky="w", pady=(0, 6))
        row += 1
        row = self._group(row, "SELECT / MOVE", [("Select / Move", "select")])
        row = self._group(row, "PLACE REGIONS", [("Town", "place:town"), ("Village", "place:village"),
                                                  ("Farm", "place:farm"), ("Military Area", "place:military_area")])
        row = self._group(row, "LAND USE", [("Pasture", "land:pasture"), ("Rough Grazing", "land:rough_grazing")])
        row = self._group(row, "NETWORK", [("Road", "road"), ("Hedgerow", "hedgerow")])
        ttk.Label(self, text="OBJECTS", style="Heading.TLabel").grid(row=row, column=0, sticky="w", pady=(8, 2))
        row += 1
        self.prefab_combo = ttk.Combobox(self, textvariable=self.prefab_var, state="readonly", width=24)
        self.prefab_combo.grid(row=row, column=0, sticky="ew")
        row += 1
        ttk.Radiobutton(self, text="Place Prefab", value="prefab", variable=self.tool_var,
                        command=self._choose_tool).grid(row=row, column=0, sticky="w")
        row += 1
        ttk.Separator(self).grid(row=row, column=0, sticky="ew", pady=8)
        row += 1
        ttk.Label(self, text="LAYERS", style="Heading.TLabel").grid(row=row, column=0, sticky="w")
        row += 1
        for name, label in LAYER_LABELS.items():
            ttk.Checkbutton(self, text=label, variable=self.layer_vars[name], command=on_layers).grid(row=row, column=0, sticky="w")
            row += 1
        self.instructions = ttk.Label(self, text="Load or open a scenery project.", wraplength=210, foreground="#555")
        self.instructions.grid(row=row, column=0, sticky="ew", pady=(10, 0))
        self.columnconfigure(0, weight=1)

    def _group(self, row: int, heading: str, values: list[tuple[str, str]]) -> int:
        ttk.Label(self, text=heading, style="Heading.TLabel").grid(row=row, column=0, sticky="w", pady=(8, 2))
        row += 1
        for label, value in values:
            ttk.Radiobutton(self, text=label, value=value, variable=self.tool_var,
                            command=self._choose_tool).grid(row=row, column=0, sticky="w")
            row += 1
        return row

    def _choose_tool(self) -> None:
        self.on_tool(self.tool_var.get())

    def set_tool(self, tool: str) -> None:
        self.tool_var.set(tool)
        self.on_tool(tool)

    def layer_state(self) -> dict[str, bool]:
        return {name: value.get() for name, value in self.layer_vars.items()}

    def set_prefabs(self, display_names: list[str]) -> None:
        self.prefab_combo["values"] = display_names
        if display_names and self.prefab_var.get() not in display_names:
            self.prefab_var.set(display_names[0])
