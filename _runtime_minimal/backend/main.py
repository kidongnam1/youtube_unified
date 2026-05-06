from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import os
import shutil
import httpx
from datetime import datetime
from dotenv import load_dotenv

from backend.models.schemas import (
    ProjectCreateRequest,
    VideoProcessRequest,
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

@app.get("/")
async def root():
    return {"message": "YouTube Unified API is running"}

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

@app.post("/api/video/process")
async def process_video(req: VideoProcessRequest):
    try:
        current_video = req.video_path
        
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
        results = smart_frame_engine.run_smart_search(
            video_path=req.video_path,
            output_dir=req.output_dir,
            search_mode=req.search_mode,
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
