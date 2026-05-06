from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DESKTOP_APP_DIR = ROOT / "desktop_app"
WEB_APP_DIR = ROOT / "web_content_app"
PLAIN_WEB_APP_DIR = ROOT / "web_content_app_plain"
TRANSCRIPT_TOOL = ROOT / "tools" / "u_scrp.py"


def run_desktop_app() -> int:
    return subprocess.call([sys.executable, "run.py"], cwd=str(DESKTOP_APP_DIR))


def run_transcript_tool() -> int:
    return subprocess.call([sys.executable, str(TRANSCRIPT_TOOL)], cwd=str(TRANSCRIPT_TOOL.parent))


def run_web_app() -> int:
    return subprocess.call(
        [sys.executable, "-m", "http.server", "3000", "--bind", "127.0.0.1"],
        cwd=str(PLAIN_WEB_APP_DIR),
    )


def main() -> int:
    while True:
        print("\nYouTube Unified")
        print("1. Desktop video automation app")
        print("2. Web content automation app")
        print("3. YouTube transcript extractor")
        print("0. Exit")
        choice = input("Select: ").strip()
        if choice == "1":
            return run_desktop_app()
        if choice == "2":
            return run_web_app()
        if choice == "3":
            return run_transcript_tool()
        if choice == "0":
            return 0
        print("Invalid selection.")


if __name__ == "__main__":
    raise SystemExit(main())
