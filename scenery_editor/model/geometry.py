from __future__ import annotations

import math
from collections.abc import Iterable


Point = tuple[float, float]


def rotate_local_point(x_m: float, z_m: float, rotation_deg: float) -> Point:
    """Rotate using Polygon County's clockwise-positive plan-view convention."""
    angle = math.radians(rotation_deg)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    return cosine * x_m - sine * z_m, sine * x_m + cosine * z_m


def prefab_footprint(
    x_m: float, z_m: float, width_m: float, depth_m: float, rotation_deg: float
) -> list[Point]:
    corners = [
        (-width_m / 2.0, -depth_m / 2.0),
        (width_m / 2.0, -depth_m / 2.0),
        (width_m / 2.0, depth_m / 2.0),
        (-width_m / 2.0, depth_m / 2.0),
    ]
    return [(x_m + dx, z_m + dz) for dx, dz in (rotate_local_point(*p, rotation_deg) for p in corners)]


def prefab_front_marker(
    x_m: float, z_m: float, depth_m: float, rotation_deg: float
) -> tuple[Point, Point]:
    """Return an arrow from the centre toward local -Z (the prefab front)."""
    dx, dz = rotate_local_point(0.0, -depth_m / 2.0, rotation_deg)
    return (x_m, z_m), (x_m + dx, z_m + dz)


def point_in_polygon(point: Point, polygon: Iterable[Point]) -> bool:
    x, z = point
    vertices = list(polygon)
    inside = False
    previous = vertices[-1]
    for current in vertices:
        x1, z1 = previous
        x2, z2 = current
        if (z1 > z) != (z2 > z):
            crossing_x = (x2 - x1) * (z - z1) / (z2 - z1) + x1
            if x < crossing_x:
                inside = not inside
        previous = current
    return inside


def distance_to_segment(point: Point, start: Point, end: Point) -> tuple[float, Point]:
    px, pz = point
    ax, az = start
    bx, bz = end
    dx, dz = bx - ax, bz - az
    length_sq = dx * dx + dz * dz
    if length_sq == 0.0:
        nearest = start
    else:
        t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / length_sq))
        nearest = (ax + t * dx, az + t * dz)
    return math.hypot(px - nearest[0], pz - nearest[1]), nearest


def distance_to_polyline(point: Point, points: list[Point]) -> float:
    return min(distance_to_segment(point, a, b)[0] for a, b in zip(points, points[1:]))
