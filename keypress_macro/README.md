# keypress_macro

JSON-driven keypress automation for Windows. Built for games: uses
`pydirectinput-rgx` which sends scan codes via `SendInput`, so presses register
in DirectX titles that ignore `keyboard` / `pynput` virtual-key events.

## Setup

The venv lives in `./.venv`. It is already created with deps installed.
To recreate from scratch:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Run

```powershell
.\.venv\Scripts\python.exe macro_runner.py loop_rotation
.\.venv\Scripts\python.exe macro_runner.py static_intro
.\.venv\Scripts\python.exe macro_runner.py --list
```

The script accepts a config name (resolves to `configs/<name>.json`) or a
direct path to a JSON file.

**Stop:** Press `F12` from anywhere, or Ctrl+C in the console.
(`stop_hotkey` is per-config, defaults to `f12`.)

The script prints a `start_delay` countdown — focus the target window
during that window.

## Config format

```jsonc
{
  "name": "my_macro",        // optional, defaults to filename
  "loop": true,              // repeat the steps forever (until stop)
  "start_delay": 3.0,        // seconds before first step (focus the game!)
  "loop_delay": 0.5,         // seconds between loop iterations (loop=true only)
  "stop_hotkey": "f12",      // global hotkey to abort
  "steps": [
    { "key": "1", "delay_after": 0.5 },             // tap key, then wait
    { "key": "w", "hold": 1.5, "delay_after": 0.2 },// hold key for 1.5s, then wait
    { "keys": ["shift", "5"], "delay_after": 0.3 }, // press chord (down in order, up reversed)
    { "wait": 2.0 },                                 // pure pause
    { "key": "space", "repeat": 3, "delay_after": 0.1 } // repeat N times
  ]
}
```

### Step fields

- `key` — single key name (pydirectinput names: letters, digits, `space`,
  `enter`, `tab`, `esc`, `shift`, `ctrl`, `alt`, `f1`..`f12`, `up`/`down`/`left`/`right`,
  `home`, `end`, `pageup`, `pagedown`, etc.)
- `keys` — array of keys pressed as a chord (e.g. `["ctrl", "c"]`)
- `wait` — seconds to sleep, no key press
- `hold` — seconds to hold the key/chord down (default `0`, i.e. instant tap)
- `delay_after` — seconds to wait after the step (default `0`)
- `repeat` — integer, how many times to execute this step back-to-back (default `1`)

### Top-level fields

- `loop` — `true` repeats `steps` forever; `false` runs once.
- `start_delay` — countdown before first key, lets you alt-tab into the game.
- `loop_delay` — wait between iterations when `loop: true`.
- `stop_hotkey` — global panic key. Default `f12`. Examples: `"esc"`,
  `"ctrl+shift+q"`.

## Notes

- The `keyboard` library needs **admin rights on some systems** to register
  the global stop hotkey. If hotkey registration fails the script still runs —
  use Ctrl+C in the console to stop.
- `pydirectinput` is keyboard-only here; mouse input is a separate concern.
- Keys are lowercased before being sent.
