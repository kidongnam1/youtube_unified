import subprocess
import shutil
import logging
import os
import cv2
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

def ensure_ffmpeg_available():
    if not shutil.which("ffmpeg"):
        raise RuntimeError("FFmpeg is not installed or not available in PATH.")

def run_ffmpeg(args: List[str]):
    ensure_ffmpeg_available()
    full_cmd = ["ffmpeg", "-y", *args]
    try:
        process = subprocess.run(
            full_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
        return process.stdout
    except subprocess.CalledProcessError as exc:
        error_msg = exc.stderr.strip() if exc.stderr else str(exc)
        logger.error(f"FFmpeg failed: {error_msg}")
        raise RuntimeError(f"Video processing failed: {error_msg}")

def get_video_duration(video_path: str) -> float:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        raise ValueError("Could not open the input video.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0
    cap.release()

    if fps <= 0 or frame_count <= 0:
        return 0.0
    return frame_count / fps

def trim_video(video_path: str, start_time: float, end_time: float, output_path: str):
    duration = get_video_duration(video_path)
    if start_time + end_time >= duration:
        raise ValueError("Trim values remove the entire video.")

    cmd = ["-i", video_path]
    if start_time > 0:
        cmd = ["-ss", str(start_time), *cmd]
    if end_time > 0:
        trimmed_duration = max(duration - start_time - end_time, 0.1)
        cmd.extend(["-t", str(trimmed_duration)])

    cmd.extend(["-c:v", "libx264", "-c:a", "aac", output_path])
    run_ffmpeg(cmd)
    return output_path

def adjust_volume(video_path: str, volume_ratio: float, output_path: str):
    run_ffmpeg([
        "-i", video_path,
        "-filter:a", f"volume={volume_ratio}",
        "-c:v", "copy",
        output_path
    ])
    return output_path

def extract_audio(video_path: str, audio_path: str):
    run_ffmpeg(["-i", video_path, "-vn", "-acodec", "mp3", audio_path])
    return audio_path

def convert_to_mp4(input_path: str, output_path: str):
    run_ffmpeg([
        "-i", input_path,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ])
    return output_path

def burn_subtitles(video_path: str, subtitle_path: str, output_path: str):
    # FFmpeg subtitles filter needs path escaping for Windows
    abs_sub_path = os.path.abspath(subtitle_path)
    if os.name == "nt":
        s = abs_sub_path.replace("\\", "/")
        if len(s) >= 2 and s[1] == ":":
            s = s[0] + "\\:" + s[2:]
        vf = f"subtitles='{s}'"
    else:
        vf = f"subtitles='{abs_sub_path}'"

    run_ffmpeg([
        "-i", video_path,
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "copy",
        output_path
    ])
    return output_path
