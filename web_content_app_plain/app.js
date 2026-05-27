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
let lastRenderedVideoPath = localStorage.getItem("tubegen_plain_last_video_path") || "";
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

function normalizeHeaderValue(value, label) {
  const cleaned = String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!cleaned) return "";
  if (/[^\x21-\x7E]/.test(cleaned)) {
    throw new Error(`${label}에 한글, 공백, 특수 공백이 섞여 있습니다. API 키만 다시 붙여넣으세요.`);
  }
  return cleaned;
}

function getSettings() {
  return {
    geminiKey: el("geminiKey")?.value || localStorage.getItem(STORAGE_KEYS.geminiKey) || "",
    geminiModel: el("geminiModel")?.value || localStorage.getItem(STORAGE_KEYS.geminiModel) || "gemini-2.5-flash",
    geminiImageModel: el("geminiImageModel")?.value || localStorage.getItem(STORAGE_KEYS.geminiImageModel) || DEFAULT_GEMINI_IMAGE_MODEL,
    geminiStyle: el("geminiStyle")?.value || localStorage.getItem(STORAGE_KEYS.geminiStyle) || "gemini-crayon",
    geminiCustomStyle: el("geminiCustomStyle")?.value || localStorage.getItem(STORAGE_KEYS.geminiCustomStyle) || "",
    elevenLabsKey: "",
    elevenLabsVoice: DEFAULT_VOICE_ID,
    elevenLabsModel: DEFAULT_ELEVENLABS_MODEL,
    falKey: "",
    falSceneLimit: ANIMATION.ENABLED_SCENES,
  };
}

function saveAiOptionsQuiet() {
  localStorage.setItem(STORAGE_KEYS.geminiModel, el("geminiModel").value);
  localStorage.setItem(STORAGE_KEYS.geminiImageModel, el("geminiImageModel").value);
  localStorage.setItem(STORAGE_KEYS.geminiStyle, el("geminiStyle").value);
  localStorage.setItem(STORAGE_KEYS.geminiCustomStyle, el("geminiCustomStyle").value.trim());
}

function getGeminiStylePromptText() {
  const s = getSettings();
  if (s.geminiStyle === "gemini-none") return "";
  if (s.geminiStyle === "gemini-custom") return s.geminiCustomStyle.trim();
  const preset = GEMINI_STYLE_PRESETS.find((p) => p.id === s.geminiStyle);
  return preset?.prompt || "";
}

function saveSettings() {
  let geminiKey = "";
  try {
    geminiKey = normalizeHeaderValue(el("geminiKey").value, "Gemini API Key");
  } catch (error) {
    setStatus("키 형식 오류", "error");
    log(error.message);
    return;
  }
  el("geminiKey").value = geminiKey;
  localStorage.setItem(STORAGE_KEYS.geminiKey, geminiKey);
  saveAiOptionsQuiet();
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

function setSettingsOpen(open) {
  const panel = el("settingsPanel");
  const backdrop = el("settingsBackdrop");
  const toggle = el("settingsToggleBtn");
  if (!panel || !backdrop || !toggle) return;
  panel.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", String(!open));
  toggle.setAttribute("aria-expanded", String(open));
  backdrop.hidden = !open;
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

function currentProjectName() {
  return el("projectName")?.value.trim()
    || el("autoProjectName")?.value.trim()
    || el("topicInput")?.value.trim()
    || "untitled_project";
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || "");
      const commaIndex = dataUrl.lastIndexOf(",");
      resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error || new Error("파일 변환 실패"));
    reader.readAsDataURL(blob);
  });
}

async function saveGeneratedAsset({ kind, filename, text, contentBase64, projectName = currentProjectName() }) {
  const response = await fetch(`${BACKEND_URL}/api/assets/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name: projectName,
      kind,
      filename,
      text,
      content_base64: contentBase64,
    }),
  });
  return readApiJson(response);
}

async function openFolder(folderPath) {
  const response = await fetch(`${BACKEND_URL}/api/system/open-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: folderPath }),
  });
  return readApiJson(response);
}

