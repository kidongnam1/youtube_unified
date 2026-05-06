
import { GeneratedAsset, SubtitleData, DEFAULT_SUBTITLE_CONFIG } from '../types';
import { RecordedSubtitleEntry } from './videoService';

/**
 * 시간(초)을 SRT 타임스탬프 형식으로 변환
 * 형식: HH:MM:SS,mmm
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * 오디오 디코딩: videoService와 동일한 방식으로 실제 오디오 길이 계산
 */
async function decodeAudioDuration(base64: string): Promise<number> {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    try {
      // MP3/WAV (ElevenLabs)
      const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
      return audioBuffer.duration;
    } catch (e) {
      // Raw PCM (Gemini) - 24000Hz 모노
      const dataInt16 = new Int16Array(bytes.buffer);
      return dataInt16.length / 24000;
    }
  } finally {
    await audioCtx.close();
  }
}

interface SrtChunk {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
}

/**
 * 자막 데이터를 SRT 청크로 변환 (간격 없이 연속)
 */
function createSrtChunks(
  subtitleData: SubtitleData,
  sceneStartTime: number,
  wordsPerChunk: number = DEFAULT_SUBTITLE_CONFIG.wordsPerLine
): SrtChunk[] {
  const chunks: SrtChunk[] = [];
  const words = subtitleData.words;

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const chunkWords = words.slice(i, Math.min(i + wordsPerChunk, words.length));
    if (chunkWords.length === 0) continue;

    const text = chunkWords.map(w => w.word).join(' ');

    chunks.push({
      index: chunks.length + 1,
      startTime: sceneStartTime + chunkWords[0].start,
      endTime: sceneStartTime + chunkWords[chunkWords.length - 1].end,
      text
    });
  }

  // 청크 간 간격 제거: endTime을 다음 청크의 startTime까지 연장
  for (let i = 0; i < chunks.length - 1; i++) {
    chunks[i].endTime = chunks[i + 1].startTime;
  }

  return chunks;
}

/**
 * 전체 에셋에서 SRT 파일 내용 생성
 * - videoService.ts와 100% 동일한 타임라인 계산 방식 사용
 * - 실제 오디오 파일을 디코딩해서 정확한 길이 사용
 */
export async function generateSrtContent(assets: GeneratedAsset[]): Promise<string> {
  const allChunks: SrtChunk[] = [];
  let timelinePointer = 0;
  let globalIndex = 1;

  // videoService와 동일: 이미지가 있는 씬만 포함
  const validAssets = assets.filter(a => a.imageData);

  // 각 씬의 오디오 길이 계산을 위한 기본값 (videoService와 동일)
  const DEFAULT_DURATION = 3;

  for (const asset of validAssets) {
    // videoService와 100% 동일한 duration 계산 로직
    // 오디오가 있으면 디코딩해서 실제 길이 사용, 없으면 기본 3초
    let sceneDuration = DEFAULT_DURATION;

    if (asset.audioData) {
      try {
        // videoService와 동일하게 실제 오디오를 디코딩해서 정확한 길이 계산
        sceneDuration = await decodeAudioDuration(asset.audioData);
      } catch (e) {
        console.warn(`[SRT] 씬 ${asset.sceneNumber} 오디오 디코딩 실패, 기본 ${DEFAULT_DURATION}초 사용`);
        // videoService와 동일: 디코딩 실패시 기본값
      }
    }
    // videoService와 동일: 오디오 없으면 기본 3초 (다른 폴백 없음)

    if (!asset.subtitleData || asset.subtitleData.words.length === 0) {
      // 자막 없는 씬은 오디오 길이만큼 건너뜀
      timelinePointer += sceneDuration;
      continue;
    }

    // 씬의 자막 청크 생성
    const sceneChunks = createSrtChunks(
      asset.subtitleData,
      timelinePointer,
      DEFAULT_SUBTITLE_CONFIG.wordsPerLine
    );

    // 인덱스 재할당
    for (const chunk of sceneChunks) {
      chunk.index = globalIndex++;
      allChunks.push(chunk);
    }

    // 씬 끝 시간: 실제 오디오 길이 사용 (videoService와 동일)
    timelinePointer += sceneDuration;
  }

  // 전체 청크 간 간격 제거 (씬 사이도)
  for (let i = 0; i < allChunks.length - 1; i++) {
    if (allChunks[i].endTime < allChunks[i + 1].startTime) {
      allChunks[i].endTime = allChunks[i + 1].startTime;
    }
  }

  // SRT 형식으로 변환
  const srtLines: string[] = [];

  for (const chunk of allChunks) {
    srtLines.push(chunk.index.toString());
    srtLines.push(`${formatSrtTime(chunk.startTime)} --> ${formatSrtTime(chunk.endTime)}`);
    srtLines.push(chunk.text);
    srtLines.push(''); // 빈 줄
  }

  return srtLines.join('\n');
}

/**
 * SRT 파일 다운로드 (기존 방식 - 비동기 계산)
 */
export async function downloadSrt(assets: GeneratedAsset[], filename: string = 'subtitles.srt'): Promise<void> {
  const srtContent = await generateSrtContent(assets);

  if (!srtContent.trim()) {
    alert('자막 데이터가 없습니다. ElevenLabs로 오디오를 생성해주세요.');
    return;
  }

  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 영상 렌더링 시 실제 기록된 타이밍으로 SRT 생성
 * - videoService에서 기록한 정확한 타이밍 사용
 * - 영상과 100% 동일한 자막 타이밍 보장
 */
export function generateSrtFromRecorded(recordedSubtitles: RecordedSubtitleEntry[]): string {
  if (recordedSubtitles.length === 0) {
    return '';
  }

  const srtLines: string[] = [];

  for (let i = 0; i < recordedSubtitles.length; i++) {
    const entry = recordedSubtitles[i];

    srtLines.push((i + 1).toString());
    srtLines.push(`${formatSrtTime(entry.startTime)} --> ${formatSrtTime(entry.endTime)}`);
    // 줄바꿈 문자를 SRT 형식에 맞게 유지
    srtLines.push(entry.text);
    srtLines.push(''); // 빈 줄
  }

  return srtLines.join('\n');
}

/**
 * 영상 렌더링 후 기록된 타이밍으로 SRT 다운로드
 */
export function downloadSrtFromRecorded(
  recordedSubtitles: RecordedSubtitleEntry[],
  filename: string = 'subtitles.srt'
): void {
  const srtContent = generateSrtFromRecorded(recordedSubtitles);

  if (!srtContent.trim()) {
    alert('자막 데이터가 없습니다.');
    return;
  }

  const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
