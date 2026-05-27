import {
  STORAGE_KEYS,
  GEMINI_STYLE_PRESETS,
  DEFAULT_VOICE_ID,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_GEMINI_IMAGE_MODEL,
  ANIMATION,
} from "./services/config.js";
import { generateImageForScene } from "./services/geminiImage.js";
import { generateAudioWithElevenLabs } from "./services/elevenLabs.js";
import { generateVideoFromImage } from "./services/fal.js";
import { generateVideo } from "./services/videoExport.js";

let scenes = [];
let pipelineAbort = false;
const abortRef = { get current() { return pipelineAbort; } };

const el = (id) => document.getElementById(id);

function log(message) {
  const box = el("logBox");
  const time = new Date().toLocaleTimeString();
  box.textContent += `\n[${time}] ${message}`;
  box.scrollTop = box.scrollHeight;
}

function setStatus(text, type = "") {
  const pill = el("statusPill");
  pill.textContent = text;
  pill.className = `status-pill ${type}`.trim();
}

function getSettings() {
  return {
    geminiKey: localStorage.getItem(STORAGE_KEYS.geminiKey) || "",
    geminiModel: localStorage.getItem(STORAGE_KEYS.geminiModel) || "gemini-2.5-flash",
    geminiImageModel: localStorage.getItem(STORAGE_KEYS.geminiImageModel) || DEFAULT_GEMINI_IMAGE_MODEL,
    geminiStyle: localStorage.getItem(STORAGE_KEYS.geminiStyle) || "gemini-crayon",
    geminiCustomStyle: localStorage.getItem(STORAGE_KEYS.geminiCustomStyle) || "",
    elevenLabsKey: "",
    elevenLabsVoice: DEFAULT_VOICE_ID,
    elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
    falKey: "",
    falSceneLimit: ANIMATION.ENABLED_SCENES,
  };
}

function getGeminiStylePromptText() {
  const s = getSettings();
  if (s.geminiStyle === "gemini-none") return "";
  if (s.geminiStyle === "gemini-custom") return s.geminiCustomStyle.trim();
  const preset = GEMINI_STYLE_PRESETS.find((p) => p.id === s.geminiStyle);
  return preset?.prompt || "";
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.geminiKey, el("geminiKey").value.trim());
  localStorage.setItem(STORAGE_KEYS.geminiModel, el("geminiModel").value);
  localStorage.setItem(STORAGE_KEYS.geminiImageModel, el("geminiImageModel").value);
  localStorage.setItem(STORAGE_KEYS.geminiStyle, el("geminiStyle").value);
  localStorage.setItem(STORAGE_KEYS.geminiCustomStyle, el("geminiCustomStyle").value.trim());
  setStatus("설정 저장됨", "ok");
  log("Gemini API 설정 저장 완료");
}

function loadSettings() {
  const s = getSettings();
  el("geminiKey").value = s.geminiKey;
  el("geminiModel").value = s.geminiModel;
  el("geminiImageModel").value = s.geminiImageModel;
  el("geminiStyle").value = s.geminiStyle;
  el("geminiCustomStyle").value = s.geminiCustomStyle;
  syncCustomStyleVisibility();
}

function syncCustomStyleVisibility() {
  const customRow = el("geminiCustomRow");
  if (!customRow) return;
  customRow.style.display = el("geminiStyle").value === "gemini-custom" ? "grid" : "none";
}

function ensureSceneShape(s) {
  return {
    sceneNumber: Number(s.sceneNumber || 0),
    narration: String(s.narration || ""),
    visualPrompt: String(s.visualPrompt || ""),
    analysis: {
      sentiment: s.analysis?.sentiment || "NEUTRAL",
      composition_type: s.analysis?.composition_type || "STANDARD",
    },
    imageData: s.imageData ?? null,
    audioData: s.audioData ?? null,
    subtitleData: s.subtitleData ?? null,
    videoData: s.videoData ?? null,
    audioDuration: s.audioDuration ?? null,
    videoDuration: s.videoDuration ?? null,
  };
}

function getProjects() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.projects) || "[]");
  } catch {
    return [];
  }
}

function saveProjects(projects) {
  localStorage.setItem(STORAGE_KEYS.projects, JSON.stringify(projects));
  updateCounts();
}

function updateCounts() {
  el("sceneCount").textContent = String(scenes.length);
  el("savedCount").textContent = String(getProjects().length);
}

