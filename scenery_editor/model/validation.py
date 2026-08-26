from __future__ import annotations

import math
import uuid
from collections.abc import Iterable, Mapping
from typing import Any


class ValidationError(ValueError):
    """Raised when an external or authored document violates its contract."""


def require_exact_keys(value: Mapping[str, Any], expected: set[str], context: str) -> None:
    if not isinstance(value, Mapping):
        raise ValidationError(f"{context} must be an object")
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        unknown = sorted(actual - expected)
        details = []
        if missing:
            details.append(f"missing {missing}")
        if unknown:
            details.append(f"unknown {unknown}")
        raise ValidationError(f"{context} has invalid fields: {', '.join(details)}")


def finite_number(value: Any, context: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{context} must be a number")
    result = float(value)
    if not math.isfinite(result):
        raise ValidationError(f"{context} must be finite")
    return result


def positive_number(value: Any, context: str) -> float:
    result = finite_number(value, context)
    if result <= 0:
        raise ValidationError(f"{context} must be greater than zero")
    return result


def non_negative_number(value: Any, context: str) -> float:
    result = finite_number(value, context)
    if result < 0:
        raise ValidationError(f"{context} must be zero or greater")
    return result


def non_empty_string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{context} must be a non-empty string")
    return value.strip()


def uuid_string(value: Any, context: str) -> str:
    text = non_empty_string(value, context)
    try:
        return str(uuid.UUID(text))
    except (ValueError, AttributeError) as exc:
        raise ValidationError(f"{context} must be a UUID") from exc


def point_list(value: Any, minimum: int, width: float, depth: float, context: str) -> list[tuple[float, float]]:
    if not isinstance(value, list) or len(value) < minimum:
        raise ValidationError(f"{context} must contain at least {minimum} points")
    points: list[tuple[float, float]] = []
    for index, point in enumerate(value):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValidationError(f"{context}[{index}] must be [x_m, z_m]")
        x = finite_number(point[0], f"{context}[{index}].x")
        z = finite_number(point[1], f"{context}[{index}].z")
        if not 0.0 <= x <= width or not 0.0 <= z <= depth:
            raise ValidationError(f"{context}[{index}] is outside the terrain world")
        points.append((x, z))
    return points


def ensure_unique(values: Iterable[str], context: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValidationError(f"duplicate {context}: {value}")
        seen.add(value)
