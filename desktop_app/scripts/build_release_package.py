from pathlib import Path
from datetime import datetime
import zipfile

def main():
    root = Path.cwd()
    dist = root / "dist"
    dist.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    out = dist / f"YouTubeMovie_Release_{stamp}.zip"
    include_patterns = ["run.py", "requirements.txt", "README*.md", "CHANGELOG.md"]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for pattern in include_patterns:
            for p in root.glob(pattern):
                if p.is_file():
                    zf.write(p, p.name)
        for folder in ["settings", "samples", "bat"]:
            fp = root / folder
            if fp.exists():
                for p in fp.rglob("*"):
                    if p.is_file():
                        zf.write(p, str(p.relative_to(root)))
    print(f"[PASS] release package created: {out}")

if __name__ == "__main__":
    main()
