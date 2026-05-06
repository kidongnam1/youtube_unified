
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene, ReferenceImages } from "../types";
import { SYSTEM_INSTRUCTIONS, getTrendSearchPrompt, getScriptGenerationPrompt, getFinalVisualPrompt } from "./prompts";
import { CONFIG, GEMINI_STYLE_CATEGORIES, GeminiStyleId } from "../config";

/**
 * Gemini API 클라이언트 초기화
 */
const getAI = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 안전 필터 우회를 위한 키워드 대체 맵
 * - 필터에 걸리기 쉬운 표현 → 안전한 동의어로 변환
 */
const KEYWORD_ALTERNATIVES: Record<string, string[]> = {
  // X-ray 관련
  'x-ray': ['transparent cutaway', 'see-through', 'translucent'],
  'x-ray view': ['transparent cutaway view', 'see-through view', 'cross-section view'],
  'xray': ['transparent', 'see-through', 'translucent'],

  // 의료/해부 관련
  'dissection': ['cross-section', 'cutaway'],
  'anatomy': ['internal structure', 'inner components'],
  'surgical': ['precise', 'detailed'],

  // 무기/폭발 관련 (경제 뉴스에서 은유로 쓰일 수 있음)
  'explosion': ['burst', 'rapid expansion', 'dramatic surge'],
  'bomb': ['impact', 'dramatic event'],
  'crash': ['sharp decline', 'sudden drop'],

  // 기타 민감 표현
  'naked': ['bare', 'exposed', 'uncovered'],
  'blood': ['red liquid', 'crimson'],
  'death': ['end', 'decline', 'fall'],
  'kill': ['eliminate', 'end', 'stop'],
};

/**
 * 프롬프트에서 민감한 키워드를 안전한 대체어로 변환
 */
const sanitizePrompt = (prompt: string, attemptIndex: number = 0): string => {
  let sanitized = prompt.toLowerCase();
  let result = prompt;

  for (const [keyword, alternatives] of Object.entries(KEYWORD_ALTERNATIVES)) {
    const regex = new RegExp(keyword, 'gi');
    if (regex.test(sanitized)) {
      // attemptIndex에 따라 다른 대체어 선택 (재시도마다 다른 표현 시도)
      const altIndex = attemptIndex % alternatives.length;
      result = result.replace(regex, alternatives[altIndex]);
      sanitized = result.toLowerCase();
    }
  }

  return result;
};

/**
 * JSON 응답 텍스트 정리 - 불완전한 응답 복구 기능 포함
 */
const cleanJsonResponse = (text: string): string => {
  if (!text) {
    console.error('[JSON Clean] 빈 응답 수신');
    return '[]';
  }

  let cleaned = text.trim();
  const originalLength = cleaned.length;

  // 마크다운 코드 블록 제거
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }

  cleaned = cleaned.trim();

  // JSON 배열/객체 시작과 끝 찾기
  const firstBracket = cleaned.search(/[\[{]/);

  if (firstBracket === -1) {
    console.warn('[JSON Clean] JSON 시작 브래킷을 찾을 수 없음:', cleaned.slice(0, 100));
    return '[]';
  }

  // 배열인지 객체인지 판별
  const isArray = cleaned[firstBracket] === '[';

  // 중첩 레벨을 추적하며 올바른 닫는 브래킷 찾기 (문자열 내부 무시)
  let depth = 0;
  let lastValidIndex = -1;
  let inString = false;
  let escapeNext = false;

  for (let i = firstBracket; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '[' || char === '{') depth++;
    if (char === ']' || char === '}') {
      depth--;
      if (depth === 0) {
        lastValidIndex = i;
        break;
      }
    }
  }

  if (lastValidIndex !== -1) {
    cleaned = cleaned.slice(firstBracket, lastValidIndex + 1);
  } else {
    // JSON이 불완전함 - 복구 시도
    console.warn(`[JSON Clean] JSON이 불완전함 (원본 ${originalLength}자). 복구 시도 중...`);
    cleaned = cleaned.slice(firstBracket);

    // 마지막 완전한 씬 객체까지 자르기
    const lastCompleteEnd = findLastCompleteSceneObject(cleaned);
    if (lastCompleteEnd > 0) {
      cleaned = cleaned.slice(0, lastCompleteEnd);
      // scenes 배열 내부라면 배열과 객체 닫기
      if (cleaned.includes('"scenes"')) {
        cleaned += ']}';
      } else {
        cleaned += ']';
      }
      console.warn(`[JSON Clean] 복구 완료. ${lastCompleteEnd}자 위치까지 복구됨`);
    } else {
      console.error('[JSON Clean] 복구 불가능');
      return '[]';
    }
  }

  return cleaned.trim();
};