function switchView(name) {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });
  if (name === "projects") renderProjects();
}

function splitManualScript(text) {
  return text
    .split(/(?<=[.!?。]|[다요죠음임함됨됨니다까])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((line, index) =>
      ensureSceneShape({
        sceneNumber: index + 1,
        narration: line,
        visualPrompt: makeFallbackVisualPrompt(line),
        analysis: { sentiment: "NEUTRAL", composition_type: "STANDARD" },
      })
    );
}

function makeFallbackVisualPrompt(text) {
  return `16:9 Korean YouTube storyboard illustration, clear visual metaphor for: ${text}`;
}

function storyboardPrompt(topic, sourceText) {
  const content = sourceText || topic;
  return `
You are a storyboard designer for Korean YouTube automation.
Create a concise storyboard from the input.

Rules:
- Keep Korean narration faithful to the input.
- Split into natural short scenes.
- Return JSON only.
- No markdown.

Input:
${content}

JSON shape:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "narration": "Korean narration",
      "visualPrompt": "English 16:9 image prompt",
      "analysis": {
        "sentiment": "POSITIVE|NEGATIVE|NEUTRAL",
        "composition_type": "MICRO|STANDARD|MACRO|NO_CHAR"
      }
    }
  ]
}`;
}

function cleanJson(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");
  const first = raw.search(/[\[{]/);
  if (first < 0) throw new Error("JSON 응답을 찾지 못했습니다.");
  const sliced = raw.slice(first);
  const lastObject = Math.max(sliced.lastIndexOf("}"), sliced.lastIndexOf("]"));
  if (lastObject < 0) throw new Error("JSON 응답이 불완전합니다.");
  return sliced.slice(0, lastObject + 1);
}

const BACKEND_URL = "http://localhost:8000";

async function callGemini(prompt) {
  const { geminiKey, geminiModel } = getSettings();
  if (!geminiKey) {
    throw new Error("Gemini API Key가 없습니다. 왼쪽 YouTube Unified 영역 하단에서 저장하세요.");
  }

  const url = `${BACKEND_URL}/api/proxy/gemini?model=${encodeURIComponent(geminiModel)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "X-Gemini-API-Key": geminiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini 요청 실패 (${response.status}): ${errorText.slice(0, 240)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  return JSON.parse(cleanJson(text));
}

// --- Automation Logic ---
let autoProjectRoot = "";
let autoCandidates = [];

function autoLog(message) {
  const box = el("autoLogBox");
  const time = new Date().toLocaleTimeString();
  box.textContent += `\n[${time}] ${message}`;
  box.scrollTop = box.scrollHeight;
}

function setAutoStatus(text, type = "") {
  const pill = el("autoStatusPill");
  if (pill) {
    pill.textContent = text;
    pill.className = `status-pill ${type}`.trim();
  }
}

async function startAutomation() {
  const projectName = el("autoProjectName").value.trim();
  const videoSource = el("videoSource").value.trim();
  
  if (!projectName || !videoSource) {
    autoLog("프로젝트 이름과 영상 경로/URL이 필요합니다.");
    return;
  }

  el("startAutoBtn").disabled = true;
  el("autoResultsPanel").style.display = "none";
  autoLog(`자동화 시작: ${projectName}`);
  setAutoStatus("처리 중...", "busy");

  try {
    // 1. Create Project
    autoLog("Backend 프로젝트 생성 중...");
    const createResp = await fetch(`${BACKEND_URL}/api/project/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_name: projectName })
    });
    const createData = await createResp.json();
    autoProjectRoot = createData.project_root;
    autoLog(`프로젝트 생성 완료: ${autoProjectRoot}`);

    // 2. Smart Search
    autoLog("스마트 프레임 검색 중 (시간이 걸릴 수 있습니다)...");
    const searchMode = el("autoSearchMode").value;
    const resultCount = Number(el("autoResultCount").value);
    const samplingInterval = parseFloat(el("autoSamplingInterval").value);
    const minGap = parseFloat(el("autoMinGap").value);

    const searchResp = await fetch(`${BACKEND_URL}/api/frames/smart-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_path: videoSource,
        output_dir: `${autoProjectRoot}/thumbnails`,
        search_mode: searchMode,
        result_count: resultCount,
        sampling_interval: samplingInterval,
        min_gap: minGap
      })
    });
    const searchData = await searchResp.json();
    autoCandidates = searchData.candidates || [];
    autoLog(`${autoCandidates.length}개 후보 프레임 발견`);

    renderAutoCandidates();
    el("autoResultsPanel").style.display = "block";
    setAutoStatus("검색 완료", "ok");
  } catch (err) {
    autoLog(`오류 발생: ${err.message}`);
    setAutoStatus("오류", "error");
  } finally {
    el("startAutoBtn").disabled = false;
  }
}

function renderAutoCandidates() {
  const container = el("autoCandidates");
  if (!autoCandidates.length) {
    container.innerHTML = "<p>결과가 없습니다.</p>";
    return;
  }

  container.innerHTML = autoCandidates.map((c, i) => `
    <div class="panel" style="padding: 10px; border: 1px solid var(--border); border-radius: 8px;">
      <strong>후보 ${i + 1}</strong>
      <p style="font-size: 0.8rem; margin: 5px 0;">시간: ${c.timestamp.toFixed(2)}s</p>
      <p style="font-size: 0.8rem; color: var(--text-muted); word-break: break-all; opacity: 0.7;">${c.frame_path.split('\\').pop()}</p>
    </div>
  `).join("");
}

async function finalizeVideo() {
  if (!autoProjectRoot) return;
  
  el("finalizeVideoBtn").disabled = true;
  autoLog("최종 영상 합성 중...");
  setAutoStatus("합성 중", "busy");

  try {
    const videoSource = el("videoSource").value.trim();
    const processResp = await fetch(`${BACKEND_URL}/api/video/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_path: videoSource,
        output_dir: `${autoProjectRoot}/output`,
        burn_subtitles: true,
        subtitle_path: ""
      })
    });
    const processData = await processResp.json();
    autoLog(`합성 완료: ${processData.final_video_path}`);
    setAutoStatus("완료", "ok");
    alert(`영상이 생성되었습니다: ${processData.final_video_path}`);
  } catch (err) {
    autoLog(`합성 오류: ${err.message}`);
    setAutoStatus("오류", "error");
  } finally {
    el("finalizeVideoBtn").disabled = false;
  }
}

