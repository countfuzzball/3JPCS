# Python/Tkinter reference implementation

This directory preserves the Polygon County Scenery Editor v0.2 prototype as a
behavioural and data-contract reference for the Three.js editor. The production web
application does not import, execute, or package any file in this directory.

It contains:

- `scenery_editor/`: the original Tkinter application and Python domain/I/O code;
- `schemas/`: the Python-era project, catalogue, and runtime schema contracts;
- `tests/`: the 45 compatibility tests for that implementation;
- `main.py`: the standalone Tkinter entry point; and
- `pyproject.toml` and `requirements.txt`: its isolated Python configuration.

Run it from this directory:

```powershell
python -m pip install -r requirements.txt
python main.py
# or: python -m scenery_editor
```

Run its tests independently:

```powershell
python -m pytest -q
```

Python cache directories are generated locally, ignored by Git, and never form part
of either application contract.

## License

This preserved reference implementation is licensed under the GNU General Public
License version 3 or later (`GPL-3.0-or-later`). See the repository
[LICENSE](../LICENSE).