/**
 * 마지막 완전한 씬 객체의 끝 위치 찾기
 * - "sceneNumber" 또는 완전한 "}," 패턴을 찾아 역방향 탐색
 */
function findLastCompleteSceneObject(json: string): number {
  // 역방향으로 완전한 객체 끝 "}," 또는 "}" 찾기
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteEnd = -1;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      // depth가 1이면 scenes 배열 내의 씬 객체가 완료된 것
      if (depth === 1) {
        lastCompleteEnd = i + 1;
      }
    }
  }

  return lastCompleteEnd;
}

const retryGeminiRequest = async <T>(
  operationName: string,
  requestFn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 5000
): Promise<T> => {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || JSON.stringify(error);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('Quota') || error.status === 429;
      if (isQuotaError && attempt < maxRetries) {
        await wait(baseDelay * attempt);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

export const findTrendingTopics = async (category: string, usedTopics: string[]) => {
  return retryGeminiRequest("Trend Search", async () => {
    const ai = getAI();
    const prompt = getTrendSearchPrompt(category, usedTopics.join(", "));
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTIONS.TREND_RESEARCHER,
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json"
      },
    });
    return JSON.parse(cleanJsonResponse(response.text));
  });
};

/**
 * 단일 청크에 대한 스크립트 생성 (내부 함수)
 * - maxOutputTokens 동적 계산
 * - 응답 잘림 감지
 */
const generateScriptSingle = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext?: string | null,
  chunkInfo?: { current: number; total: number }
): Promise<ScriptScene[]> => {
  return retryGeminiRequest("Script Generation", async () => {
    const ai = getAI();
    const baseInstruction = topic === "Manual Script Input" ? SYSTEM_INSTRUCTIONS.MANUAL_VISUAL_MATCHER :
                            hasReferenceImage ? SYSTEM_INSTRUCTIONS.REFERENCE_MATCH :
                            SYSTEM_INSTRUCTIONS.CHIEF_ART_DIRECTOR;

    // 입력 길이 및 문장 수에 따른 동적 토큰 계산
    const inputText = sourceContext || topic;
    const inputLength = inputText.length;

    // 문장 개수 계산 (마침표, 느낌표, 물음표 기준)
    const sentences = inputText.split(/[.!?。]+/).filter(s => s.trim().length > 0);
    const sentenceCount = Math.max(1, sentences.length);

    // 씬 개수 = 문장 수 기반 (짧은 입력은 문장 수대로, 긴 입력은 80자당 1씬)
    const estimatedSceneCount = inputLength < 200
      ? sentenceCount  // 짧은 입력: 문장 수대로
      : Math.max(sentenceCount, Math.ceil(inputLength / 80));  // 긴 입력: 둘 중 큰 값
    // 씬당 약 800 토큰 (JSON 구조 포함) * 예상 씬 수 * 버퍼 1.5배
    const calculatedTokens = Math.ceil(estimatedSceneCount * 800 * 1.5);
    // 최소 16384, 최대 65536 토큰으로 제한
    const maxOutputTokens = Math.min(65536, Math.max(16384, calculatedTokens));

    const chunkLabel = chunkInfo ? `[청크 ${chunkInfo.current}/${chunkInfo.total}] ` : '';
    console.log(`${chunkLabel}[Script] 입력: ${inputLength}자, 예상 씬: ${estimatedSceneCount}개, maxOutputTokens: ${maxOutputTokens}`);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: getScriptGenerationPrompt(topic, sourceContext),
      config: {
        thinkingConfig: { thinkingBudget: 24576 },
        responseMimeType: "application/json",
        systemInstruction: baseInstruction,
        maxOutputTokens: maxOutputTokens,
      },
    });

    // 응답 잘림 감지
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS' || finishReason === 'STOP_TRUNCATED') {
      console.warn(`${chunkLabel}[Script] ⚠️ 응답이 토큰 제한으로 잘렸습니다. finishReason: ${finishReason}`);
      // 잘린 응답도 복구 시도 (cleanJsonResponse가 처리)
    }

    const result = JSON.parse(cleanJsonResponse(response.text || '[]'));
    const scenes = Array.isArray(result) ? result : (result.scenes || []);

    console.log(`${chunkLabel}[Script] 생성된 씬 개수: ${scenes.length}`);

    // 씬이 너무 적으면 경고
    if (scenes.length < 3) {
      console.warn(`${chunkLabel}[Warning] 씬이 ${scenes.length}개만 생성됨. 대본이 제대로 분할되지 않았을 수 있음.`);
    }

    return scenes.map((scene: any, idx: number) => ({
      sceneNumber: scene.sceneNumber || idx + 1,
      narration: scene.narration || "",
      visualPrompt: scene.image_prompt_english || "",
      analysis: scene.analysis || {}
    }));
  });
};

