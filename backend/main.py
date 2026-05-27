from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import base64
import os
import shutil
import httpx
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv

from backend.models.schemas import (
    ProjectCreateRequest,
    VideoProcessRequest,
    VideoConvertRequest,
    SubtitleGenerateRequest,
    SubtitleExtractRequest,
    SmartSearchRequest
)
from backend.services import video_engine, smart_frame_engine, subtitle_engine

load_dotenv()

app = FastAPI(title="YouTube Unified API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def sanitize_name(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in value.strip())
    return safe or f"project_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

def sanitize_filename(value: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in value.strip())
    return safe.strip("._") or f"asset_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

def is_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

def normalize_search_mode(value: str) -> str:
    if value == "UNIFORM":
        return "range"
    return "auto"

def project_root_from_output(output_dir: str) -> Path:
    out = Path(output_dir).resolve()
    if out.name.lower() in {"thumbnails", "output", "subtitles", "audio", "logs", "input"}:
        return out.parent
    return out

def resolve_video_source(video_path: str, output_dir: str) -> str:
    if not is_url(video_path):
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"영상 파일을 찾을 수 없습니다: {video_path}")
        return video_path

    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError("YouTube URL 처리를 위해 yt-dlp가 필요합니다. requirements를 설치하세요.") from exc

    input_dir = project_root_from_output(output_dir) / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(input_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if existing:
        return str(existing[0])

    outtmpl = str(input_dir / "%(title).80B [%(id)s].%(ext)s")
    opts = {
        "quiet": True,
        "noplaylist": True,
        "outtmpl": outtmpl,
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "merge_output_format": "mp4",
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video_path, download=True)
        filename = Path(ydl.prepare_filename(info))

    candidates = sorted(input_dir.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True)
    if candidates:
        return str(candidates[0])
    if filename.exists():
        return str(filename)
    raise FileNotFoundError("YouTube 영상 다운로드 결과 파일을 찾을 수 없습니다.")

def generated_assets_root(project_name: str) -> Path:
    return Path(os.getcwd()) / "generated_assets" / sanitize_name(project_name)

def ensure_inside(base: Path, target: Path) -> Path:
    base_resolved = base.resolve()
    target_resolved = target.resolve()
    if base_resolved != target_resolved and base_resolved not in target_resolved.parents:
        raise ValueError("허용되지 않은 저장 경로입니다.")
    return target_resolved

@app.get("/")
async def root():
    return {"message": "YouTube Unified API is running"}

@app.get("/api/system/capabilities")
async def system_capabilities():
    return {
        "asset_save": True,
        "open_folder": True,
        "render_storyboard_mp4": True,
        "version": "asset-save-v2",
    }

# --- Proxy Endpoints ---

@app.post("/api/proxy/gemini")
async def proxy_gemini(request: Request):
    try:
        body = await request.json()
        model = request.query_params.get("model", "gemini-2.0-flash")
        api_key = os.getenv("GEMINI_API_KEY") or request.headers.get("X-Gemini-API-Key")
        
        if not api_key:
            raise HTTPException(status_code=400, detail="Gemini API Key is missing")
            
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=body, timeout=60.0)
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/proxy/elevenlabs")
async def proxy_elevenlabs(request: Request):
    try:
        voice_id = request.query_params.get("voice_id")
        api_key = os.getenv("ELEVENLABS_API_KEY") or request.headers.get("X-ElevenLabs-API-Key")
        
        if not api_key:
            raise HTTPException(status_code=400, detail="ElevenLabs API Key is missing")
            
        # Default to with-timestamps for storyboard use cases
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
        body = await request.json()
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url, 
                json=body, 
                headers={"xi-api-key": api_key},
                timeout=60.0
            )
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/proxy/fal")
async def proxy_fal(request: Request):
    try:
        api_key = os.getenv("FAL_API_KEY") or request.headers.get("X-Fal-API-Key")
        if not api_key:
            raise HTTPException(status_code=400, detail="FAL API Key is missing")
            
        body = await request.json()
        model_endpoint = request.query_params.get("model", "fal-ai/pixverse/v2/image-to-video")
        url = f"https://fal.run/{model_endpoint}"
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url, 
                json=body, 
                headers={"Authorization": f"Key {api_key}"},
                timeout=120.0
            )
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Application Endpoints ---