async function convertWebmToMp4(inputPath) {
  const finalInputPath = String(inputPath || "").trim();
  if (!finalInputPath) {
    log("변환할 WebM 파일 경로가 없습니다. 먼저 WebM 영상을 내보내세요.");
    return;
  }
  setStatus("MP4 변환 중", "");
  log(`MP4 변환 시작: ${finalInputPath}`);
  try {
    const response = await fetch(`${BACKEND_URL}/api/video/convert-to-mp4`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_path: finalInputPath }),
    });
    const result = await readApiJson(response);
    log(`MP4 변환 완료: ${result.output_path}`);
    setStatus("MP4 변환 완료", "ok");
    const ok = window.confirm(`MP4 변환 완료\n\n파일:\n${result.output_path}\n\n폴더를 열까요?`);
    if (ok) await openFolder(result.folder_path || result.output_path);
  } catch (error) {
    log(`MP4 변환 실패: ${error.message}`);
    setStatus("변환 오류", "error");
  }
}

async function convertLastVideo() {
  if (lastRenderedVideoPath && lastRenderedVideoPath.toLowerCase().endsWith(".webm")) {
    await convertWebmToMp4(lastRenderedVideoPath);
    return;
  }
  const input = el("convertVideoFileInput");
  if (input) input.click();
  else log("변환할 WebM 파일을 먼저 내보내세요.");
}

async function renderStoryboardMp4OnServer(validScenes) {
  const payloadScenes = validScenes.map((scene, index) => ({
    sceneNumber: scene.sceneNumber || index + 1,
    imageData: scene.imageData,
    duration: Math.max(1, Number(scene.audioDuration) || Number(scene.videoDuration) || 5),
  }));
  const response = await fetch(`${BACKEND_URL}/api/video/render-storyboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_name: currentProjectName(),
      default_duration: 5,
      scenes: payloadScenes,
    }),
  });
  return readApiJson(response);
}

async function confirmSavedLocation(saved, label) {
  if (!saved?.folder_path) return;
  log(`${label} 저장 위치: ${saved.file_path}`);
  const ok = window.confirm(`${label} 저장 완료\n\n파일:\n${saved.file_path}\n\n폴더를 열까요?`);
  if (ok) {
    try {
      await openFolder(saved.folder_path);
    } catch (error) {
      log(`폴더 열기 실패: ${error.message}`);
    }
  }
}

async function saveSceneImageFile(index, imageBase64) {
  const sceneNumber = scenes[index]?.sceneNumber || index + 1;
  return saveGeneratedAsset({
    kind: "images",
    filename: `scene_${String(sceneNumber).padStart(3, "0")}.png`,
    contentBase64: imageBase64,
  });
}

async function saveStoryboardSnapshot(label = "스토리보드") {
  if (!scenes.length) return null;
  try {
    const saved = await saveGeneratedAsset({
      kind: "storyboards",
      filename: `storyboard_${timestampName()}.json`,
      text: JSON.stringify({ scenes }, null, 2),
    });
    await confirmSavedLocation(saved, label);
    return saved;
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("HTTP 404")) {
      log("씬은 생성됐지만 자동 저장 API가 아직 적용되지 않았습니다. 런처와 브라우저를 완전히 닫고 다시 실행하세요.");
    } else {
      log(`씬 자동 저장 실패: ${message}`);
    }
    return null;
  }
}

async function callGemini(prompt) {
  const { geminiModel } = getSettings();
  const geminiKey = normalizeHeaderValue(getSettings().geminiKey, "Gemini API Key");
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

async function readApiJson(response) {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!response.ok) {
    const detail = data.detail || data.message || response.statusText;
    throw new Error(`HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return data;
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
    const createData = await readApiJson(createResp);
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
    const searchData = await readApiJson(searchResp);
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
      <p style="font-size: 0.8rem; margin: 5px 0;">시간: ${Number(c.timestamp_sec || 0).toFixed(2)}s</p>
      <p style="font-size: 0.8rem; color: var(--text-muted); word-break: break-all; opacity: 0.7;">${String(c.frame_path || "").split('\\').pop()}</p>
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
    const processData = await readApiJson(processResp);
    autoLog(`합성 완료: ${processData.final_video_path}`);
    setAutoStatus("완료", "ok");
    const ok = window.confirm(`영상이 생성되었습니다.\n\n${processData.final_video_path}\n\n저장 폴더를 열까요?`);
    if (ok) await openFolder(processData.final_video_path);
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
    await saveStoryboardSnapshot("생성된 씬 JSON");
  } catch (error) {
    setStatus("오류", "error");
    log(error.message);
  } finally {
    el("generateBtn").disabled = false;
    updateCounts();
  }
}