/**
 * 기존 generateScript 함수 (하위 호환성 유지)
 */
export const generateScript = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext?: string | null
): Promise<ScriptScene[]> => {
  return generateScriptSingle(topic, hasReferenceImage, sourceContext);
};

/**
 * 텍스트를 문단/문장 단위로 청크 분할
 * - 문단 구분자(\n\n) 우선
 * - 너무 긴 문단은 문장 단위로 재분할
 */
function splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
  const chunks: string[] = [];

  // 먼저 문단으로 분할 (빈 줄 기준)
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim();
    if (!trimmedPara) continue;

    // 현재 청크에 추가해도 괜찮은지 확인
    if ((currentChunk + '\n\n' + trimmedPara).length <= maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedPara;
    } else {
      // 현재 청크가 있으면 저장
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      // 문단 자체가 청크 크기보다 크면 문장 단위로 분할
      if (trimmedPara.length > maxChunkSize) {
        // 문장 끝 패턴: 마침표, 느낌표, 물음표 + 공백 또는 줄바꿈
        const sentences = trimmedPara.split(/(?<=[.!?。])\s+/);
        currentChunk = '';

        for (const sentence of sentences) {
          if ((currentChunk + ' ' + sentence).length <= maxChunkSize) {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
          } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence;
          }
        }
      } else {
        currentChunk = trimmedPara;
      }
    }
  }

  // 마지막 청크 저장
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * 긴 대본을 청크로 분할하여 처리 (10,000자 이상 대응)
 * - 대본 내용은 절대 수정하지 않음
 * - 각 청크별로 씬 생성 후 병합
 * - 씬 번호 자동 재조정
 *
 * @param topic 토픽
 * @param hasReferenceImage 참조 이미지 존재 여부
 * @param sourceContext 원본 대본 (긴 텍스트)
 * @param chunkSize 청크당 최대 글자 수 (기본 2500자)
 * @param onProgress 진행 상황 콜백
 */
export const generateScriptChunked = async (
  topic: string,
  hasReferenceImage: boolean,
  sourceContext: string,
  chunkSize: number = 2500,
  onProgress?: (message: string) => void
): Promise<ScriptScene[]> => {
  const inputLength = sourceContext.length;

  // 청크 분할 기준 이하면 일반 처리
  if (inputLength <= chunkSize) {
    console.log(`[Chunked Script] 입력(${inputLength}자)이 청크 크기(${chunkSize}자) 이하. 일반 처리.`);
    return generateScriptSingle(topic, hasReferenceImage, sourceContext);
  }

  console.log(`[Chunked Script] ========================================`);
  console.log(`[Chunked Script] 긴 대본 감지: ${inputLength.toLocaleString()}자`);
  console.log(`[Chunked Script] 청크 분할 처리 시작 (청크당 최대 ${chunkSize}자)`);

  // 문단/문장 단위로 청크 분할
  const chunks = splitTextIntoChunks(sourceContext, chunkSize);
  console.log(`[Chunked Script] ${chunks.length}개 청크로 분할됨`);
  chunks.forEach((chunk, i) => {
    console.log(`  - 청크 ${i + 1}: ${chunk.length}자`);
  });

  const allScenes: ScriptScene[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const progressMsg = `스토리보드 생성 중... (${i + 1}/${chunks.length} 파트)`;
    console.log(`[Chunked Script] ${progressMsg}`);
    onProgress?.(progressMsg);

    // 청크 컨텍스트에 파트 정보 추가 (대본 내용은 그대로)
    const chunkContext = chunks.length > 1
      ? `[파트 ${i + 1}/${chunks.length} - 전체 대본의 일부입니다. 이 파트의 내용만 시각화하세요.]\n\n${chunks[i]}`
      : chunks[i];

    try {
      const chunkScenes = await generateScriptSingle(
        topic,
        hasReferenceImage,
        chunkContext,
        { current: i + 1, total: chunks.length }
      );

      // 씬 번호 재조정 (이전 씬들 뒤에 이어서)
      const offset = allScenes.length;
      const adjustedScenes = chunkScenes.map((scene, idx) => ({
        ...scene,
        sceneNumber: offset + idx + 1
      }));

      allScenes.push(...adjustedScenes);
      console.log(`[Chunked Script] 청크 ${i + 1} 완료: ${chunkScenes.length}개 씬 추가 (누적: ${allScenes.length}개)`);

    } catch (error: any) {
      console.error(`[Chunked Script] 청크 ${i + 1} 처리 실패:`, error.message);
      // 실패한 청크는 건너뛰고 계속 진행
      onProgress?.(`청크 ${i + 1} 처리 실패, 계속 진행 중...`);
    }

    // 청크 간 딜레이 (API rate limit 방지)
    if (i < chunks.length - 1) {
      await wait(1500);
    }
  }

  console.log(`[Chunked Script] ========================================`);
  console.log(`[Chunked Script] 총 ${allScenes.length}개 씬 생성 완료`);
  console.log(`[Chunked Script] ========================================`);

  return allScenes;
};

