/**
 * 캔버스 + MediaRecorder 기반 MP4/WebM 렌더링 (React videoService.ts 이식)
 * 브라우저가 MP4를 지원하면 MP4, 아니면 WebM으로 다운로드
 */

import { DEFAULT_SUBTITLE_CONFIG } from "./config.js";

async function decodeAudio(base64, ctx) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  try {
    return await ctx.decodeAudioData(bytes.buffer.slice(0));
  } catch {
    const dataInt16 = new Int16Array(bytes.buffer);
    const frameCount = dataInt16.length;
    const buffer = ctx.createBuffer(1, frameCount, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  }
}

function createSubtitleChunks(subtitleData, config) {
  if (!subtitleData || subtitleData.words.length === 0) return [];

  if (subtitleData.meaningChunks?.length > 0) {
    return subtitleData.meaningChunks.map((chunk) => ({
      text: chunk.text,
      startTime: chunk.startTime,
      endTime: chunk.endTime,
    }));
  }

  const chunks = [];
  const words = subtitleData.words;
  const wordsPerChunk = config.wordsPerLine * config.maxLines;

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunkWords = words.slice(i, Math.min(i + wordsPerChunk, words.length));
    if (chunkWords.length === 0) continue;

    const lines = [];
    for (let j = 0; j < chunkWords.length; j += config.wordsPerLine) {
      const lineWords = chunkWords.slice(j, j + config.wordsPerLine);
      lines.push(lineWords.map((w) => w.word).join(" "));
    }

    chunks.push({
      text: lines.join("\n"),
      startTime: chunkWords[0].start,
      endTime: chunkWords[chunkWords.length - 1].end,
    });
  }

  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].endTime = chunks[i + 1].startTime;
  }

  return chunks;
}

function getCurrentChunk(chunks, sceneElapsed) {
  if (chunks.length === 0) return null;

  for (const chunk of chunks) {
    if (sceneElapsed >= chunk.startTime && sceneElapsed <= chunk.endTime) return chunk;
  }

  for (let i = chunks.length - 1; i >= 0; i--) {
    if (sceneElapsed > chunks[i].endTime) {
      if (i + 1 < chunks.length && sceneElapsed < chunks[i + 1].startTime) return chunks[i];
      if (i === chunks.length - 1) return chunks[i];
      break;
    }
  }

  if (sceneElapsed < chunks[0].startTime && sceneElapsed >= 0) {
    if (chunks[0].startTime - sceneElapsed < 0.1) return chunks[0];
    return null;
  }

  return null;
}

