import argparse
import subprocess
import sys
from pathlib import Path

def run(cmd):
    print("[RUN]", " ".join(cmd))
    return subprocess.run(cmd, cwd=Path.cwd(), text=True, capture_output=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True)
    args = parser.parse_args()
    root = Path.cwd()
    report_dir = root / "reports" / "phase_reports"
    report_dir.mkdir(parents=True, exist_ok=True)

    checks = [
        ("py_compile", run([sys.executable, "-m", "py_compile", "run.py"])),
        ("verify_imports", run([sys.executable, "scripts/verify_imports.py"])),
    ]

    ok = True
    report = report_dir / f"{args.phase}_gate_report.md"
    with report.open("w", encoding="utf-8") as f:
        f.write(f"# Phase Gate Report: {args.phase}\n\n")
        for name, result in checks:
            passed = result.returncode == 0
            ok = ok and passed
            f.write(f"## {name}\n")
            f.write("PASS\n\n" if passed else "FAIL\n\n")
            out = (result.stdout or "") + "\n" + (result.stderr or "")
            if out.strip():
                f.write("```text\n")
                f.write(out[-5000:])
                f.write("\n```\n\n")
        f.write(f"# FINAL: {'PASS' if ok else 'FAIL'}\n")
    print(f"[INFO] Report written: {report}")
    if not ok:
        raise SystemExit("[FAIL] phase gate failed")
    print("[PASS] phase gate passed")

if __name__ == "__main__":
    main()