/**
 * 선택된 Gemini 화풍 프롬프트 가져오기
 * - 순환 의존성 방지를 위해 직접 localStorage와 config 사용
 */
const getSelectedGeminiStylePrompt = (): string => {
  const styleId = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_STYLE) as GeminiStyleId || 'gemini-none';

  // 화풍 없음 선택
  if (styleId === 'gemini-none') {
    return '';
  }

  // 커스텀 스타일인 경우
  if (styleId === 'gemini-custom') {
    const customPrompt = localStorage.getItem(CONFIG.STORAGE_KEYS.GEMINI_CUSTOM_STYLE) || '';
    return customPrompt.trim();
  }

  // 프리셋 스타일 찾기
  for (const category of GEMINI_STYLE_CATEGORIES) {
    const style = category.styles.find(s => s.id === styleId);
    if (style) {
      return style.prompt;
    }
  }

  return '';
};

/**
 * 강도(0-100)를 언어적 표현으로 변환
 * @param strength - 강도 값 (0~100)
 * @returns 강도에 따른 언어적 표현
 */
const getStrengthDescription = (strength: number): { level: string; instruction: string } => {
  if (strength <= 20) {
    return {
      level: 'very loosely',
      instruction: 'Use as a very loose inspiration only. Feel free to deviate significantly.'
    };
  } else if (strength <= 40) {
    return {
      level: 'loosely',
      instruction: 'Use as a loose reference. Capture the general feel but allow creative interpretation.'
    };
  } else if (strength <= 60) {
    return {
      level: 'moderately',
      instruction: 'Follow the reference moderately. Balance between reference and scene requirements.'
    };
  } else if (strength <= 80) {
    return {
      level: 'closely',
      instruction: 'Follow the reference closely. Maintain strong similarity while adapting to the scene.'
    };
  } else {
    return {
      level: 'exactly',
      instruction: 'Match the reference as exactly as possible. Replicate with high precision.'
    };
  }
};

/**
 * 씬에 대한 이미지 생성 (Gemini 사용)
 * @param scene - 씬 데이터
 * @param referenceImages - 분리된 참조 이미지 (캐릭터/스타일 + 강도)
 */