function renderSubtitle(ctx, canvas, chunks, sceneElapsed, config) {
  const currentChunk = getCurrentChunk(chunks, sceneElapsed);
  if (!currentChunk) return;

  const lines = currentChunk.text.split("\n");
  if (lines.length === 0) return;

  const lineHeight = config.fontSize * 1.4;
  const padding = 20;
  const safeMargin = 10;

  ctx.font = `bold ${config.fontSize}px ${config.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const maxLineWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  let boxWidth = maxLineWidth + padding * 2;
  const boxHeight = lines.length * lineHeight + padding * 2;

  const maxBoxWidth = canvas.width - safeMargin * 2;
  if (boxWidth > maxBoxWidth) boxWidth = maxBoxWidth;

  const boxX = Math.max(safeMargin, (canvas.width - boxWidth) / 2);
  let boxY = canvas.height - config.bottomMargin - boxHeight;

  if (boxY < safeMargin) boxY = safeMargin;

  ctx.fillStyle = config.backgroundColor;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
  } else {
    ctx.rect(boxX, boxY, boxWidth, boxHeight);
  }
  ctx.fill();

  lines.forEach((line, lineIndex) => {
    const textY = boxY + padding + lineIndex * lineHeight;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.lineWidth = 4;
    ctx.strokeText(line, canvas.width / 2, textY);
    ctx.fillStyle = config.textColor;
    ctx.fillText(line, canvas.width / 2, textY);
  });
}

/**
 * @param {Array<{ imageData?: string|null, audioData?: string|null, subtitleData?: object|null, videoData?: string|null }>} assets
 */
export async function generateVideo(assets, onProgress, abortRef, options = {}) {
  const enableSubtitles = options.enableSubtitles !== false;
  const config = { ...DEFAULT_SUBTITLE_CONFIG, ...options.subtitleConfig };

  const validAssets = assets.filter((a) => a.imageData);
  if (validAssets.length === 0) throw new Error("에셋이 준비되지 않았습니다.");

  onProgress("에셋 메모리 사전 로딩 중 (1/3)...");

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContextClass();
  const destination = audioCtx.createMediaStreamDestination();

  const preparedScenes = [];
  let timelinePointer = 0;
  const DEFAULT_DURATION = Math.max(1, Number(options.defaultSceneDuration) || 5);

  for (let i = 0; i < validAssets.length; i++) {
    const asset = validAssets[i];
    onProgress(`데이터 디코딩 및 프레임 매칭 중 (${i + 1}/${validAssets.length})...`);

    const img = new Image();
    img.crossOrigin = "anonymous";

    function loadDataUrl(dataUrl) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Image load timeout")), 8000);
        img.onload = () => {
          clearTimeout(t);
          if (img.width === 0 || img.height === 0) reject(new Error("zero dimensions"));
          else resolve();
        };
        img.onerror = () => {
          clearTimeout(t);
          reject(new Error("Image load failed"));
        };
        img.src = dataUrl;
      });
    }

    try {
      await loadDataUrl(`data:image/png;base64,${asset.imageData}`);
    } catch {
      try {
        await loadDataUrl(`data:image/jpeg;base64,${asset.imageData}`);
      } catch {
        const placeholderCanvas = document.createElement("canvas");
        placeholderCanvas.width = 1280;
        placeholderCanvas.height = 720;
        const pCtx = placeholderCanvas.getContext("2d");
        if (pCtx) {
          pCtx.fillStyle = "#1a1a2e";
          pCtx.fillRect(0, 0, 1280, 720);
          pCtx.fillStyle = "#fff";
          pCtx.font = "bold 48px sans-serif";
          pCtx.textAlign = "center";
          pCtx.fillText(`씬 ${i + 1}`, 640, 360);
        }
        await loadDataUrl(placeholderCanvas.toDataURL());
      }
    }

    let video = null;
    let isAnimated = false;

    if (asset.videoData) {
      try {
        video = document.createElement("video");
        video.crossOrigin = "anonymous";
        video.src = asset.videoData;
        video.muted = true;
        video.playsInline = true;
        video.loop = true;

        await new Promise((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error("Video load failed"));
          setTimeout(() => reject(new Error("Video load timeout")), 10000);
        });

        isAnimated = true;
      } catch {
        video = null;
        isAnimated = false;
      }
    }

    let audioBuffer = null;
    let duration = Math.max(
      DEFAULT_DURATION,
      Number(asset.audioDuration) || 0,
      Number(asset.videoDuration) || 0
    );

    if (asset.audioData) {
      try {
        audioBuffer = await decodeAudio(asset.audioData, audioCtx);
        duration = Math.max(duration, audioBuffer.duration || 0);
      } catch {
        /* keep default */
      }
    }

    const subtitleChunks = enableSubtitles ? createSubtitleChunks(asset.subtitleData, config) : [];

    const startTime = timelinePointer;
    const endTime = startTime + duration;

    preparedScenes.push({
      img,
      video,
      isAnimated,
      audioBuffer,
      subtitleChunks,
      startTime,
      endTime,
      duration,
    });
    timelinePointer = endTime;
  }

  const totalDuration = timelinePointer;

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("캔버스 초기화 실패");

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp9,opus")
    ? "video/webm; codecs=vp9,opus"
    : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "";

  const recorderOptions = {
    videoBitsPerSecond: 12000000,
  };
  if (mimeType) recorderOptions.mimeType = mimeType;
  const recorder = new MediaRecorder(combinedStream, recorderOptions);

  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  const recordedSubtitles = [];
  let lastRecordedChunkText = null;
  let currentChunkStartTime = 0;
  let subtitleIndex = 0;

  return new Promise(async (resolve, reject) => {
    let isFinished = false;

    recorder.onstop = async () => {
      await audioCtx.close();

      if (lastRecordedChunkText !== null) {
        recordedSubtitles.push({
          index: subtitleIndex,
          startTime: currentChunkStartTime,
          endTime: totalDuration,
          text: lastRecordedChunkText,
        });
      }

      resolve({
        videoBlob: new Blob(chunks, { type: mimeType }),
        recordedSubtitles,
        mimeType,
      });
    };
    recorder.onerror = (e) => reject(e);

    if (audioCtx.state === "suspended") await audioCtx.resume();

    onProgress("실시간 동기화 렌더링 시작 (2/3)...");

    const initialDelay = 0.5;
    const masterStartTime = audioCtx.currentTime + initialDelay;

    preparedScenes.forEach((scene) => {
      if (scene.audioBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = scene.audioBuffer;
        source.connect(destination);
        source.start(masterStartTime + scene.startTime);
        source.stop(masterStartTime + scene.endTime);
      }
    });

    preparedScenes.forEach((scene, idx) => {
      if (scene.isAnimated && scene.video) {
        const videoStartDelay = (masterStartTime - audioCtx.currentTime + scene.startTime) * 1000;
        setTimeout(() => {
          if (!isFinished && scene.video) {
            scene.video.currentTime = 0;
            scene.video.play().catch(() => {});
          }
        }, Math.max(0, videoStartDelay));
      }
    });

    recorder.start(1000);

    const renderLoop = () => {
      if (isFinished) return;

      if (abortRef?.current) {
        isFinished = true;
        recorder.stop();
        return;
      }

      const currentAudioTime = audioCtx.currentTime;
      const elapsed = Math.max(0, currentAudioTime - masterStartTime);

      if (elapsed >= totalDuration) {
        isFinished = true;
        onProgress("렌더링 완료! 파일 생성 중...");
        setTimeout(() => recorder.stop(), 500);
        return;
      }

      let currentScene = preparedScenes.find((s) => elapsed >= s.startTime && elapsed <= s.endTime);

      if (!currentScene) {
        if (elapsed < preparedScenes[0].startTime) {
          currentScene = preparedScenes[0];
        } else {
          currentScene =
            preparedScenes.find((s) => elapsed < s.startTime) ||
            preparedScenes[preparedScenes.length - 1];
        }
      }

      if (ctx && currentScene) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const sceneProgress = Math.min(
          1,
          Math.max(0, (elapsed - currentScene.startTime) / currentScene.duration)
        );

        let rendered = false;

        if (currentScene.isAnimated && currentScene.video && currentScene.video.readyState >= 2) {
          const vid = currentScene.video;
          if (vid.videoWidth > 0 && vid.videoHeight > 0) {
            const ratio = Math.min(canvas.width / vid.videoWidth, canvas.height / vid.videoHeight);
            const scale = 1.0 + 0.05 * sceneProgress;
            const nw = vid.videoWidth * ratio * scale;
            const nh = vid.videoHeight * ratio * scale;
            ctx.drawImage(vid, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
            rendered = true;
          }
        }

        if (!rendered) {
          const im = currentScene.img;
          if (im.width > 0 && im.height > 0) {
            const ratio = Math.min(canvas.width / im.width, canvas.height / im.height);
            const scale = 1.0 + 0.1 * sceneProgress;
            const nw = im.width * ratio * scale;
            const nh = im.height * ratio * scale;
            ctx.drawImage(im, (canvas.width - nw) / 2, (canvas.height - nh) / 2, nw, nh);
          }
        }

        const sceneElapsed = elapsed - currentScene.startTime;
        renderSubtitle(ctx, canvas, currentScene.subtitleChunks, sceneElapsed, config);

        const currentChunk = getCurrentChunk(currentScene.subtitleChunks, sceneElapsed);
        const currentChunkText = currentChunk?.text || null;

        if (currentChunkText !== lastRecordedChunkText) {
          if (lastRecordedChunkText !== null) {
            recordedSubtitles.push({
              index: subtitleIndex,
              startTime: currentChunkStartTime,
              endTime: elapsed,
              text: lastRecordedChunkText,
            });
            subtitleIndex++;
          }
          if (currentChunkText !== null) {
            currentChunkStartTime = elapsed;
          }
          lastRecordedChunkText = currentChunkText;
        }

        const percent = Math.min(100, Math.round((elapsed / totalDuration) * 100));
        if (percent % 5 === 0) {
          onProgress(`동기화 렌더링 가동 중: ${percent}%`);
        }
      }

      requestAnimationFrame(renderLoop);
    };

    renderLoop();
  });
}
