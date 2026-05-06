from pydantic import BaseModel
from typing import List, Optional, Literal

class ProjectCreateRequest(BaseModel):
    project_name: str
    base_dir: Optional[str] = None

class VideoProcessRequest(BaseModel):
    video_path: str
    output_dir: str
    trim_start: float = 0.0
    trim_end: float = 0.0
    volume_ratio: float = 1.0
    burn_subtitles: bool = False
    subtitle_path: Optional[str] = None

class SubtitleGenerateRequest(BaseModel):
    audio_path: str
    output_dir: str

class SubtitleExtractRequest(BaseModel):
    video_url_or_id: str
    output_path: Optional[str] = None
    languages: List[str] = ["ko", "en"]

class SmartSearchRequest(BaseModel):
    video_path: str
    output_dir: str
    search_mode: Literal["auto", "range"] = "auto"
    result_count: int = 3
    target_time: Optional[float] = None
    window_size: float = 6.0
    sampling_interval: float = 0.5
    min_gap: float = 1.5
