from __future__ import annotations

import subprocess
import sys
import time
import urllib.request
import webbrowser
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DESKTOP_APP_DIR = ROOT / "desktop_app"
PLAIN_WEB_APP_DIR = ROOT / "web_content_app_plain"
TRANSCRIPT_TOOL = ROOT / "tools" / "u_scrp.py"
WEB_URL = "http://127.0.0.1:3000/?v=20260527-ffmpeg-render-v2"
BACKEND_URL = "http://127.0.0.1:8000/"
BACKEND_CAPABILITIES_URL = "http://127.0.0.1:8000/api/system/capabilities"


def run_desktop_app() -> int:
    return subprocess.call([sys.executable, "run.py"], cwd=str(DESKTOP_APP_DIR))


def run_transcript_tool() -> int:
    return subprocess.call([sys.executable, str(TRANSCRIPT_TOOL)], cwd=str(TRANSCRIPT_TOOL.parent))


def run_web_app() -> int:
    return subprocess.call(
        [sys.executable, "-m", "http.server", "3000", "--bind", "127.0.0.1"],
        cwd=str(PLAIN_WEB_APP_DIR),
    )


def _url_ready(url: str, timeout: float = 0.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 400
    except Exception:
        return False


def _wait_until_ready(url: str, timeout_sec: float = 8.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if _url_ready(url):
            return True
        time.sleep(0.35)
    return False


def _backend_supports_current_features() -> bool:
    try:
        with urllib.request.urlopen(BACKEND_CAPABILITIES_URL, timeout=0.6) as response:
            if not (200 <= response.status < 400):
                return False
            data = json.loads(response.read().decode("utf-8"))
            return bool(data.get("asset_save") and data.get("open_folder"))
    except Exception:
        return False


def _listening_pids_on_port(port: int) -> list[int]:
    if sys.platform != "win32":
        return []
    result = subprocess.run(
        ["netstat", "-ano", "-p", "tcp"],
        check=False,
        capture_output=True,
        text=True,
    )
    pids: set[int] = set()
    suffix = f":{port}"
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP":
            continue
        local_addr, state, pid_text = parts[1], parts[3].upper(), parts[4]
        if state == "LISTENING" and local_addr.endswith(suffix) and pid_text.isdigit():
            pids.add(int(pid_text))
    return sorted(pids)


def _terminate_backend_port_owners() -> None:
    for pid in _listening_pids_on_port(8000):
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    time.sleep(0.4)


def run_unified_web_app() -> int:
    processes: list[subprocess.Popen] = []
    try:
        if _url_ready(BACKEND_URL) and not _backend_supports_current_features():
            print("Old backend detected on port 8000. Restarting it...")
            _terminate_backend_port_owners()

        if not _url_ready(BACKEND_URL):
            processes.append(
                subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        "backend.main:app",
                        "--port",
                        "8000",
                        "--host",
                        "127.0.0.1",
                    ],
                    cwd=str(ROOT),
                )
            )
        if not _url_ready(WEB_URL):
            processes.append(
                subprocess.Popen(
                    [sys.executable, "-m", "http.server", "3000", "--bind", "127.0.0.1"],
                    cwd=str(PLAIN_WEB_APP_DIR),
                )
            )

        backend_ok = _wait_until_ready(BACKEND_URL)
        web_ok = _wait_until_ready(WEB_URL)
        if web_ok:
            webbrowser.open(WEB_URL)
        if backend_ok and web_ok:
            print("Unified web app is ready:", WEB_URL)
        else:
            print("Startup is delayed. Check backend/server logs.")

        for proc in processes:
            proc.wait()
        return 0 if backend_ok and web_ok else 1
    except KeyboardInterrupt:
        return 0
    finally:
        for proc in processes:
            if proc.poll() is None:
                proc.terminate()


def main() -> int:
    print("YouTube Unified: starting the unified web app...")
    return run_unified_web_app()


if __name__ == "__main__":
    raise SystemExit(main())
