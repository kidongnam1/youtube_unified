import cv2
import numpy as np
import json
import os
from pathlib import Path
from typing import List, Optional, Literal
from dataclasses import dataclass, asdict

UPPER_BODY_FRACTION = 0.82
STATIC_DEFAULT_DIFF_THRESHOLD = 12.0
STATIC_MIN_DURATION_SEC = 2.0
STATIC_DEFAULT_SAMPLE_INTERVAL = 0.5

@dataclass
class SmartFrameCandidate:
    timestamp_sec: float
    frame_path: Optional[str] = None
    total_score: float = 0.0
    scene_score: float = 0.0
    sharpness_score: float = 0.0
    brightness_score: float = 0.0

def crop_upper_region(frame: np.ndarray, upper_frac: float = UPPER_BODY_FRACTION) -> np.ndarray:
    h = frame.shape[0]
    cut = max(1, int(round(h * upper_frac)))
    return frame[:cut, :, :]

def calculate_sharpness_score(frame_image) -> float:
    gray = cv2.cvtColor(frame_image, cv2.COLOR_BGR2GRAY)
    value = cv2.Laplacian(gray, cv2.CV_64F).var()
    return float(min(value / 1000.0, 1.0))

def calculate_brightness_score(frame_image) -> float:
    gray = cv2.cvtColor(frame_image, cv2.COLOR_BGR2GRAY)
    mean_val = float(gray.mean())
    score = 1.0 - abs(mean_val - 128.0) / 128.0
    return max(0.0, min(score, 1.0))

def score_frame_chart_heuristic(body_bgr: np.ndarray) -> dict:
    gray = cv2.cvtColor(body_bgr, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.clip(edges.mean() / 255.0, 0.0, 1.0))
    sx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    line_grid_score = float(np.clip((np.abs(sx).mean() + np.abs(sy).mean()) / 512.0, 0.0, 1.0))
    text_like_edge_score = float(np.clip(0.55 * edge_density + 0.45 * line_grid_score, 0.0, 1.0))
    return {
        "edge_density": round(edge_density, 4),
        "line_grid_score": round(line_grid_score, 4),
        "text_like_edge_score": round(text_like_edge_score, 4),
    }

def run_smart_search(
    video_path: str,
    output_dir: str,
    search_mode: Literal["auto", "range"] = "auto",
    result_count: int = 3,
    target_time: Optional[float] = None,
    window_size: float = 6.0,
    sampling_interval: float = 0.5,
    min_gap: float = 1.5
):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Could not open video.")
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    
    start_sec = 0.0
    end_sec = duration
    
    if search_mode == "range" and target_time is not None:
        start_sec = max(0.0, target_time - window_size/2)
        end_sec = min(duration, target_time + window_size/2)
        
    candidates = []
    current_sec = start_sec
    prev_gray = None
    
    while current_sec <= end_sec:
        cap.set(cv2.CAP_PROP_POS_MSEC, current_sec * 1000)
        ok, frame = cap.read()
        if not ok: break
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        scene_score = 0.0
        if prev_gray is not None:
            diff = cv2.absdiff(prev_gray, gray)
            scene_score = min(float(diff.mean()) / 30.0, 1.0)
            
        sharpness = calculate_sharpness_score(frame)
        brightness = calculate_brightness_score(frame)
        total_score = scene_score * 0.4 + sharpness * 0.4 + brightness * 0.2
        
        candidates.append(SmartFrameCandidate(
            timestamp_sec=current_sec,
            total_score=total_score,
            scene_score=scene_score,
            sharpness_score=sharpness,
            brightness_score=brightness
        ))
        
        prev_gray = gray
        current_sec += sampling_interval
        
    cap.release()
    
    # Filter by gap
    candidates.sort(key=lambda x: x.total_score, reverse=True)
    filtered = []
    for c in candidates:
        if all(abs(c.timestamp_sec - kept.timestamp_sec) >= min_gap for kept in filtered):
            filtered.append(c)
            if len(filtered) >= result_count: break
            
    # Save frames
    cap = cv2.VideoCapture(video_path)
    os.makedirs(output_dir, exist_ok=True)
    results = []
    for i, c in enumerate(filtered):
        cap.set(cv2.CAP_PROP_POS_MSEC, c.timestamp_sec * 1000)
        ok, frame = cap.read()
        if ok:
            fname = f"smart_{search_mode}_{i:02d}_{int(c.timestamp_sec)}s.jpg"
            fpath = os.path.join(output_dir, fname)
            cv2.imwrite(fpath, frame)
            c.frame_path = fpath
            results.append(asdict(c))
    cap.release()
    return results
