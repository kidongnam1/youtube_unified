/** 최종 이미지 프롬프트 (React prompts.ts 단순 이식) */

const VAR_BASE_CHAR =
  "Simple 2D stick figure. Circle head, dot eyes, line mouth, thin line body/arms/legs. Black outline only.";

const VAR_MOOD_ENFORCER = `
MOOD: NEGATIVE=dark/cold, POSITIVE=bright/warm, NEUTRAL=balanced.
`;

export function getFinalVisualPrompt(scene, hasCharacterRef = false, artStylePrompt) {
  const basePrompt = scene.visualPrompt || "";
  const analysis = scene.analysis || {};
  const keywords = scene.visual_keywords || "";
  const type = analysis.composition_type || "STANDARD";
  const sentiment = analysis.sentiment || "NEUTRAL";

  const mood =
    sentiment === "NEGATIVE"
      ? "Dark, cold lighting."
      : sentiment === "POSITIVE"
        ? "Bright, warm lighting."
        : "Balanced lighting.";

  const styleNote = artStylePrompt ? ` Render in ${artStylePrompt} style.` : "";
  const charPrompt =
    type === "NO_CHAR"
      ? `NO CHARACTER - objects/text only.${styleNote}`
      : hasCharacterRef
        ? `Use CHARACTER REFERENCE image.${styleNote}`
        : `Stick figure (${type === "MICRO" ? "5-15%" : type === "MACRO" ? "60-80%" : "30-40%"}).${styleNote}`;

  const style = artStylePrompt ? `STYLE: 16:9, ${artStylePrompt}.` : `STYLE: 16:9, 2D hand-drawn, crayon texture.`;

  const char = hasCharacterRef
    ? `CHARACTER: Match reference image.${styleNote}`
    : `CHARACTER: ${VAR_BASE_CHAR}${styleNote}`;

  return `
${basePrompt}

MOOD: ${mood}
${charPrompt}
${keywords ? `TEXT: "${keywords}"` : ""}

${style}
${char}
${VAR_MOOD_ENFORCER}
`.trim();
}
