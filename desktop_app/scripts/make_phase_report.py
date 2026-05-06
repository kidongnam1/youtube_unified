import argparse
from pathlib import Path
from datetime import datetime

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", required=True)
    parser.add_argument("--status", default="UNKNOWN")
    parser.add_argument("--summary", default="")
    args = parser.parse_args()
    report_dir = Path("reports/phase_reports")
    report_dir.mkdir(parents=True, exist_ok=True)
    report = report_dir / f"{args.phase}_manual_report.md"
    report.write_text(f"""# Phase Report: {args.phase}

Generated: {datetime.now().isoformat(timespec='seconds')}

## Status
{args.status}

## Summary
{args.summary}

## Notes
-

""", encoding="utf-8")
    print(f"[PASS] report created: {report}")

if __name__ == "__main__":
    main()
