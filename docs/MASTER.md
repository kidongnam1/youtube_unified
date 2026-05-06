# MASTER.md
Generated: 2026-04-08 03:31 (Asia/Seoul)

## 1. Project Name
Video Automation System

## 2. Current Final Runtime Target
- Primary runtime file: `run.py`
- Latest integrated build origin: `GPT_V1_VideoAutomationSystem_v1_1_p2.py`

## 3. Project Goal
This project is a Python-based desktop video automation tool designed to help non-expert users process a video with minimal clicks.

Core goals:
- automate video preparation
- extract candidate thumbnails
- extract audio
- generate subtitles
- recommend strong frames automatically
- support beginner-friendly one-click execution
- remain usable even before advanced editing is added

---

## 4. Current Development Stage
### Status Summary
- Specification: completed
- Base coding: completed
- Smart Frame Search: completed
- P0 stabilization: completed
- P1 convenience improvements: completed
- P2 one-click flow + UI redesign: completed
- Real PC validation: pending
- Production hardening: pending

### Practical Interpretation
The program is mostly built, but it is **not fully production-complete** until real PC execution is verified and FAIL items are patched.

---

## 5. Main Functional Scope
### 5.1 Base Workflow
- select one video file
- select a project root folder
- copy input video into project folder
- extract fixed-time thumbnail frames
- extract audio using FFmpeg
- generate subtitles using Whisper
- export final video
- write logs

### 5.2 Smart Frame Search
Two modes exist:
1. Auto Best Frames
2. Guided Range Search

Smart frame scoring uses:
- scene change score
- sharpness score
- brightness score

### 5.3 Minimal Editing
- trim start
- trim end
- volume ratio adjustment
- subtitle text edit
- selected thumbnail save

### 5.4 Convenience Features
- Run Preflight Check
- Open Output Folder
- Better Export Summary
- Editable Capture Times
- Presets

### 5.5 One-Click Process
The main beginner mode:
1. preflight check
2. generate workflow
3. auto smart frame search
4. auto-select top frame
5. auto-save selected thumbnail
6. export summary display

---

## 6. Target Users
### Primary Users
- beginners
- non-developers
- users who want near-automatic processing
- users who prefer button-driven workflows

### Secondary Users
- power users who want manual control
- users who want smart frame refinement

---

## 7. Current File Strategy
### Recommended Runtime File
- `run.py`

### Reference Builds
- `app_p1.py`
- `app_p2.py`

### Reason
The original filenames were long. A shorter runtime file is easier for real-world use and operator training.

---

## 8. Folder / Output Structure
When processing succeeds, the project should create a structure similar to:

```text
project_root/
 └─ <project_name>/
    ├─ input/
    ├─ audio/
    ├─ subtitles/
    ├─ thumbnails/
    ├─ output/
    └─ logs/
```

Expected outputs:
- `input/<video file>`
- `audio/audio.mp3`
- `subtitles/subtitle.txt`
- `subtitles/subtitle.srt`
- `thumbnails/thumb_*.jpg`
- `thumbnails/smart_auto_*.jpg`
- `output/final_video.mp4`
- `output/selected_thumbnail.jpg`
- `logs/run.log`

---

## 9. Technology Stack
### Core
- Python 3.11+
- PySide6
- OpenCV
- openai-whisper
- FFmpeg

### Runtime Style
- desktop GUI first
- One-Click friendly
- potential future CLI fallback

---

## 10. Architectural Overview
### Current High-Level Structure
1. UI Layer
2. Workflow Runner
3. Smart Frame Engine
4. Subtitle handling
5. FFmpeg wrapper
6. Export and logging

### Current Design Strength
- feature-complete single-file application
- common engine reusable for future CLI or web path
- strong beginner-oriented workflow direction

### Current Architectural Limitation
- single-file code size is already large
- execution validation still matters more than refactor
- modular split should wait until after PC validation

---