// --- Subtitle Logic ---
async function extractSubtitles() {
  const url = el("subtitleYoutubeUrl").value.trim();
  const langs = el("subtitleLangs").value.trim().split(",").map(s => s.trim());
  
  if (!url) {
    alert("YouTube URL을 입력하세요.");
    return;
  }

  el("extractSubtitleBtn").disabled = true;
  el("subtitleResult").style.display = "none";
  setStatus("자막 추출 중...", "busy");

  try {
    const resp = await fetch(`${BACKEND_URL}/api/subtitles/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_url_or_id: url,
        languages: langs
      })
    });
    
    if (!resp.ok) throw new Error("자막 추출 실패");
    
    const data = await resp.json();
    const transcript = data.transcript;
    
    const fullText = transcript.map(t => t.text).join(" ");
    el("subtitleTextarea").value = fullText;
    el("subtitleResult").style.display = "block";
    setStatus("추출 완료", "ok");
  } catch (err) {
    alert(`오류: ${err.message}`);
    setStatus("오류", "error");
  } finally {
    el("extractSubtitleBtn").disabled = false;
  }
}

function copySubtitles() {
  const textarea = el("subtitleTextarea");
  textarea.select();
  document.execCommand("copy");
  alert("클립보드에 복사되었습니다.");
}

function sendToStoryboard() {
  const text = el("subtitleTextarea").value;
  if (!text) return;
  
  el("scriptInput").value = text;
  switchView("create");
  alert("대본 입력란으로 보냈습니다. '대본만 씬 분할' 또는 '스토리보드 생성'을 눌러주세요.");
}

function normalizeScenes(result) {
  const list = Array.isArray(result) ? result : result.scenes || [];
  return list
    .map((scene, index) =>
      ensureSceneShape({
        sceneNumber: Number(scene.sceneNumber || index + 1),
        narration: String(scene.narration || "").trim(),
        visualPrompt: String(scene.visualPrompt || scene.image_prompt_english || "").trim(),
        analysis: {
          sentiment: scene.analysis?.sentiment || "NEUTRAL",
          composition_type: scene.analysis?.composition_type || "STANDARD",
        },
      })
    )
    .filter((scene) => scene.narration);
}

async function generateStoryboard() {
  const topic = el("topicInput").value.trim();
  const sourceText = el("scriptInput").value.trim();
  if (!topic && !sourceText) {
    setStatus("입력 필요", "error");
    log("주제 또는 수동 대본을 입력해야 합니다.");
    return;
  }

  setStatus("생성 중", "");
  el("generateBtn").disabled = true;
  log("Gemini 스토리보드 생성 시작");

  try {
    const result = await callGemini(storyboardPrompt(topic || "Manual Script Input", sourceText));
    scenes = normalizeScenes(result);
    if (!scenes.length) throw new Error("생성된 씬이 없습니다.");
    renderStoryboard();
    setStatus("생성 완료", "ok");
    log(`${scenes.length}개 씬 생성 완료`);
  } catch (error) {
    setStatus("오류", "error");
    log(error.message);
  } finally {
    el("generateBtn").disabled = false;
    updateCounts();
  }
}

function splitOnly() {
  const sourceText = el("scriptInput").value.trim();
  if (!sourceText) {
    setStatus("대본 필요", "error");
    log("씬 분할에는 수동 대본이 필요합니다.");
    return;
  }
  scenes = splitManualScript(sourceText);
  renderStoryboard();
  setStatus("분할 완료", "ok");
  log(`${scenes.length}개 씬으로 분할했습니다.`);
  updateCounts();
}

function scenePreviewSrc(scene) {
  if (!scene.imageData) return "";
  return `data:image/png;base64,${scene.imageData}`;
}

function renderStoryboard() {
  const container = el("storyboard");
  container.classList.toggle("empty", scenes.length === 0);
  if (!scenes.length) {
    container.innerHTML = "<p>아직 생성된 씬이 없습니다.</p>";
    return;
  }

  container.innerHTML = scenes
    .map(
      (scene, index) => `
    <article class="scene-card" data-index="${index}">
      <div class="scene-left">
        <div class="scene-number">${scene.sceneNumber}</div>
        ${
          scene.imageData
            ? `<div class="scene-thumb-wrap"><img class="scene-thumb" alt="" src="${scenePreviewSrc(scene)}" /></div>`
            : `<div class="scene-thumb-placeholder">이미지 없음</div>`
        }
        <div class="scene-asset-actions">
          <button type="button" class="secondary tiny" data-action="img-one" data-i="${index}">이미지</button>
        </div>
        ${
          scene.audioData
            ? `<audio class="scene-audio" controls src="data:audio/mpeg;base64,${scene.audioData}"></audio>`
            : ""
        }
        ${
          scene.videoData
            ? `<a class="scene-video-link" href="${escapeHtml(scene.videoData)}" target="_blank" rel="noopener">영상 URL 열기</a>`
            : ""
        }
      </div>
      <div class="scene-body">
        <label class="field">
          <span>나레이션</span>
          <textarea data-field="narration">${escapeHtml(scene.narration)}</textarea>
        </label>
        <label class="field">
          <span>이미지 프롬프트</span>
          <textarea data-field="visualPrompt">${escapeHtml(scene.visualPrompt)}</textarea>
        </label>
        <div class="scene-meta">
          <span class="tag">${escapeHtml(scene.analysis.sentiment)}</span>
          <span class="tag">${escapeHtml(scene.analysis.composition_type)}</span>
        </div>
      </div>
    </article>
  `
    )
    .join("");

  container.querySelectorAll("textarea").forEach((textarea) => {
    textarea.addEventListener("input", (event) => {
      const card = event.target.closest(".scene-card");
      const index = Number(card.dataset.index);
      const field = event.target.dataset.field;
      scenes[index][field] = event.target.value;
    });
  });

  container.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const action = btn.dataset.action;
      if (action === "img-one") runSingleImage(i);
    });
  });
}

function setPipelineBusy(busy) {
  if (!busy) pipelineAbort = false;
  ["genImagesBtn", "exportMp4Btn"].forEach((id) => {
    const b = el(id);
    if (b) b.disabled = !!busy;
  });
}

async function runSingleImage(index) {
  const settings = getSettings();
  if (!settings.geminiKey) {
    log("Gemini 키가 필요합니다.");
    return;
  }
  setStatus(`이미지 씬 ${index + 1}`, "");
  try {
    const stylePrompt = getGeminiStylePromptText();
    const b64 = await generateImageForScene(scenes[index], { character: [], style: [] }, settings.geminiKey, {
      imageModel: settings.geminiImageModel,
      geminiStylePrompt: stylePrompt,
    });
    if (!b64) throw new Error("이미지 생성 실패");
    scenes[index].imageData = b64;
    renderStoryboard();
    log(`씬 ${index + 1} 이미지 생성 완료`);
    setStatus("완료", "ok");
  } catch (e) {
    log(e.message || String(e));
    setStatus("오류", "error");
  }
}

async function runSingleTts(index) {
  const settings = getSettings();
  if (!settings.elevenLabsKey || !settings.elevenLabsVoice) {
    log("ElevenLabs 키와 Voice ID를 설정하세요.");
    return;
  }
  const text = scenes[index].narration?.trim();
  if (!text) return;
  setStatus(`TTS 씬 ${index + 1}`, "");
  try {
    const res = await generateAudioWithElevenLabs(text, {
      apiKey: settings.elevenLabsKey,
      voiceId: settings.elevenLabsVoice,
      modelId: settings.elevenLabsModel,
      geminiKey: settings.geminiKey,
      geminiModel: settings.geminiModel,
    });
    if (!res.audioData) throw new Error("TTS 실패 (CORS 또는 키 오류 가능)");
    scenes[index].audioData = res.audioData;
    scenes[index].subtitleData = res.subtitleData;
    scenes[index].audioDuration = res.estimatedDuration;
    renderStoryboard();
    log(`씬 ${index + 1} TTS 완료`);
    setStatus("완료", "ok");
  } catch (e) {
    log(e.message || String(e));
    setStatus("오류", "error");
  }
}

async function runSingleFal(index) {
  const settings = getSettings();
  if (!settings.falKey || !scenes[index].imageData) return;
  setStatus(`FAL 씬 ${index + 1}`, "");
  try {
    const motion = `Gentle subtle motion: ${(scenes[index].visualPrompt || "").slice(0, 200)}`;
    const url = await generateVideoFromImage(scenes[index].imageData, motion, settings.falKey);
    if (!url) throw new Error("FAL 영상 생성 실패");
    scenes[index].videoData = url;
    scenes[index].videoDuration = ANIMATION.VIDEO_DURATION;
    renderStoryboard();
    log(`씬 ${index + 1} FAL 영상 완료`);
    setStatus("완료", "ok");
  } catch (e) {
    log(e.message || String(e));
    setStatus("오류", "error");
  }
}

async function runAllImages() {
  const settings = getSettings();
  if (!settings.geminiKey) {
    log("Gemini API 키가 필요합니다.");
    return;
  }
  setPipelineBusy(true);
  const stylePrompt = getGeminiStylePromptText();
  try {
    for (let i = 0; i < scenes.length; i++) {
      setStatus(`이미지 ${i + 1}/${scenes.length}`, "");
      log(`이미지 생성 중 씬 ${i + 1}/${scenes.length}`);
      const b64 = await generateImageForScene(scenes[i], { character: [], style: [] }, settings.geminiKey, {
        imageModel: settings.geminiImageModel,
        geminiStylePrompt: stylePrompt,
      });
      if (b64) scenes[i].imageData = b64;
      else log(`씬 ${i + 1} 이미지 실패`);
      renderStoryboard();
    }
    setStatus("이미지 일괄 완료", "ok");
    log("전체 이미지 생성 작업 종료");
  } catch (e) {
    log(e.message || String(e));
    setStatus("오류", "error");
  } finally {
    setPipelineBusy(false);
  }
}

async function runAllTts() {
  const settings = getSettings();
  if (!settings.elevenLabsKey || !settings.elevenLabsVoice) {
    log("ElevenLabs 키와 Voice ID를 입력하세요.");
    return;
  }
  setPipelineBusy(true);
  try {
    for (let i = 0; i < scenes.length; i++) {
      const text = scenes[i].narration?.trim();
      if (!text) continue;
      setStatus(`TTS ${i + 1}/${scenes.length}`, "");
      log(`TTS 생성 중 씬 ${i + 1}/${scenes.length}`);
      const res = await generateAudioWithElevenLabs(text, {
        apiKey: settings.elevenLabsKey,
        voiceId: settings.elevenLabsVoice,
        modelId: settings.elevenLabsModel,
        geminiKey: settings.geminiKey,
        geminiModel: settings.geminiModel,
      });
      if (res.audioData) {
        scenes[i].audioData = res.audioData;
        scenes[i].subtitleData = res.subtitleData;
        scenes[i].audioDuration = res.estimatedDuration;
      } else {
        log(`씬 ${i + 1} TTS 실패`);
      }
      renderStoryboard();
    }
    setStatus("TTS 일괄 완료", "ok");
    log("전체 TTS 작업 종료");
  } catch (e) {
    log(e.message || String(e));
    setStatus("오류", "error");
  } finally {
    setPipelineBusy(false);
  }
}

async function runFalBatch() {
  const settings = getSettings();
  if (!settings.falKey) {
    log("FAL API 키가 필요합니다.");
    return;
  }
  const limit = Math.min(
    Math.max(1, Number(el("falSceneLimit").value) || ANIMATION.ENABLED_SCENES),
    scenes.length
  );
  setPipelineBusy(true);
  try {
    for (let i = 0; i < limit; i++) {
      if (!scenes[i].imageData) {
        log(`씬 ${i + 1}: 이미지 없음, 건너뜀`);
        continue;
      }
      setStatus(`FAL ${i + 1}/${limit}`, "");
      log(`FAL 영상 씬 ${i + 1}/${limit}`);
      const motion = `Gentle subtle motion: ${(scenes[i].visualPrompt || "").slice(0, 200)}`;
      const url = await generateVideoFromImage(scenes[i].imageData, motion, settings.falKey);
      if (url) {
        scenes[i].videoData = url;
        scenes[i].videoDuration = ANIMATION.VIDEO_DURATION;
      } else {
        log(`씬 ${i + 1} FAL 실패`);
      }
      renderStoryboard();
      if (i < limit - 1) await new Promise((r) => setTimeout(r, 1200));
    }
    setStatus("FAL 일괄 완료", "ok");
    log("FAL 영상 변환 작업 종료");
  } catch (e) {
    log(e.message || String(e));
    setStatus("오류", "error");
  } finally {
    setPipelineBusy(false);
  }
}

async function runExportMp4() {
  pipelineAbort = false;
  const valid = scenes.filter((s) => s.imageData);
  if (!valid.length) {
    log("이미지가 있는 씬이 없습니다. 먼저 이미지를 생성하세요.");
    return;
  }
  setPipelineBusy(true);
  setStatus("MP4 렌더링", "");
  log("MP4/WebM 렌더링 시작 (브라우저 인코더 사용)");

  try {
    const result = await generateVideo(
      scenes,
      (msg) => {
        log(msg);
        setStatus(msg.slice(0, 24), "");
      },
      abortRef,
      { enableSubtitles: true }
    );

    if (!result?.videoBlob) throw new Error("렌더 결과 없음");

    const ext = result.mimeType?.includes("mp4") ? "mp4" : "webm";
    const filename = `tubegen-export.${ext}`;
    const url = URL.createObjectURL(result.videoBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    log(`다운로드: ${filename} (${result.mimeType})`);
    setStatus("내보내기 완료", "ok");
  } catch (e) {
    log(e.message || String(e));
    setStatus("오류", "error");
  } finally {
    setPipelineBusy(false);
  }
}

function cancelPipeline() {
  pipelineAbort = true;
  log("취소 요청됨 (렌더링 중일 때만 적용)");
}

function saveCurrentProject() {
  if (!scenes.length) {
    log("저장할 씬이 없습니다.");
    return;
  }
  const name = el("projectName").value.trim() || el("topicInput").value.trim() || `project-${Date.now()}`;
  const project = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name,
    topic: el("topicInput").value.trim(),
    createdAt: Date.now(),
    scenes: scenes.map((s) => ({ ...s })),
  };
  const projects = getProjects();
  projects.unshift(project);
  saveProjects(projects);
  renderProjects();
  setStatus("저장 완료", "ok");
  log(`프로젝트 저장: ${name}`);
}

function renderProjects() {
  const list = el("projectList");
  const projects = getProjects();
  if (!projects.length) {
    list.innerHTML = "<p class='help-text'>저장된 프로젝트가 없습니다.</p>";
    updateCounts();
    return;
  }

  list.innerHTML = projects
    .map(
      (project) => `
    <article class="project-item">
      <div>
        <strong>${escapeHtml(project.name)}</strong>
        <span>${new Date(project.createdAt).toLocaleString()} · ${project.scenes.length}씬</span>
      </div>
      <div class="button-row compact">
        <button class="secondary" data-load="${project.id}">불러오기</button>
        <button class="danger" data-delete="${project.id}">삭제</button>
      </div>
    </article>
  `
    )
    .join("");

  list.querySelectorAll("[data-load]").forEach((button) => {
    button.addEventListener("click", () => loadProject(button.dataset.load));
  });
  list.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteProject(button.dataset.delete));
  });
  updateCounts();
}

function loadProject(id) {
  const project = getProjects().find((item) => item.id === id);
  if (!project) return;
  scenes = (project.scenes || []).map(ensureSceneShape);
  el("projectName").value = project.name || "";
  el("topicInput").value = project.topic || "";
  renderStoryboard();
  switchView("create");
  setStatus("불러오기 완료", "ok");
  log(`프로젝트 불러오기: ${project.name}`);
  updateCounts();
}

function deleteProject(id) {
  saveProjects(getProjects().filter((project) => project.id !== id));
  renderProjects();
  log("프로젝트 삭제 완료");
}

function clearAll() {
  scenes = [];
  renderStoryboard();
  updateCounts();
  setStatus("비움", "");
  log("스토리보드 비움");
}

function exportJson() {
  if (!scenes.length) return log("내보낼 씬이 없습니다.");
  downloadFile("storyboard.json", JSON.stringify({ scenes }, null, 2), "application/json");
}

function exportCsv() {
  if (!scenes.length) return log("내보낼 씬이 없습니다.");
  const header = ["sceneNumber", "narration", "visualPrompt", "sentiment", "composition_type"];
  const rows = scenes.map((scene) => [
    scene.sceneNumber,
    scene.narration,
    scene.visualPrompt,
    scene.analysis.sentiment,
    scene.analysis.composition_type,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  downloadFile("storyboard.csv", "\ufeff" + csv, "text/csv;charset=utf-8");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  log(`파일 내보내기: ${filename}`);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function testKey() {
  saveSettings();
  setStatus("키 테스트 중", "");
  try {
    const result = await callGemini('Return JSON only: {"ok": true, "message": "ready"}');
    if (!result.ok) throw new Error("예상 응답이 아닙니다.");
    setStatus("키 정상", "ok");
    log("Gemini API 키 테스트 성공");
  } catch (error) {
    setStatus("키 오류", "error");
    log(error.message);
  }
}

function bindEvents() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  el("generateBtn").addEventListener("click", generateStoryboard);
  el("splitBtn").addEventListener("click", splitOnly);
  el("saveBtn").addEventListener("click", saveCurrentProject);
  el("exportJsonBtn").addEventListener("click", exportJson);
  el("exportCsvBtn").addEventListener("click", exportCsv);
  el("clearBtn").addEventListener("click", clearAll);
  el("refreshProjectsBtn").addEventListener("click", renderProjects);
  el("saveSettingsBtn").addEventListener("click", saveSettings);
  el("testKeyBtn").addEventListener("click", testKey);

  el("genImagesBtn").addEventListener("click", runAllImages);
  el("exportMp4Btn").addEventListener("click", runExportMp4);
  el("pipelineCancelBtn").addEventListener("click", cancelPipeline);

  el("geminiStyle").addEventListener("change", syncCustomStyleVisibility);

  // New Events
  el("startAutoBtn").addEventListener("click", startAutomation);
  el("toggleAdvancedAuto").addEventListener("click", () => {
    const adv = el("advancedAutoSettings");
    const isHidden = adv.style.display === "none";
    adv.style.display = isHidden ? "block" : "none";
    el("toggleAdvancedAuto").textContent = isHidden ? "고급 설정 숨기기" : "고급 설정 표시";
  });
  el("finalizeVideoBtn").addEventListener("click", finalizeVideo);
  el("extractSubtitleBtn").addEventListener("click", extractSubtitles);
  el("copySubtitleBtn").addEventListener("click", copySubtitles);
  el("sendToStoryboardBtn").addEventListener("click", sendToStoryboard);
}

function boot() {
  loadSettings();
  bindEvents();
  renderStoryboard();
  renderProjects();
  updateCounts();
  log("HTML/JS 파이프라인 로드 완료 (Gemini 이미지·MP4)");
}

boot();
