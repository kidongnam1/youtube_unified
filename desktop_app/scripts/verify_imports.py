import importlib
import shutil
import sys

checks = [
    ("PySide6", "PySide6", True),
    ("cv2", "cv2", True),
    ("whisper", "whisper", True),
    ("yt_dlp", "yt_dlp", False),
]

failed = False
print("[INFO] Python:", sys.version)

for label, module, required in checks:
    try:
        importlib.import_module(module)
        print(f"[PASS] {label} import OK")
    except Exception as exc:
        if required:
            print(f"[FAIL] {label} missing: {exc}")
            failed = True
        else:
            print(f"[WARN] {label} missing: {exc}")

ffmpeg = shutil.which("ffmpeg")
if ffmpeg:
    print(f"[PASS] ffmpeg found: {ffmpeg}")
else:
    print("[FAIL] ffmpeg not found in PATH")
    failed = True

if failed:
    raise SystemExit(1)
print("[PASS] required environment OK")
