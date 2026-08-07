# autoclicker

JSON-driven auto clicker for Windows. Clicks at the **current mouse position**
on a fixed interval. Uses `pydirectinput-rgx` (SendInput) so clicks register
in DirectX games.

## Setup

The venv lives in `./.venv`, deps already installed. To recreate:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Run

```powershell
.\.venv\Scripts\python.exe clicker.py left_fast
.\.venv\Scripts\python.exe clicker.py right_slow
.\.venv\Scripts\python.exe clicker.py --list
```

`start_delay` gives you time to move the mouse to the target before clicking
begins.

**Stop:** Press `F12` from anywhere, or Ctrl+C in the console.

## Config format

```jsonc
{
  "name": "my_clicker",   // optional, defaults to filename
  "button": "left",       // "left" | "right" | "middle"
  "interval": 0.1,        // seconds between clicks
  "click_hold": 0.05,     // seconds to hold the button down (default 0.05).
                          //   Many games miss zero-duration clicks; bump to
                          //   0.08-0.15 if presses still don't register.
  "max_clicks": 100,      // optional, stops after N clicks (omit for unlimited)
  "start_delay": 3.0,     // seconds before first click
  "stop_hotkey": "f12"    // global panic hotkey
}
```

## Game not registering clicks?

1. **Run elevated.** If the game runs as administrator (most launchers from
   Battle.net/Steam/Epic do not, but anti-cheat layers and some MMOs do),
   Windows blocks synthetic input from non-elevated processes (UIPI).
   Right-click the launcher (or this script's terminal) → *Run as
   administrator*.
2. **Increase `click_hold`.** Some games poll the mouse once per frame;
   raise `click_hold` to `0.08`–`0.15`.
3. **Fullscreen-exclusive mode** can also drop synthetic input on some
   titles — try borderless windowed if so.