@app.post("/api/project/create")
async def create_project(req: ProjectCreateRequest):
    base_dir = req.base_dir or os.path.join(os.getcwd(), "video_projects")
    project_root = os.path.join(base_dir, sanitize_name(req.project_name))
    
    folders = ["input", "audio", "subtitles", "thumbnails", "output", "logs"]
    try:
        for f in folders:
            os.makedirs(os.path.join(project_root, f), exist_ok=True)
        return {"project_root": project_root, "folders": folders}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/assets/save")
async def save_generated_asset(request: Request):
    try:
        body = await request.json()
        project_name = body.get("project_name") or "untitled_project"
        kind = sanitize_name(body.get("kind") or "exports")
        filename = sanitize_filename(body.get("filename") or f"asset_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
        content_base64 = body.get("content_base64")
        text = body.get("text")

        root = generated_assets_root(project_name)
        folder = ensure_inside(root, root / kind)
        folder.mkdir(parents=True, exist_ok=True)
        file_path = ensure_inside(root, folder / filename)

        if content_base64 is not None:
            raw = str(content_base64)
            if "," in raw:
                raw = raw.rsplit(",", 1)[1]
            raw = "".join(raw.split())
            missing_padding = len(raw) % 4
            if missing_padding:
                raw += "=" * (4 - missing_padding)
            file_path.write_bytes(base64.b64decode(raw))
        elif text is not None:
            file_path.write_text(str(text), encoding="utf-8-sig")
        else:
            raise ValueError("저장할 content_base64 또는 text가 없습니다.")

        return {
            "file_path": str(file_path),
            "folder_path": str(folder),
            "project_root": str(root),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/system/open-folder")
async def open_folder(request: Request):
    try:
        body = await request.json()
        raw_path = body.get("path")
        if raw_path == "downloads":
            folder = Path.home() / "Downloads"
        else:
            folder = Path(str(raw_path or "")).resolve()
        if folder.is_file():
            folder = folder.parent
        if not folder.exists():
            raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder}")
        if os.name == "nt":
            os.startfile(str(folder))
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(folder)])
        return {"opened": str(folder)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/video/process")
async def process_video(req: VideoProcessRequest):
    try:
        os.makedirs(req.output_dir, exist_ok=True)
        current_video = resolve_video_source(req.video_path, req.output_dir)
        
        # 1. Trim
        if req.trim_start > 0 or req.trim_end > 0:
            output_path = os.path.join(req.output_dir, "trimmed_video.mp4")
            current_video = video_engine.trim_video(current_video, req.trim_start, req.trim_end, output_path)
            
        # 2. Volume
        if abs(req.volume_ratio - 1.0) > 1e-9:
            output_path = os.path.join(req.output_dir, "volume_adjusted_video.mp4")
            current_video = video_engine.adjust_volume(current_video, req.volume_ratio, output_path)
            
        # 3. Burn Subtitles
        if req.burn_subtitles and req.subtitle_path:
            output_path = os.path.join(req.output_dir, "final_video.mp4")
            current_video = video_engine.burn_subtitles(current_video, req.subtitle_path, output_path)
        else:
            final_path = os.path.join(req.output_dir, "final_video.mp4")
            shutil.copy2(current_video, final_path)
            current_video = final_path
            
        return {"final_video_path": current_video}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/video/render-storyboard")
async def render_storyboard_video(request: Request):
    try:
        body = await request.json()
        project_name = body.get("project_name") or "untitled_project"
        scene_items = body.get("scenes") or []
        default_duration = max(1.0, float(body.get("default_duration") or 5.0))
        if not scene_items:
            raise ValueError("렌더링할 씬 이미지가 없습니다.")

        root = generated_assets_root(project_name)
        videos_dir = ensure_inside(root, root / "videos")
        frames_dir = ensure_inside(root, videos_dir / "render_frames")
        videos_dir.mkdir(parents=True, exist_ok=True)
        frames_dir.mkdir(parents=True, exist_ok=True)

        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        concat_path = ensure_inside(root, videos_dir / f"storyboard_{stamp}_concat.txt")
        output_path = ensure_inside(root, videos_dir / f"storyboard_{stamp}.mp4")

        frame_paths: list[Path] = []
        durations: list[float] = []
        for index, scene in enumerate(scene_items, start=1):
            image_data = str(scene.get("imageData") or scene.get("image_data") or "")
            if not image_data:
                continue
            if "," in image_data:
                image_data = image_data.rsplit(",", 1)[1]
            image_data = "".join(image_data.split())
            missing_padding = len(image_data) % 4
            if missing_padding:
                image_data += "=" * (4 - missing_padding)
            scene_number = int(scene.get("sceneNumber") or scene.get("scene_number") or index)
            frame_path = ensure_inside(root, frames_dir / f"scene_{scene_number:03d}_{stamp}.png")
            frame_path.write_bytes(base64.b64decode(image_data))
            frame_paths.append(frame_path)
            durations.append(max(1.0, float(scene.get("duration") or default_duration)))

        if not frame_paths:
            raise ValueError("저장 가능한 씬 이미지가 없습니다.")

        def ffconcat_path(path: Path) -> str:
            return path.resolve().as_posix().replace("'", "'\\''")

        lines = ["ffconcat version 1.0"]
        for frame_path, duration in zip(frame_paths, durations):
            lines.append(f"file '{ffconcat_path(frame_path)}'")
            lines.append(f"duration {duration:.3f}")
        lines.append(f"file '{ffconcat_path(frame_paths[-1])}'")
        concat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        video_engine.run_ffmpeg([
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_path),
            "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
            "-r", "30",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-movflags", "+faststart",
            str(output_path),
        ])

        return {
            "output_path": str(output_path),
            "folder_path": str(videos_dir),
            "duration_seconds": sum(durations),
            "scene_count": len(frame_paths),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/video/convert-to-mp4")
async def convert_video_to_mp4(req: VideoConvertRequest):
    try:
        input_path = Path(req.input_path).resolve()
        if not input_path.exists():
            raise FileNotFoundError(f"변환할 파일을 찾을 수 없습니다: {input_path}")
        output_path = Path(req.output_path).resolve() if req.output_path else input_path.with_suffix(".mp4")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        result = video_engine.convert_to_mp4(str(input_path), str(output_path))
        return {
            "input_path": str(input_path),
            "output_path": result,
            "folder_path": str(output_path.parent),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/subtitles/generate")
async def generate_subtitles(req: SubtitleGenerateRequest):
    try:
        text_path, srt_path, meta_path = subtitle_engine.generate_subtitles_whisper(req.audio_path, req.output_dir)
        return {
            "text_path": text_path,
            "srt_path": srt_path,
            "metadata_path": meta_path
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/subtitles/extract")
async def extract_subtitles(req: SubtitleExtractRequest):
    try:
        if req.output_path:
            path = subtitle_engine.save_youtube_transcript(req.video_url_or_id, req.output_path, req.languages)
            return {"output_path": path}
        else:
            transcript = subtitle_engine.fetch_youtube_transcript(req.video_url_or_id, req.languages)
            return {"transcript": transcript}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/frames/smart-search")
async def smart_search(req: SmartSearchRequest):
    try:
        video_path = resolve_video_source(req.video_path, req.output_dir)
        results = smart_frame_engine.run_smart_search(
            video_path=video_path,
            output_dir=req.output_dir,
            search_mode=normalize_search_mode(req.search_mode),
            result_count=req.result_count,
            target_time=req.target_time,
            window_size=req.window_size,
            sampling_interval=req.sampling_interval,
            min_gap=req.min_gap
        )
        return {"candidates": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
