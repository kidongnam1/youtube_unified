from pathlib import Path
from datetime import datetime

PHASE_GROUPS = {
    "A0 audit completed": ["reports/phase_reports/A0_report.md"],
    "F0 safety layer applied": ["reports/phase_reports/F0_report.md"],
    "A1 regression audit PASS": ["reports/phase_reports/A1_report.md"],
    "YouTube Y0~Y6 PASS": [f"reports/phase_reports/Y{i}_report.md" for i in range(0, 7)],
    "Static Snapshot S0~S5 PASS": [f"reports/phase_reports/S{i}_report.md" for i in range(0, 6)],
    "E0~E5 practical features PASS": [f"reports/phase_reports/E{i}_report.md" for i in range(0, 6)],
    "T0~T5 automated QA PASS": [f"reports/phase_reports/T{i}_report.md" for i in range(0, 6)] + ["reports/final/AUTOMATED_QA_REPORT.md"],
    "L0~L3 diagnostics PASS": [f"reports/phase_reports/L{i}_report.md" for i in range(0, 4)],
    "SEC0~SEC3 security/privacy PASS": [f"reports/phase_reports/SEC{i}_report.md" for i in range(0, 4)],
    "R0~R3 packaging PASS": [f"reports/phase_reports/R{i}_report.md" for i in range(0, 4)],
    "M0~M3 versioning PASS": [f"reports/phase_reports/M{i}_report.md" for i in range(0, 4)],
    "U0~U5 field validation PASS": [f"reports/phase_reports/U{i}_report.md" for i in range(0, 6)],
    "A2 final audit PASS": ["reports/final/A2_final_report.md"],
    "Human UI/result signoff": ["reports/final/HUMAN_UI_SIGNOFF.md"],
}

def file_status(path: Path) -> str:
    if not path.exists():
        return "MISSING"
    text = path.read_text(encoding="utf-8", errors="ignore")
    upper = text.upper()
    if "NOT FINAL" in upper:
        return "FAIL"
    if "FAIL" in upper and "PASS" not in upper:
        return "FAIL"
    if "PASS" in upper or "COMPLETED" in upper or "DONE" in upper:
        return "PASS"
    return "EXISTS_UNVERIFIED"

def main():
    root = Path.cwd()
    final_dir = root / "reports" / "final"
    final_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    all_ok = True
    any_unverified = False

    for idx, (requirement, files) in enumerate(PHASE_GROUPS.items(), start=1):
        statuses = []
        evidence = []
        for rel in files:
            p = root / rel
            st = file_status(p)
            statuses.append(st)
            evidence.append(f"{rel}: {st}")

        if any(st in ("MISSING", "FAIL") for st in statuses):
            status = "FAIL" if "FAIL" in statuses else "MISSING"
            all_ok = False
        elif any(st == "EXISTS_UNVERIFIED" for st in statuses):
            status = "EXISTS_UNVERIFIED"
            any_unverified = True
        else:
            status = "PASS"

        rows.append((idx, requirement, status, "; ".join(evidence)))

    if all_ok and not any_unverified:
        final = "FINAL PASS"
    elif all_ok and any_unverified:
        final = "CONDITIONAL PASS"
    else:
        final = "NOT FINAL"

    report = final_dir / "FINAL_ACCEPTANCE_REPORT.md"
    with report.open("w", encoding="utf-8") as f:
        f.write("# FINAL_ACCEPTANCE_REPORT\n\n")
        f.write(f"Generated: {datetime.now().isoformat(timespec='seconds')}\n\n")
        f.write("## 1. Executive Summary\n\n")
        f.write(f"Final decision: **{final}**\n\n")
        f.write("## 2. 14-Item Acceptance Table\n\n")
        f.write("| No | Requirement | Status | Evidence |\n")
        f.write("|---:|---|---|---|\n")
        for idx, req, status, evidence in rows:
            f.write(f"| {idx} | {req} | {status} | {evidence} |\n")
        f.write("\n## 3. Missing / Failed Items\n\n")
        missing = [r for r in rows if r[2] in ("MISSING", "FAIL")]
        if not missing:
            f.write("- None\n")
        else:
            for idx, req, status, evidence in missing:
                f.write(f"- {idx}. {req}: {status}\n")
        f.write("\n## 4. Final Decision\n\n")
        f.write(final + "\n")

    print(f"[INFO] Report written: {report}")
    print(f"[FINAL] {final}")
    if final != "FINAL PASS":
        raise SystemExit(1)

if __name__ == "__main__":
    main()
