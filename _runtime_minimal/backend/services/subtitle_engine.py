import json
import os
import logging
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlparse, parse_qs
from youtube_transcript_api import YouTubeTranscriptApi

logger = logging.getLogger(__name__)

# Singleton/Cached Whisper Model Loader
_whisper_model = None

def get_whisper_model(model_name: str = "base"):
    global _whisper_model
    if _whisper_model is None:
        import whisper
        logger.info(f"Loading Whisper model: {model_name}")
        _whisper_model = whisper.load_model(model_name)
    return _whisper_model

def format_seconds_to_srt(seconds: float) -> str:
    millis = int(round((seconds % 1) * 1000))
    whole = int(seconds)
    hours = whole // 3600
    minutes = (whole % 3600) // 60
    secs = whole % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def write_srt_from_segments(segments: List[dict], output_path: str) -> None:
    lines: List[str] = []
    for idx, segment in enumerate(segments, start=1):
        start = format_seconds_to_srt(float(segment["start"]))
        end = format_seconds_to_srt(float(segment["end"]))
        text = str(segment["text"]).strip()
        lines.extend([str(idx), f"{start} --> {end}", text, ""])
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines))

def generate_subtitles_whisper(audio_path: str, output_dir: str) -> Tuple[str, str, str]:
    model = get_whisper_model(os.getenv("WHISPER_MODEL", "base"))
    logger.info(f"Transcribing audio: {audio_path}")
    result = model.transcribe(audio_path)
    
    os.makedirs(output_dir, exist_ok=True)
    text_path = os.path.join(output_dir, "subtitle.txt")
    srt_path = os.path.join(output_dir, "subtitle.srt")
    meta_path = os.path.join(output_dir, "subtitle_metadata.json")
    
    with open(text_path, 'w', encoding='utf-8') as f:
        f.write(result.get("text", "").strip())
        
    segments = result.get("segments", [])
    write_srt_from_segments(segments, srt_path)
    
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        
    return text_path, srt_path, meta_path

def extract_youtube_id(url_or_id: str) -> str:
    if "youtube.com" in url_or_id or "youtu.be" in url_or_id:
        try:
            parsed = urlparse(url_or_id)
            if "youtu.be" in url_or_id:
                return parsed.path.lstrip("/")
            else:
                query_params = parse_qs(parsed.query)
                return query_params.get("v", [url_or_id])[0]
        except Exception:
            return url_or_id
    return url_or_id

def fetch_youtube_transcript(video_url_or_id: str, languages: List[str] = ['ko', 'en']) -> List[dict]:
    video_id = extract_youtube_id(video_url_or_id)
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=languages)
        return transcript
    except Exception as e:
        logger.error(f"Failed to fetch YouTube transcript: {e}")
        raise RuntimeError(f"YouTube transcript extraction failed: {e}")

def save_youtube_transcript(video_url_or_id: str, output_path: str, languages: List[str] = ['ko', 'en']):
    transcript = fetch_youtube_transcript(video_url_or_id, languages)
    with open(output_path, 'w', encoding='utf-8') as f:
        for item in transcript:
            f.write(f"{item['text']}\n")
    return output_path
