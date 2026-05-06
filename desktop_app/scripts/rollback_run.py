import argparse
import shutil
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--backup")
    args = parser.parse_args()
    root = Path.cwd()
    backup_dir = root / "backups"
    if args.list:
        for p in sorted(backup_dir.glob("run_before_*.py")) if backup_dir.exists() else []:
            print(p)
        return
    if not args.backup:
        raise SystemExit("Use --list or --backup <path>")
    src = Path(args.backup)
    if not src.exists():
        raise SystemExit(f"[FAIL] Backup not found: {src}")
    shutil.copy2(src, root / "run.py")
    print(f"[PASS] Restored run.py from {src}")

if __name__ == "__main__":
    main()