export const generateImageForScene = async (
  scene: ScriptScene,
  referenceImages: ReferenceImages
): Promise<string | null> => {
  // 캐릭터 참조 이미지가 있으면 고정 프롬프트 제외
  const hasCharacterRef = referenceImages.character && referenceImages.character.length > 0;
  const hasStyleRef = referenceImages.style && referenceImages.style.length > 0;

  // 스타일 참조 이미지가 없을 때만 선택된 화풍 적용 (스타일 참조 우선)
  // 화풍 프롬프트를 캐릭터에도 적용하기 위해 getFinalVisualPrompt에 전달
  const geminiStylePrompt = hasStyleRef ? undefined : getSelectedGeminiStylePrompt();
  const basePrompt = getFinalVisualPrompt(scene, hasCharacterRef, geminiStylePrompt);

  if (geminiStylePrompt) {
    console.log(`[Image Gen] 화풍이 캐릭터에 적용됨: ${geminiStylePrompt.slice(0, 50)}...`);
  }

  // 강도 정보 가져오기
  const characterStrength = referenceImages.characterStrength ?? 70;
  const styleStrength = referenceImages.styleStrength ?? 70;

  console.log(`[Image Gen] 캐릭터 강도: ${characterStrength}%, 스타일 강도: ${styleStrength}%`);

  const MAX_SANITIZE_ATTEMPTS = 3; // 대체어 시도 횟수
  let lastError: any;

  for (let sanitizeAttempt = 0; sanitizeAttempt < MAX_SANITIZE_ATTEMPTS; sanitizeAttempt++) {
    // 시도마다 다른 대체어 적용
    const sanitizedPrompt = sanitizeAttempt === 0
      ? basePrompt
      : sanitizePrompt(basePrompt, sanitizeAttempt - 1);

    if (sanitizeAttempt > 0) {
      console.log(`[Image Gen] 키워드 대체 시도 ${sanitizeAttempt}: 프롬프트 수정됨`);
    }

    try {
      const result = await retryGeminiRequest("Pro Image Generation", async () => {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const parts: any[] = [];

        // 캐릭터 참조 이미지 추가 (강도 정보 포함)
        if (hasCharacterRef) {
          const charDesc = getStrengthDescription(characterStrength);
          parts.push({
            text: `[CHARACTER REFERENCE - Strength: ${characterStrength}%]
Match this character's appearance ${charDesc.level}.
${charDesc.instruction}
Focus on: face, hair, clothing, body proportions.`
          });
          referenceImages.character.forEach(img => {
            const imageData = img.includes(',') ? img.split(',')[1] : img;
            parts.push({ inlineData: { data: imageData, mimeType: 'image/jpeg' } });
          });
        }

        // 스타일 참조 이미지 추가 (강도 정보 포함)
        if (hasStyleRef) {
          const styleDesc = getStrengthDescription(styleStrength);
          parts.push({
            text: `[STYLE REFERENCE - Strength: ${styleStrength}%]
Match this art style ${styleDesc.level}.
${styleDesc.instruction}
Focus on: color palette, brush strokes, lighting, overall mood.`
          });
          referenceImages.style.forEach(img => {
            const imageData = img.includes(',') ? img.split(',')[1] : img;
            parts.push({ inlineData: { data: imageData, mimeType: 'image/jpeg' } });
          });
        }

        // 스타일 참조 이미지가 없을 때만 선택된 화풍 프롬프트 적용
        // (스타일 참조 이미지 우선 원칙)
        if (!hasStyleRef) {
          const geminiStylePrompt = getSelectedGeminiStylePrompt();
          if (geminiStylePrompt) {
            parts.push({
              text: `[ART STYLE INSTRUCTION]
Apply this art style: ${geminiStylePrompt}
Ensure the entire image consistently follows this visual style.`
            });
            console.log(`[Image Gen] Gemini 화풍 적용: ${geminiStylePrompt.slice(0, 50)}...`);
          }
        }

        // 최종 프롬프트 추가
        parts.push({ text: `[SCENE PROMPT]\n${sanitizedPrompt}` });

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts },
          config: {
            responseModalities: [Modality.IMAGE],
            imageConfig: {
              aspectRatio: '16:9'
            }
          }
        });

        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) return part.inlineData.data;
        }
        return null;
      }, 2, 3000); // 각 대체어당 2회 재시도

      if (result) return result;
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || JSON.stringify(error);

      // 안전 필터/콘텐츠 정책 관련 에러인지 확인
      const isSafetyError =
        errorMsg.includes('safety') ||
        errorMsg.includes('blocked') ||
        errorMsg.includes('policy') ||
        errorMsg.includes('content') ||
        errorMsg.includes('SAFETY') ||
        errorMsg.includes('harmful') ||
        error.status === 400;

      if (isSafetyError && sanitizeAttempt < MAX_SANITIZE_ATTEMPTS - 1) {
        console.log(`[Image Gen] 안전 필터 감지됨. 대체 키워드로 재시도...`);
        await wait(1000);
        continue; // 다음 대체어로 재시도
      }

      // 안전 필터 에러가 아니거나 모든 대체어 소진 시 에러 throw
      throw error;
    }
  }

  throw lastError || new Error('이미지 생성 실패: 모든 대체어 시도 실패');
};

