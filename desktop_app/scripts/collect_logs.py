from pathlib import Path
from datetime import datetime
import shutil

def main():
    root = Path.cwd()
    out = root / "reports" / "logs_collected" / datetime.now().strftime("%Y%m%d_%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    candidates = []
    if (root / "logs").exists():
        candidates += list((root / "logs").glob("*.log"))
    candidates += list(root.glob("*.log"))
    for p in candidates:
        if p.is_file():
            shutil.copy2(p, out / p.name)
    print(f"[PASS] logs collected to: {out}")

if __name__ == "__main__":
    main()
