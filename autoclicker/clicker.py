"""Auto clicker driven by a JSON config.

Clicks at the current mouse position on an interval. Uses pydirectinput
(SendInput) so clicks register in DirectX games.

Usage:
    python clicker.py <config-name-or-path>
    python clicker.py --list

Stop with Ctrl+C in the console, or press the configured stop_hotkey
(default: F12) from anywhere.
"""
from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pydirectinput
import keyboard as kb_listener

pydirectinput.PAUSE = 0.0
pydirectinput.FAILSAFE = False

CONFIGS_DIR = Path(__file__).parent / "configs"

_stop_event = threading.Event()


def _resolve_config(name: str) -> Path:
    p = Path(name)
    if p.is_file():
        return p
    candidate = CONFIGS_DIR / name
    if candidate.is_file():
        return candidate
    candidate_json = CONFIGS_DIR / f"{name}.json"
    if candidate_json.is_file():
        return candidate_json
    raise FileNotFoundError(f"Config not found: {name}")


def _sleep_interruptible(seconds: float) -> bool:
    if seconds <= 0:
        return not _stop_event.is_set()
    return not _stop_event.wait(seconds)


def _click(button: str, hold: float) -> None:
    # Explicit down -> sleep -> up. Some games miss a zero-duration click
    # because they sample the mouse state once per frame.
    pydirectinput.mouseDown(button=button)
    if hold > 0:
        time.sleep(hold)
    pydirectinput.mouseUp(button=button)


def _run_config(cfg: dict[str, Any]) -> None:
    button = str(cfg.get("button", "left")).lower()
    if button not in {"left", "right", "middle"}:
        raise ValueError(f"Unsupported button: {button!r} (expected left/right/middle)")

    interval = float(cfg.get("interval", 0.5))
    if interval < 0:
        raise ValueError("interval must be >= 0")

    hold = float(cfg.get("click_hold", 0.05))
    if hold < 0:
        raise ValueError("click_hold must be >= 0")

    max_clicks = cfg.get("max_clicks")
    max_clicks = int(max_clicks) if max_clicks else None

    start_delay = float(cfg.get("start_delay", 3.0))
    name = cfg.get("name", "clicker")

    print(f"\n>> Running '{name}' (button={button}, interval={interval}s, click_hold={hold}s"
          + (f", max_clicks={max_clicks}" if max_clicks else ", unlimited")
          + ")")
    if start_delay > 0:
        print(f">> Starting in {start_delay}s -- move the mouse to the target...")
        if not _sleep_interruptible(start_delay):
            return

    count = 0
    while not _stop_event.is_set():
        _click(button, hold)
        count += 1
        print(f"  click #{count} ({button})")
        if max_clicks is not None and count >= max_clicks:
            print(f">> Reached max_clicks ({max_clicks}).")
            break
        if not _sleep_interruptible(interval):
            break

    print(f">> Done. Total clicks: {count}")


def _request_stop(reason: str) -> None:
    if not _stop_event.is_set():
        print(f"\n>> Stop requested ({reason}).")
        _stop_event.set()


def _install_stop_hotkey(hotkey: str) -> None:
    try:
        kb_listener.add_hotkey(hotkey, lambda: _request_stop(f"hotkey {hotkey}"))
        print(f">> Emergency stop hotkey: {hotkey}")
    except Exception as e:
        print(f">> Warning: could not register stop hotkey '{hotkey}': {e}")


def main() -> int:
    parser = argparse.ArgumentParser(description="JSON-driven auto clicker.")
    parser.add_argument("config", nargs="?", help="Config name (in configs/) or path to JSON file.")
    parser.add_argument("--list", action="store_true", help="List available configs and exit.")
    args = parser.parse_args()

    if args.list or not args.config:
        if not CONFIGS_DIR.exists():
            print("No configs directory.")
            return 0
        files = sorted(CONFIGS_DIR.glob("*.json"))
        if not files:
            print("No configs found.")
            return 0
        print("Available configs:")
        for f in files:
            print(f"  - {f.stem}")
        return 0

    cfg_path = _resolve_config(args.config)
    with cfg_path.open("r", encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.setdefault("name", cfg_path.stem)

    stop_hotkey = str(cfg.get("stop_hotkey", "f12"))
    _install_stop_hotkey(stop_hotkey)

    signal.signal(signal.SIGINT, lambda *_: _request_stop("Ctrl+C"))

    try:
        _run_config(cfg)
    finally:
        try:
            kb_listener.unhook_all_hotkeys()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