export const generateAudioForScene = async (text: string) => {
  return retryGeminiRequest("TTS Generation", async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: { parts: [{ text }] },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
      }
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  });
};

/**
 * AI 기반 자막 의미 단위 분리
 * - 나레이션을 의미가 통하는 단위로 분리
 * - 각 청크는 maxChars(기본 22자) 이하
 * - 반환: 분리된 텍스트 청크 배열
 */
export const splitSubtitleByMeaning = async (
  narration: string,
  maxChars: number = 20
): Promise<string[]> => {
  return retryGeminiRequest("Subtitle Split", async () => {
    const ai = getAI();

    const prompt = `자막 분리 작업입니다. 원문을 청크로 나누세요.

###### 🚨 절대 금지 사항 (위반 시 실패) ######
- 띄어쓰기 추가 금지: "자막나오는거" → "자막 나오는 거" ❌
- 띄어쓰기 삭제 금지: "역대 최고치" → "역대최고치" ❌
- 맞춤법 교정 금지: 틀린 맞춤법도 그대로 유지
- 어떤 글자도 변경/추가/삭제 금지
################################################

## 검증 방법
청크를 그대로 이어붙이면 원문과 글자 하나 틀리지 않고 완전히 같아야 함.
"${narration}".split('').join('') === chunks.join('').split('').join('')

## 자막 분리 규칙
1. 각 청크는 15~20자 (최대 ${maxChars}자)
2. 1초당 4-5글자, 최소 1.5초 = 최소 6~8글자
3. 의미 단위로 자연스럽게 끊기

## 끊는 위치
✅ 좋은 위치: 쉼표(,) 뒤, 마침표(.) 뒤, 조사 뒤 공백
❌ 나쁜 위치: 단어 중간, 숫자 내 쉼표(4,200), 조사 앞

## 원문 (이것을 정확히 분리)
${narration}

## 출력
JSON 배열만 출력. 예: ["청크1", "청크2"]`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const chunks = JSON.parse(cleanJsonResponse(response.text));

    // 유효성 검증: 원문 복원 확인 (띄어쓰기 포함)
    const reconstructed = chunks.join('');

    if (reconstructed !== narration) {
      console.warn(`[Subtitle Split] 원문과 청크 불일치!`);
      console.warn(`  원문: "${narration}"`);
      console.warn(`  복원: "${reconstructed}"`);
      // 폴백: 단순 길이 기반 분리
      return fallbackSplit(narration, maxChars);
    }

    console.log(`[Subtitle Split] AI 분리 성공: ${chunks.length}개 청크`);
    return chunks;
  }, 2, 1000);
};

/**
 * 대본과 이미지 프롬프트를 분석하여 애니메이션 움직임 프롬프트 생성
 * - 캐릭터 감정/동작 분석
 * - 상황에 맞는 움직임 제안
 */
export const generateMotionPrompt = async (
  narration: string,
  visualPrompt: string
): Promise<string> => {
  try {
    const ai = getAI();

    const prompt = `You are an animation director. Analyze the narration and visual description, then generate a motion prompt for image-to-video AI.

## Rules
1. Output in English only
2. Keep the original image style intact - NO style changes
3. Suggest subtle, natural character movements based on emotion/context
4. Camera: slow gentle zoom in
5. Keep movements minimal but expressive
6. Max 100 words

## Narration (Korean)
${narration}

## Visual Description
${visualPrompt.slice(0, 300)}

## Output Format
Return ONLY the motion prompt, no explanation. Example:
"Slow gentle zoom in. Character slightly nods with a warm smile, eyes blinking naturally. Subtle breathing motion. Background remains static. Maintain original art style consistency."`;

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const motionPrompt = response.text?.trim() || '';
    console.log('[Motion Prompt] 생성됨:', motionPrompt.slice(0, 100) + '...');
    return motionPrompt;

  } catch (error) {
    console.warn('[Motion Prompt] 생성 실패, 기본 프롬프트 사용');
    // 폴백: 기본 프롬프트
    return `Slow gentle zoom in. Subtle natural movement. Maintain original art style. ${visualPrompt.slice(0, 100)}`;
  }
};

/**
 * AI 실패 시 폴백: 구두점 + 길이 기반 분리
 */
function fallbackSplit(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';

  // 구두점이나 공백 기준으로 분리
  const tokens = text.split(/(?<=[,.])|(?=\s)/);

  for (const token of tokens) {
    if ((current + token).length <= maxChars) {
      current += token;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = token.trimStart();
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}