## 11. Key Rules Confirmed During This Session
### Product Rules
- English-only program-facing elements
- beginner-friendly workflow
- automation first
- minimal friction
- one-click should be the main user path

### Engineering Rules
- do not duplicate workflow logic unnecessarily
- reuse existing processing functions
- patch only real failures after testing
- do not refactor structure before run validation
- prefer production-safe changes only

---

## 12. Known Current Risk Areas
These are not proof of failure, but they are the main watch points:

1. real PC runtime environment mismatch
2. FFmpeg availability / PATH issues
3. Whisper import or model loading issues
4. file permission / output write issues
5. smart frame no-candidate edge cases
6. export consistency edge cases
7. selected thumbnail downstream usage depth
8. subtitle metadata downstream usage depth

---

## 13. P0 Summary
P0 was for stability.

Included:
- subtitle TXT/SRT synchronization
- export source safety check
- smart frame empty-result handling
- original/project path separation
- structured error categories
- permission/write failure handling

---

## 14. P1 Summary
P1 was for convenience.

Included:
- preflight check
- open output folder
- better export summary
- editable capture times
- presets

---

## 15. P2 Summary
P2 was for product usability and visual improvement.

Included:
- One-Click Process
- automatic generate → smart frame → thumbnail save chain
- dashboard-style UI improvement
- stronger primary-button hierarchy

---

## 16. What Is Still Not Considered Fully Done
The following remain pending until real execution confirms behavior:

- full PASS / FAIL validation on PC
- one-click end-to-end confirmation
- environment-specific failure capture
- P2.1 targeted stability patching based on real logs

---

## 17. Recommended Immediate Next Steps
### Step 1
Run the current package on the real PC.

### Step 2
Use this sequence:
1. Run Preflight Check
2. Select Video
3. Select Project Root
4. One-Click Process

### Step 3
Record PASS / FAIL.

### Step 4
If any FAIL occurs, patch only the failed step.

---

## 18. PASS / FAIL Standard
### PASS means
- expected behavior occurred
- expected file was created
- app stayed alive
- log remained readable

### FAIL means
- app crashed
- expected output missing
- button visible but no real behavior
- smart flow stopped unexpectedly
- unclear or misleading operator message

---

## 19. Error Reporting Template
When a failure happens, record:

```markdown
# Error Report

## Button Clicked
One-Click Process / Generate / Find Best Frames / Refine by Range

## Error Message
(full message)

## Last 5 Log Lines
(copy from log panel or run.log)

## Failed Step
Preflight / Generate / Smart Frame / Thumbnail Save / Export

## What Happened
(short explanation)
```

---

## 20. Beginner Usage Summary
The intended simplest use is:

1. run the app
2. click `Run Preflight Check`
3. click `Select Video`
4. click `Select Project Root`
5. click `One-Click Process`
6. review outputs

This is the main user path.

---

## 21. CLI Fallback Direction (Planned)
A CLI fallback was discussed and approved as a future-safe direction.

Target behavior:
- GUI available → GUI mode
- GUI unavailable → CLI mode
- support `--gui`
- support `--cli`

CLI scope should stay minimal:
- preflight
- one-click style workflow
- output summary

This is a future extension, not yet the main validated path.

---

## 22. Refactor Strategy
### Do Not Refactor Yet
The code is already large, but refactoring before real execution validation is not recommended.

### Refactor Later
After PC validation, the likely split is:

- `ui_main.py`
- `workflow_engine.py`
- `smart_frame_engine.py`
- `subtitle_engine.py`
- `ffmpeg_wrapper.py`

---

## 23. Final Reality Check
### Is the program coded?
Yes, mostly.

### Is the product finished?
Not yet.

### Why?
Because real execution validation still matters.

### Current truth
This is a near-complete build awaiting execution verification and stabilization.

---

## 24. One-Line Final Summary
This project is a mostly completed Python video automation application with one-click processing and smart frame search, and the next critical milestone is real PC execution validation followed by targeted stabilization patches.
