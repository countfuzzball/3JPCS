from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .project import SceneryProject


@dataclass
class SnapshotCommand:
    label: str
    before: dict[str, Any]
    after: dict[str, Any]

    def undo(self, project: SceneryProject) -> None:
        project.restore_authored_snapshot(self.before)

    def redo(self, project: SceneryProject) -> None:
        project.restore_authored_snapshot(self.after)


class CommandHistory:
    def __init__(self) -> None:
        self._undo: list[SnapshotCommand] = []
        self._redo: list[SnapshotCommand] = []

    def clear(self) -> None:
        self._undo.clear()
        self._redo.clear()

    def record(self, label: str, before: dict[str, Any], after: dict[str, Any]) -> None:
        if before == after:
            return
        self._undo.append(SnapshotCommand(label, before, after))
        self._redo.clear()

    def undo(self, project: SceneryProject) -> str | None:
        if not self._undo:
            return None
        command = self._undo.pop()
        command.undo(project)
        self._redo.append(command)
        return command.label

    def redo(self, project: SceneryProject) -> str | None:
        if not self._redo:
            return None
        command = self._redo.pop()
        command.redo(project)
        self._undo.append(command)
        return command.label

    @property
    def can_undo(self) -> bool:
        return bool(self._undo)

    @property
    def can_redo(self) -> bool:
        return bool(self._redo)
