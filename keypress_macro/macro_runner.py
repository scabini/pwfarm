"""Loop / static keypress macro driven by JSON configs.

Uses pydirectinput (SendInput + scan codes) so presses register in DirectX games
that ignore the WinAPI keybd_event path used by `keyboard`/`pynput`.

Usage:
    python macro_runner.py <config-name-or-path>
    python macro_runner.py --list

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
    """Sleep that wakes early if stop is requested. Returns False if stopped."""
    if seconds <= 0:
        return not _stop_event.is_set()
    return not _stop_event.wait(seconds)


def _press_chord(keys: list[str], hold: float) -> None:
    for k in keys:
        pydirectinput.keyDown(k)
    if hold > 0:
        _sleep_interruptible(hold)
    for k in reversed(keys):
        pydirectinput.keyUp(k)


def _run_step(step: dict[str, Any], step_index: int) -> None:
    repeat = int(step.get("repeat", 1))
    delay_after = float(step.get("delay_after", 0.0))
    hold = float(step.get("hold", 0.0))

    for r in range(repeat):
        if _stop_event.is_set():
            return

        if "wait" in step:
            wait_s = float(step["wait"])
            print(f"  [step {step_index}] wait {wait_s}s")
            _sleep_interruptible(wait_s)
            continue

        if "keys" in step:
            keys = [str(k).lower() for k in step["keys"]]
            label = "+".join(keys)
            if hold > 0:
                print(f"  [step {step_index}] hold {label} for {hold}s"
                      + (f" (rep {r + 1}/{repeat})" if repeat > 1 else ""))
                _press_chord(keys, hold)
            else:
                print(f"  [step {step_index}] press {label}"
                      + (f" (rep {r + 1}/{repeat})" if repeat > 1 else ""))
                _press_chord(keys, 0.0)
        elif "key" in step:
            key = str(step["key"]).lower()
            if hold > 0:
                print(f"  [step {step_index}] hold {key} for {hold}s"
                      + (f" (rep {r + 1}/{repeat})" if repeat > 1 else ""))
                pydirectinput.keyDown(key)
                _sleep_interruptible(hold)
                pydirectinput.keyUp(key)
            else:
                print(f"  [step {step_index}] press {key}"
                      + (f" (rep {r + 1}/{repeat})" if repeat > 1 else ""))
                pydirectinput.press(key)
        else:
            raise ValueError(f"Step {step_index} has no 'key', 'keys', or 'wait': {step}")

        if delay_after > 0 and not _stop_event.is_set():
            _sleep_interruptible(delay_after)


def _run_config(cfg: dict[str, Any]) -> None:
    steps = cfg.get("steps")
    if not steps or not isinstance(steps, list):
        raise ValueError("Config must contain a non-empty 'steps' list.")

    loop = bool(cfg.get("loop", False))
    start_delay = float(cfg.get("start_delay", 3.0))
    loop_delay = float(cfg.get("loop_delay", 0.0))
    name = cfg.get("name", "macro")

    print(f"\n>> Running '{name}' (loop={loop}, steps={len(steps)})")
    if start_delay > 0:
        print(f">> Starting in {start_delay}s — focus the target window now...")
        if not _sleep_interruptible(start_delay):
            return

    iteration = 0
    while not _stop_event.is_set():
        iteration += 1
        if loop:
            print(f">> Iteration {iteration}")
        for i, step in enumerate(steps, start=1):
            if _stop_event.is_set():
                break
            _run_step(step, i)
        if not loop:
            break
        if loop_delay > 0 and not _stop_event.is_set():
            print(f">> Loop delay {loop_delay}s")
            _sleep_interruptible(loop_delay)

    print(">> Done.")


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
    parser = argparse.ArgumentParser(description="JSON-driven keypress macro runner.")
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
        if not args.config:
            return 0
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
