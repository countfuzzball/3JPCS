from __future__ import annotations

import numpy as np
from PIL import Image

from scenery_editor.model.terrain_reference import TerrainReference


def _elevation_colors(terrain: TerrainReference) -> np.ndarray:
    heights = terrain.heights.astype(np.float64)
    span = max(1e-9, terrain.maximum_elevation_m - terrain.minimum_elevation_m)
    normalized = np.clip((heights - terrain.minimum_elevation_m) / span, 0.0, 1.0)
    land_span = max(1e-9, terrain.maximum_elevation_m - terrain.sea_level_m)
    land = np.clip((heights - terrain.sea_level_m) / land_span, 0.0, 1.0)
    sea_span = max(1e-9, terrain.sea_level_m - terrain.minimum_elevation_m)
    water = np.clip((terrain.sea_level_m - heights) / sea_span, 0.0, 1.0)
    rgb = np.empty((*heights.shape, 3), dtype=np.float64)
    rgb[..., 0] = np.where(heights < terrain.sea_level_m, 40 - 15 * water, 62 + 155 * land)
    rgb[..., 1] = np.where(heights < terrain.sea_level_m, 105 - 30 * water, 105 + 120 * land)
    rgb[..., 2] = np.where(heights < terrain.sea_level_m, 165 - 35 * water, 58 + 155 * land)
    rgb += normalized[..., None] * 7.0
    return np.clip(rgb, 0, 255)


def _hillshade(terrain: TerrainReference) -> np.ndarray:
    dz, dx = np.gradient(terrain.heights.astype(np.float64), terrain.spacing_m, terrain.spacing_m)
    slope = np.pi / 2.0 - np.arctan(np.hypot(dx, dz))
    aspect = np.arctan2(-dx, dz)
    altitude = np.radians(42.0)
    azimuth = np.radians(315.0)
    shade = np.sin(altitude) * np.sin(slope) + np.cos(altitude) * np.cos(slope) * np.cos(azimuth - aspect)
    return np.clip((shade + 1.0) / 2.0, 0.0, 1.0)


def _contour_mask(terrain: TerrainReference, interval_m: float | None = None) -> np.ndarray:
    heights = terrain.heights.astype(np.float64)
    if interval_m is None:
        span = max(1.0, float(np.max(heights) - np.min(heights)))
        candidates = np.array([1, 2, 5, 10, 20, 50, 100, 200, 500], dtype=float)
        interval_m = float(candidates[np.argmin(np.abs(candidates - span / 18.0))])
    bands = np.floor(heights / interval_m)
    mask = np.zeros_like(bands, dtype=bool)
    mask[:, 1:] |= bands[:, 1:] != bands[:, :-1]
    mask[1:, :] |= bands[1:, :] != bands[:-1, :]
    return mask


def build_terrain_preview(terrain: TerrainReference, show_terrain: bool = True,
                          show_hillshade: bool = True, show_contours: bool = True) -> Image.Image:
    if show_terrain:
        rgb = _elevation_colors(terrain)
    else:
        rgb = np.full((*terrain.heights.shape, 3), 38.0)
    if show_hillshade:
        shade = _hillshade(terrain)
        rgb *= (0.58 + 0.62 * shade[..., None])
    if show_contours:
        mask = _contour_mask(terrain)
        rgb[mask] = rgb[mask] * 0.38
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), mode="RGB")
