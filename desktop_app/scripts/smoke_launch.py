import subprocess
import sys
import time
from pathlib import Path

def main():
    root = Path.cwd()
    target = root / "run.py"
    if not target.exists():
        raise SystemExit("[FAIL] run.py not found")
    proc = subprocess.Popen([sys.executable, str(target)], cwd=root)
    time.sleep(5)
    if proc.poll() is not None:
        raise SystemExit(f"[FAIL] app exited early with code {proc.returncode}")
    proc.terminate()
    print("[PASS] app launched and stayed alive for 5 seconds")

if __name__ == "__main__":
    main()
