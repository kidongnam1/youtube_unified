import { splitSubtitleByMeaning } from "./geminiSubtitle.js";

const OUTPUT_FORMAT = "mp3_44100_128";

function convertToWords(characters, startTimes, endTimes) {
  const words = [];
  let currentWord = "";
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    if (char === " " || char === "\n" || char === "\t") {
      if (currentWord.length > 0) {
        words.push({ word: currentWord, start: wordStart, end: wordEnd });
        currentWord = "";
      }
    } else {
      if (currentWord.length === 0) wordStart = startTimes[i];
      currentWord += char;
      wordEnd = endTimes[i];
    }
  }
  if (currentWord.length > 0) {
    words.push({ word: currentWord, start: wordStart, end: wordEnd });
  }
  return words;
}

async function createMeaningChunks(fullText, words, geminiKey, geminiModel) {
  if (!geminiKey || words.length === 0) return [];

  const textChunks = await splitSubtitleByMeaning(fullText, geminiKey, geminiModel, 20);
  if (textChunks.length === 0) return [];

  const meaningChunks = [];
  let wordIndex = 0;

  for (const chunkText of textChunks) {
    const chunkWords = chunkText.split(/\s+/).filter((w) => w.length > 0);
    const chunkWordCount = chunkWords.length;
    if (chunkWordCount === 0) continue;

    const startWordIndex = wordIndex;
    let matchedWords = 0;
    while (wordIndex < words.length && matchedWords < chunkWordCount) {
      matchedWords++;
      wordIndex++;
    }

    if (startWordIndex < words.length) {
      const endWordIndex = Math.min(wordIndex - 1, words.length - 1);
      meaningChunks.push({
        text: chunkText,
        startTime: words[startWordIndex].start,
        endTime: words[endWordIndex].end,
      });
    }
  }

  for (let i = 0; i < meaningChunks.length - 1; i++) {
    meaningChunks[i].endTime = meaningChunks[i + 1].startTime;
  }

  return meaningChunks;
}

/**
 * @returns {{ audioData: string|null, subtitleData: object|null, estimatedDuration: number|null }}
 */
export async function generateAudioWithElevenLabs(text, opts = {}) {
  const finalKey = opts.apiKey;
  const finalVoiceId = opts.voiceId;
  const finalModelId = opts.modelId || "eleven_multilingual_v2";

  if (!finalKey || finalKey.length < 10) {
    console.warn("ElevenLabs API Key가 설정되지 않았습니다.");
    return { audioData: null, subtitleData: null, estimatedDuration: null };
  }

  const BACKEND_URL = "http://localhost:8000";
  const url = `${BACKEND_URL}/api/proxy/elevenlabs?voice_id=${finalVoiceId}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ElevenLabs-API-Key": finalKey,
      },
      body: JSON.stringify({
        text,
        model_id: finalModelId,
        output_format: OUTPUT_FORMAT,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const errorDetail = await response.text();
      console.error("ElevenLabs API Error:", errorDetail);
      return { audioData: null, subtitleData: null, estimatedDuration: null };
    }

    // Proxy returns StreamingResponse which is handled as a blob then converted to base64
    // Wait, the proxy might return JSON if alignment is needed. 
    // Actually, alignment with-timestamps returns JSON containing alignment AND audio_base64.
    // My proxy returns response.json() or StreamingResponse.
    // If it's with-timestamps, it should be response.json().
    const jsonResponse = await response.json();
    const audioBase64 = jsonResponse.audio_base64;

    let subtitleData = null;
    let estimatedDuration = null;

    if (jsonResponse.alignment) {
      const { characters, character_start_times_seconds, character_end_times_seconds } = jsonResponse.alignment;

      const words = convertToWords(characters, character_start_times_seconds, character_end_times_seconds);

      subtitleData = { words, fullText: text };

      if (character_end_times_seconds?.length > 0) {
        const lastCharEnd = character_end_times_seconds[character_end_times_seconds.length - 1];
        estimatedDuration = lastCharEnd + 0.3;
      }

      if (opts.geminiKey) {
        try {
          const meaningChunks = await createMeaningChunks(
            text,
            words,
            opts.geminiKey,
            opts.geminiModel || "gemini-2.0-flash"
          );
          if (meaningChunks.length > 0) {
            subtitleData.meaningChunks = meaningChunks;
          }
        } catch (e) {
          console.warn("[ElevenLabs] AI 자막 분리 실패:", e);
        }
      }
    }

    return { audioData: audioBase64, subtitleData, estimatedDuration };
  } catch (error) {
    console.error("ElevenLabs Generation Failed:", error);
    return { audioData: null, subtitleData: null, estimatedDuration: null };
  }
}

/** 브라우저에서 CORS로 막힐 수 있음 — 성공 시 목록 반환 */
export async function fetchElevenLabsVoices(apiKey) {
  if (!apiKey || apiKey.length < 10) return [];

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.voices || [];
  } catch {
    return [];
  }
}
