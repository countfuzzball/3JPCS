from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from scenery_editor.model.validation import ValidationError


def read_json(path: str | Path) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot read JSON {path}: {exc}") from exc


def write_json_atomic(path: str | Path, document: Any) -> None:
    destination = Path(path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(document, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    fd, temporary_name = tempfile.mkstemp(prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, destination)
    except Exception:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def portable_source_path(source: str | None, project_path: Path) -> str | None:
    if source is None:
        return None
    source_path = Path(source).resolve()
    try:
        return os.path.relpath(source_path, project_path.parent).replace("\\", "/")
    except ValueError:
        return str(source_path)


def resolve_source_path(source: str | None, project_path: Path) -> Path | None:
    if source is None:
        return None
    candidate = Path(source)
    if not candidate.is_absolute():
        candidate = project_path.parent / candidate
    return candidate.resolve()
