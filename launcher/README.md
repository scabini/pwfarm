# launcher

Tiny Tkinter UI to pick and run any automation in this repo.

## How discovery works

The UI scans **sibling directories** of `launcher/` for a `launcher.json`
manifest:

```json
{
  "title": "Keypress Macro",
  "entry": "macro_runner.py",
  "description": "What this automation does."
}
```

For each manifest it finds, the automation must also have:

- `.venv/Scripts/python.exe` (its own venv)
- `configs/*.json` (the JSON configs the entry script accepts)

The selected automation is run as a **subprocess** using *its own venv's*
Python — env isolation is preserved.

## Run

Double-click `run.bat`, or:

```powershell
.\.venv\Scripts\pythonw.exe app.py
```

(`pythonw.exe` hides the console; use `python.exe` if you want a console
attached.)

The launcher itself only uses stdlib (Tkinter ships with Python on Windows),
so the venv is empty by default.

## UI

- **Automation** dropdown — auto-discovered from sibling dirs.
- **Config** dropdown — populated from the selected automation's `configs/`.
- **Start** — launches the subprocess and streams stdout into the log pane.
- **Stop** — sends Ctrl+Break to the child process group (lets the child's
  `finally` block run — releases the global F12 hotkey, etc.). If it doesn't
  exit within 2s, it's force-killed.
- **Refresh** — rescan for new automations / configs (only when idle).

The per-automation F12 panic hotkey still works regardless of whether you
stop from the UI.

## Adding a new automation

1. Make a sibling dir with its own `.venv` and `configs/*.json`.
2. Ensure its entry script takes a config name as the first arg.
3. Drop a `launcher.json` next to the entry script.
4. Hit **Refresh** in the UI.
