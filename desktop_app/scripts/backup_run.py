import argparse
import shutil
from pathlib import Path
from datetime import datetime

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", default="MANUAL")
    args = parser.parse_args()
    root = Path.cwd()
    src = root / "run.py"
    if not src.exists():
        raise SystemExit("[FAIL] run.py not found")
    backup_dir = root / "backups"
    backup_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = backup_dir / f"run_before_{args.phase}_{stamp}.py"
    shutil.copy2(src, dst)
    print(f"[PASS] Backup created: {dst}")

if __name__ == "__main__":
    main()
