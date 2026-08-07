"""pwfarm automations launcher.

Tkinter UI that discovers sibling automation dirs containing:
  - launcher.json  (manifest: title, entry, description)
  - .venv/Scripts/python.exe
  - configs/*.json

Pick an automation + config, hit Start, and the UI runs the automation
as a subprocess using *its own* venv. Stop terminates the process tree.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import ttk, scrolledtext
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
SELF_DIR = Path(__file__).resolve().parent

CREATE_NO_WINDOW = 0x08000000  # suppress new console window for the child


class Automation:
    def __init__(self, path: Path, manifest: dict):
        self.path = path
        self.title = manifest.get("title", path.name)
        self.entry = manifest.get("entry")
        self.description = manifest.get("description", "")

    @property
    def venv_python(self) -> Path:
        if sys.platform == "win32":
            return self.path / ".venv" / "Scripts" / "python.exe"
        return self.path / ".venv" / "bin" / "python"

    @property
    def entry_script(self) -> Path:
        return self.path / self.entry

    @property
    def configs_dir(self) -> Path:
        return self.path / "configs"

    def list_configs(self) -> list[str]:
        if not self.configs_dir.is_dir():
            return []
        return sorted(p.stem for p in self.configs_dir.glob("*.json"))

    def is_runnable(self) -> tuple[bool, str]:
        if not self.entry:
            return False, "manifest missing 'entry'"
        if not self.entry_script.is_file():
            return False, f"entry script not found: {self.entry}"
        if not self.venv_python.is_file():
            return False, "venv python not found (.venv/Scripts/python.exe)"
        return True, ""


def discover_automations() -> list[Automation]:
    found = []
    for child in sorted(ROOT.iterdir()):
        if not child.is_dir() or child == SELF_DIR:
            continue
        manifest_path = child / "launcher.json"
        if not manifest_path.is_file():
            continue
        try:
            with manifest_path.open("r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            continue
        found.append(Automation(child, manifest))
    return found


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("pwfarm — automations")
        self.root.geometry("760x560")
        self.root.minsize(620, 420)

        self.automations: list[Automation] = discover_automations()
        self.proc: Optional[subprocess.Popen] = None
        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.reader_thread: Optional[threading.Thread] = None

        self._build_ui()
        self._populate_automations()
        self.root.after(80, self._drain_log_queue)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # --- UI construction ---

    def _build_ui(self) -> None:
        pad = {"padx": 8, "pady": 4}

        top = ttk.Frame(self.root)
        top.pack(fill="x", **pad)

        ttk.Label(top, text="Automation:").grid(row=0, column=0, sticky="w")
        self.cb_auto = ttk.Combobox(top, state="readonly", width=38)
        self.cb_auto.grid(row=0, column=1, sticky="we", padx=(4, 12))
        self.cb_auto.bind("<<ComboboxSelected>>", self._on_auto_change)

        ttk.Label(top, text="Config:").grid(row=0, column=2, sticky="w")
        self.cb_cfg = ttk.Combobox(top, state="readonly", width=28)
        self.cb_cfg.grid(row=0, column=3, sticky="we", padx=(4, 0))

        top.columnconfigure(1, weight=1)
        top.columnconfigure(3, weight=1)

        desc = ttk.Frame(self.root)
        desc.pack(fill="x", **pad)
        self.lbl_desc = ttk.Label(desc, text="", wraplength=720, justify="left", foreground="#555")
        self.lbl_desc.pack(fill="x")

        buttons = ttk.Frame(self.root)
        buttons.pack(fill="x", **pad)
        self.btn_start = ttk.Button(buttons, text="Start", command=self._start)
        self.btn_start.pack(side="left")
        self.btn_stop = ttk.Button(buttons, text="Stop", command=self._stop, state="disabled")
        self.btn_stop.pack(side="left", padx=6)
        self.btn_refresh = ttk.Button(buttons, text="Refresh", command=self._refresh)
        self.btn_refresh.pack(side="left", padx=6)
        self.lbl_status = ttk.Label(buttons, text="Idle", foreground="#888")
        self.lbl_status.pack(side="right")

        log_frame = ttk.LabelFrame(self.root, text="Log")
        log_frame.pack(fill="both", expand=True, padx=8, pady=(4, 4))
        self.txt_log = scrolledtext.ScrolledText(
            log_frame, height=18, wrap="word", state="disabled",
            font=("Consolas", 10),
        )
        self.txt_log.pack(fill="both", expand=True)

        bottom = ttk.Frame(self.root)
        bottom.pack(fill="x", **pad)
        ttk.Button(bottom, text="Clear log", command=self._clear_log).pack(side="left")
        ttk.Label(
            bottom,
            text="Tip: each automation has its own F12 panic-stop hotkey.",
            foreground="#888",
        ).pack(side="right")

    # --- data wiring ---

    def _populate_automations(self) -> None:
        labels = []
        for a in self.automations:
            ok, why = a.is_runnable()
            label = a.title if ok else f"{a.title}  [unavailable: {why}]"
            labels.append(label)
        self.cb_auto["values"] = labels
        if labels:
            self.cb_auto.current(0)
            self._on_auto_change()
        else:
            self.cb_cfg["values"] = []
            self.lbl_desc.config(text="No automations found. Add a launcher.json manifest to a sibling directory.")

    def _selected_automation(self) -> Optional[Automation]:
        idx = self.cb_auto.current()
        if idx < 0 or idx >= len(self.automations):
            return None
        return self.automations[idx]

    def _on_auto_change(self, _evt=None) -> None:
        a = self._selected_automation()
        if a is None:
            return
        self.lbl_desc.config(text=a.description or "")
        cfgs = a.list_configs()
        self.cb_cfg["values"] = cfgs
        if cfgs:
            self.cb_cfg.current(0)
        else:
            self.cb_cfg.set("")

    def _refresh(self) -> None:
        if self.proc is not None:
            self._append_log(">> Cannot refresh while a job is running.\n")
            return
        self.automations = discover_automations()
        self._populate_automations()
        self._append_log(">> Refreshed.\n")

    # --- run/stop ---

    def _start(self) -> None:
        if self.proc is not None:
            return
        a = self._selected_automation()
        if a is None:
            self._append_log(">> No automation selected.\n")
            return
        ok, why = a.is_runnable()
        if not ok:
            self._append_log(f">> Automation not runnable: {why}\n")
            return
        cfg = self.cb_cfg.get().strip()
        if not cfg:
            self._append_log(">> No config selected.\n")
            return

        cmd = [str(a.venv_python), str(a.entry_script), cfg]
        self._append_log(f">> Launching: {a.title} / {cfg}\n")
        self._append_log(f"   cwd={a.path}\n")

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        creationflags = 0
        if sys.platform == "win32":
            creationflags = CREATE_NO_WINDOW

        try:
            self.proc = subprocess.Popen(
                cmd,
                cwd=str(a.path),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                bufsize=1,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                creationflags=creationflags,
            )
        except Exception as e:
            self._append_log(f">> Failed to launch: {e}\n")
            self.proc = None
            return

        self.btn_start.config(state="disabled")
        self.btn_stop.config(state="normal")
        self.cb_auto.config(state="disabled")
        self.cb_cfg.config(state="disabled")
        self.lbl_status.config(text="Running", foreground="#0a0")

        self.reader_thread = threading.Thread(
            target=self._read_proc_output, args=(self.proc,), daemon=True
        )
        self.reader_thread.start()

    def _stop(self) -> None:
        if self.proc is None:
            return
        self._append_log(">> Stop requested by UI.\n")
        try:
            self.proc.terminate()
        except Exception as e:
            self._append_log(f">> Stop error: {e}\n")

        def _ensure_dead(p: subprocess.Popen) -> None:
            try:
                p.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                try:
                    p.kill()
                except Exception:
                    pass

        threading.Thread(target=_ensure_dead, args=(self.proc,), daemon=True).start()

    def _read_proc_output(self, proc: subprocess.Popen) -> None:
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                self.log_queue.put(line)
        except Exception as e:
            self.log_queue.put(f">> Reader error: {e}\n")
        finally:
            rc = proc.wait()
            self.log_queue.put(f"\n>> Process exited with code {rc}\n")
            self.log_queue.put("__JOB_DONE__")

    # --- log plumbing ---

    def _drain_log_queue(self) -> None:
        try:
            while True:
                item = self.log_queue.get_nowait()
                if item == "__JOB_DONE__":
                    self._on_job_done()
                else:
                    self._append_log(item)
        except queue.Empty:
            pass
        finally:
            self.root.after(80, self._drain_log_queue)

    def _append_log(self, text: str) -> None:
        self.txt_log.config(state="normal")
        self.txt_log.insert("end", text)
        self.txt_log.see("end")
        self.txt_log.config(state="disabled")

    def _clear_log(self) -> None:
        self.txt_log.config(state="normal")
        self.txt_log.delete("1.0", "end")
        self.txt_log.config(state="disabled")

    def _on_job_done(self) -> None:
        self.proc = None
        self.btn_start.config(state="normal")
        self.btn_stop.config(state="disabled")
        self.cb_auto.config(state="readonly")
        self.cb_cfg.config(state="readonly")
        self.lbl_status.config(text="Idle", foreground="#888")

    def _on_close(self) -> None:
        if self.proc is not None:
            try:
                self.proc.kill()
            except Exception:
                pass
        self.root.destroy()


def main() -> int:
    root = tk.Tk()
    try:
        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")
    except Exception:
        pass
    App(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
