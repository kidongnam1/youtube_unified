/** 자막 의미 단위 분리 — 스토리보드용 Gemini JSON 호출 */

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

function fallbackSplit(narration, maxChars) {
  const chunks = [];
  let i = 0;
  while (i < narration.length) {
    chunks.push(narration.slice(i, i + maxChars));
    i += maxChars;
  }
  return chunks.filter(Boolean);
}

/**
 * @param {string} geminiModel — 텍스트용 (예: gemini-2.0-flash)
 */
export async function splitSubtitleByMeaning(narration, apiKey, geminiModel = "gemini-2.0-flash", maxChars = 20) {
  const prompt = `자막 분리 작업입니다. 원문을 청크로 나누세요.

###### 🚨 절대 금지 사항 (위반 시 실패) ######
- 띄어쓰기 추가 금지
- 띄어쓰기 삭제 금지
- 맞춤법 교정 금지
- 어떤 글자도 변경/추가/삭제 금지
################################################

## 검증 방법
청크를 그대로 이어붙이면 원문과 글자 하나 틀리지 않고 완전히 같아야 함.

## 자막 분리 규칙
1. 각 청크는 15~20자 (최대 ${maxChars}자)
2. 의미 단위로 자연스럽게 끊기

## 원문
${narration}

## 출력
JSON 배열만 출력. 예: ["청크1", "청크2"]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    geminiModel
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    return fallbackSplit(narration, maxChars);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  try {
    const chunks = JSON.parse(cleanJson(text));
    const reconstructed = Array.isArray(chunks) ? chunks.join("") : "";
    if (reconstructed !== narration) {
      return fallbackSplit(narration, maxChars);
    }
    return chunks;
  } catch {
    return fallbackSplit(narration, maxChars);
  }
}
