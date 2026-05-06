import { getFinalVisualPrompt } from "./prompts.js";

function getStrengthDescription(strength) {
  if (strength <= 20)
    return {
      level: "very loosely",
      instruction: "Use as a very loose inspiration only. Feel free to deviate significantly.",
    };
  if (strength <= 40)
    return {
      level: "loosely",
      instruction: "Use as a loose reference. Capture the general feel but allow creative interpretation.",
    };
  if (strength <= 60)
    return {
      level: "moderately",
      instruction: "Follow the reference moderately. Balance between reference and scene requirements.",
    };
  if (strength <= 80)
    return {
      level: "closely",
      instruction: "Follow the reference closely. Maintain strong similarity while adapting to the scene.",
    };
  return {
    level: "exactly",
    instruction: "Match the reference as exactly as possible. Replicate with high precision.",
  };
}

function stripPrefix(base64OrDataUrl) {
  if (!base64OrDataUrl) return "";
  return base64OrDataUrl.includes(",") ? base64OrDataUrl.split(",")[1] : base64OrDataUrl;
}

/**
 * Gemini 이미지 생성 (REST, gemini-2.5-flash-image)
 * @returns raw base64 문자열 또는 null
 */
export async function generateImageForScene(scene, referenceImages, apiKey, options = {}) {
  const imageModel = options.imageModel || "gemini-2.5-flash-image";
  const styleFromCaller = options.geminiStylePrompt;
  const ref = {
    character: referenceImages?.character || [],
    style: referenceImages?.style || [],
    characterStrength: referenceImages?.characterStrength ?? 70,
    styleStrength: referenceImages?.styleStrength ?? 70,
  };

  const hasCharacterRef = ref.character.length > 0;
  const hasStyleRef = ref.style.length > 0;
  const geminiStylePrompt = hasStyleRef ? undefined : styleFromCaller;
  const basePrompt = getFinalVisualPrompt(scene, hasCharacterRef, geminiStylePrompt);

  const parts = [];

  if (hasCharacterRef) {
    const charDesc = getStrengthDescription(ref.characterStrength);
    parts.push({
      text: `[CHARACTER REFERENCE - Strength: ${ref.characterStrength}%]
Match this character's appearance ${charDesc.level}.
${charDesc.instruction}
Focus on: face, hair, clothing, body proportions.`,
    });
    ref.character.forEach((img) => {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } });
    });
  }

  if (hasStyleRef) {
    const styleDesc = getStrengthDescription(ref.styleStrength);
    parts.push({
      text: `[STYLE REFERENCE - Strength: ${ref.styleStrength}%]
Match this art style ${styleDesc.level}.
${styleDesc.instruction}
Focus on: color palette, brush strokes, lighting, overall mood.`,
    });
    ref.style.forEach((img) => {
      parts.push({ inlineData: { mimeType: "image/jpeg", data: stripPrefix(img) } });
    });
  }

  if (!hasStyleRef && styleFromCaller && String(styleFromCaller).trim()) {
    parts.push({
      text: `[ART STYLE INSTRUCTION]
Apply this art style: ${styleFromCaller}
Ensure the entire image consistently follows this visual style.`,
    });
  }

  parts.push({ text: `[SCENE PROMPT]\n${basePrompt}` });

  const BACKEND_URL = "http://localhost:8000";
  const url = `${BACKEND_URL}/api/proxy/gemini?model=${encodeURIComponent(imageModel)}`;

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "16:9" },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "X-Gemini-API-Key": apiKey
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const t = await response.text();
    throw new Error(`이미지 API 오류 (${response.status}): ${t.slice(0, 400)}`);
  }

  const data = await response.json();
  const outParts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of outParts) {
    if (p.inlineData?.data) return p.inlineData.data;
  }
  return null;
}