async function splitOnly() {
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
  try {
    await saveStoryboardSnapshot("분할된 씬 JSON");
  } catch (error) {
    log(`씬 자동 저장 실패: ${error.message}`);
  }
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
  applyTooltips(container);
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
    const saved = await saveSceneImageFile(index, b64);
    renderStoryboard();
    log(`씬 ${index + 1} 이미지 생성 완료`);
    await confirmSavedLocation(saved, `씬 ${index + 1} 이미지`);
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
  let lastSaved = null;
  let savedCount = 0;
  try {
    for (let i = 0; i < scenes.length; i++) {
      setStatus(`이미지 ${i + 1}/${scenes.length}`, "");
      log(`이미지 생성 중 씬 ${i + 1}/${scenes.length}`);
      const b64 = await generateImageForScene(scenes[i], { character: [], style: [] }, settings.geminiKey, {
        imageModel: settings.geminiImageModel,
        geminiStylePrompt: stylePrompt,
      });
      if (b64) {
        scenes[i].imageData = b64;
        lastSaved = await saveSceneImageFile(i, b64);
        savedCount += 1;
      } else {
        log(`씬 ${i + 1} 이미지 실패`);
      }
      renderStoryboard();
    }
    setStatus("이미지 일괄 완료", "ok");
    log(`전체 이미지 생성 작업 종료: ${savedCount}개 파일 저장`);
    if (lastSaved) await confirmSavedLocation(lastSaved, "전체 이미지");
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
  log("FFmpeg 서버 MP4 렌더링 시작");

  try {
    const saved = await renderStoryboardMp4OnServer(valid);
    lastRenderedVideoPath = saved.output_path || "";
    if (lastRenderedVideoPath) {
      localStorage.setItem("tubegen_plain_last_video_path", lastRenderedVideoPath);
    }
    log(`MP4 렌더링 완료: ${saved.output_path} (${saved.scene_count}씬, 약 ${Math.round(saved.duration_seconds)}초)`);
    await confirmSavedLocation(
      { file_path: saved.output_path, folder_path: saved.folder_path },
      "MP4 영상"
    );
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
  applyTooltips(list);
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

async function exportJson() {
  if (!scenes.length) return log("내보낼 씬이 없습니다.");
  await downloadFile(`storyboard_${timestampName()}.json`, JSON.stringify({ scenes }, null, 2), "application/json", "exports", "JSON 파일");
}

async function exportCsv() {
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
  await downloadFile(`storyboard_${timestampName()}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8", "exports", "CSV 파일");
}

async function downloadFile(filename, content, type, kind = "exports", label = "파일") {
  let saved = null;
  try {
    saved = await saveGeneratedAsset({ kind, filename, text: content });
  } catch (error) {
    log(`서버 폴더 저장 실패: ${error.message}`);
  }
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
  if (saved) await confirmSavedLocation(saved, label);
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

function applyTooltips(root = document) {
  const tips = [
    [".nav-button[data-view='create']", "대본을 씬으로 나누고 이미지와 영상 내보내기를 준비합니다."],
    [".nav-button[data-view='automation']", "영상 URL이나 파일에서 장면과 자막을 자동 처리합니다."],
    [".nav-button[data-view='subtitles']", "유튜브 영상의 자막을 가져와 대본으로 활용합니다."],
    [".nav-button[data-view='projects']", "브라우저에 저장한 작업을 불러오거나 삭제합니다."],
    ["#settingsToggleBtn", "Gemini API 키 설정 패널을 엽니다."],
    ["#settingsCloseBtn", "API 키 설정 패널을 닫습니다."],
    ["#geminiKey", "스토리보드와 이미지 생성을 위한 Gemini API 키입니다."],
    ["#geminiModel", "스토리보드 생성과 텍스트 처리에 사용할 Gemini 모델입니다."],
    ["#geminiImageModel", "씬 이미지를 생성할 Gemini 이미지 모델입니다."],
    ["#geminiStyle", "모든 씬 이미지에 적용할 기본 화풍을 고릅니다."],
    ["#geminiCustomStyle", "커스텀 화풍을 영어 프롬프트로 입력합니다."],
    ["#saveSettingsBtn", "API 키와 모델 설정을 이 브라우저에 저장합니다."],
    ["#testKeyBtn", "저장한 Gemini API 키가 동작하는지 확인합니다."],
    ["#statusPill", "현재 앱 작업 상태를 짧게 보여줍니다."],
    ["#projectName", "저장 목록에서 구분할 스토리보드 작업 이름입니다."],
    ["#topicInput", "대본이 없을 때 AI가 참고할 영상 주제입니다."],
    ["#scriptInput", "직접 쓴 대본이나 추출한 자막을 붙여넣습니다."],
    ["#generateBtn", "주제나 대본을 바탕으로 AI 스토리보드를 만듭니다."],
    ["#splitBtn", "AI 생성 없이 입력 대본을 문장 기준으로 씬 분할합니다."],
    ["#sceneCount", "현재 스토리보드에 들어 있는 씬 수입니다."],
    ["#savedCount", "브라우저에 저장된 프로젝트 수입니다."],
    ["#logBox", "스토리보드와 미디어 작업 진행 기록입니다."],
    ["#genImagesBtn", "모든 씬의 이미지 프롬프트로 이미지를 생성합니다."],
    ["#exportMp4Btn", "이미지와 오디오를 묶어 MP4 또는 WebM으로 저장합니다."],
    ["#convertLastVideoBtn", "마지막으로 저장한 WebM 영상을 MP4로 변환합니다."],
    ["#pipelineCancelBtn", "진행 중인 렌더링 취소를 요청합니다."],
    ["#saveBtn", "현재 스토리보드와 에셋을 브라우저에 저장합니다."],
    ["#exportJsonBtn", "씬 데이터 전체를 JSON 파일로 내려받습니다."],
    ["#exportCsvBtn", "씬 번호, 나레이션, 프롬프트를 CSV로 내려받습니다."],
    ["#clearBtn", "현재 화면의 스토리보드 작업 내용을 비웁니다."],
    ["#storyboard", "생성된 씬을 편집하고 이미지 결과를 확인합니다."],
    ["#autoProjectName", "영상 자동화 결과를 구분할 작업 이름입니다."],
    ["#videoSource", "유튜브 주소 또는 로컬 영상 파일 경로를 입력합니다."],
    ["#startAutoBtn", "스마트 장면 검색과 자막 추출을 백엔드로 실행합니다."],
    ["#toggleAdvancedAuto", "장면 검색 방식과 샘플링 옵션을 열고 닫습니다."],
    ["#autoSearchMode", "중요 장면 위주 또는 균일 추출 방식을 고릅니다."],
    ["#autoResultCount", "찾을 후보 장면 개수를 정합니다."],
    ["#autoSamplingInterval", "영상을 몇 초 간격으로 검사할지 정합니다."],
    ["#autoMinGap", "후보 장면 사이 최소 시간 간격입니다."],
    ["#autoLogBox", "백엔드 영상 자동화 처리 로그입니다."],
    ["#autoStatusPill", "영상 자동화 처리 상태입니다."],
    ["#autoCandidates", "자동 검색으로 찾은 후보 장면 목록입니다."],
    ["#finalizeVideoBtn", "선택된 결과로 자막 포함 최종 영상을 합성합니다."],
    ["#subtitleYoutubeUrl", "자막을 가져올 유튜브 영상 주소입니다."],
    ["#subtitleLangs", "우선 검색할 자막 언어 코드입니다. 예: ko,en"],
    ["#extractSubtitleBtn", "유튜브 자막을 가져와 텍스트로 표시합니다."],
    ["#subtitleTextarea", "추출된 자막 원문입니다. 직접 편집은 막혀 있습니다."],
    ["#copySubtitleBtn", "추출한 자막을 클립보드에 복사합니다."],
    ["#sendToStoryboardBtn", "추출한 자막을 스토리보드 대본 입력칸으로 보냅니다."],
    ["#refreshProjectsBtn", "저장된 프로젝트 목록을 다시 읽습니다."],
    ["#projectList", "저장된 프로젝트를 불러오거나 삭제합니다."],
    [".scene-card", "씬 하나의 나레이션, 이미지 프롬프트, 생성 결과입니다."],
    [".scene-number", "스토리보드 안에서의 씬 순서입니다."],
    [".scene-thumb", "이 씬에 생성된 이미지 미리보기입니다."],
    [".scene-thumb-placeholder", "아직 이 씬의 이미지가 생성되지 않았습니다."],
    [".scene-audio", "이 씬의 TTS 오디오 미리듣기입니다."],
    [".scene-video-link", "FAL로 생성된 씬 영상 URL을 새 창에서 엽니다."],
    [".scene-card textarea[data-field='narration']", "영상에 읽힐 나레이션 문장입니다."],
    [".scene-card textarea[data-field='visualPrompt']", "이 씬 이미지 생성을 위한 영어 프롬프트입니다."],
    ["[data-action='img-one']", "이 씬 하나만 이미지를 다시 생성합니다."],
    ["[data-load]", "저장된 프로젝트를 현재 작업 화면으로 불러옵니다."],
    ["[data-delete]", "저장된 프로젝트를 브라우저 저장소에서 삭제합니다."],
  ];

  tips.forEach(([selector, text]) => {
    root.querySelectorAll(selector).forEach((node) => {
      node.setAttribute("title", text);
      if (/^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(node.tagName) && !node.getAttribute("aria-label")) {
        node.setAttribute("aria-label", text);
      }
    });
  });
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
  el("settingsToggleBtn").addEventListener("click", () => setSettingsOpen(true));
  el("settingsCloseBtn").addEventListener("click", () => setSettingsOpen(false));
  el("settingsBackdrop").addEventListener("click", () => setSettingsOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSettingsOpen(false);
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
  el("convertLastVideoBtn").addEventListener("click", convertLastVideo);
  el("convertVideoFileInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    log("브라우저 보안상 선택한 파일의 전체 경로를 읽을 수 없습니다. 먼저 이 앱에서 WebM을 내보낸 뒤 변환 버튼을 사용하세요.");
    event.target.value = "";
  });
  el("pipelineCancelBtn").addEventListener("click", cancelPipeline);

  ["geminiModel", "geminiImageModel", "geminiStyle"].forEach((id) => {
    el(id).addEventListener("change", () => {
      if (id === "geminiStyle") syncCustomStyleVisibility();
      saveAiOptionsQuiet();
      setStatus("AI 옵션 저장됨", "ok");
    });
  });
  el("geminiCustomStyle").addEventListener("input", saveAiOptionsQuiet);

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
  applyTooltips();
  renderStoryboard();
  renderProjects();
  updateCounts();
  log("HTML/JS 파이프라인 로드 완료 (Gemini 이미지·MP4)");
}

boot();
