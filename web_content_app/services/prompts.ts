/**
 * 프롬프트 시스템 (단순화 버전)
 * - 핵심 규칙만 유지
 * - 미사용 코드 제거
 */

// 캐릭터 기본 설명
export const VAR_BASE_CHAR = `Simple 2D stick figure. Circle head, dot eyes, line mouth, thin line body/arms/legs. Black outline only.`;

// 분위기 규칙
export const VAR_MOOD_ENFORCER = `
MOOD: NEGATIVE=dark/cold, POSITIVE=bright/warm, NEUTRAL=balanced.
`;

// 시스템 지시문
export const SYSTEM_INSTRUCTIONS = {
  CHIEF_ART_DIRECTOR: `
당신은 문장을 이미지로 변환하는 아트 디렉터입니다.

## 핵심 원칙
- 문장의 의미를 그대로 시각화하라
- "컴퓨터" → 컴퓨터를 그려라
- "발전된 자동차" → 미래적인 자동차를 그려라
- 수식어 반영: "거대한"→크게, "빛나는"→광택

## 시각화 규칙
- 물리적 형태 있으면 → 그대로 그려라
- 숫자/데이터 → 그래프, 화살표, 숫자 텍스트
- 추상 개념 → 관련 사물로 표현

## 주제별 힌트
- 부동산→건물, AI→로봇/회로, 주식→차트, 금융→돈/금괴

## 캐릭터 등장 규칙
- 주어가 사람 → 캐릭터 등장 (STANDARD)
- 주어가 데이터/시스템 → 캐릭터 없음 (NO_CHAR)
- 예: "GDP 상승"→NO_CHAR, "투자자가 고민"→STANDARD

## 구도
- NO_CHAR: 캐릭터 없음
- MICRO (5-15%): 작은 캐릭터 + 큰 사물
- STANDARD (30-40%): 캐릭터와 사물 상호작용
- MACRO (60-80%): 캐릭터 클로즈업
`,

  TREND_RESEARCHER: `최신 경제 뉴스/트렌드를 발굴하는 리서처입니다.`,

  MANUAL_VISUAL_MATCHER: `
대본을 시각화하는 전문가입니다.
- 대본 내용 수정 금지
- 씬 분할과 시각적 연출만 수행
- 같은 개념은 같은 모습으로 그려라
`,

  REFERENCE_MATCH: `참조 이미지의 화풍을 따르되 졸라맨 규칙을 적용하라.`
};

/**
 * 최종 이미지 프롬프트 생성
 */
export const getFinalVisualPrompt = (scene: any, hasCharacterRef: boolean = false, artStylePrompt?: string) => {
  const basePrompt = scene.visualPrompt || "";
  const analysis = scene.analysis || {};
  const keywords = scene.visual_keywords || "";
  const type = analysis.composition_type || "STANDARD";
  const sentiment = analysis.sentiment || "NEUTRAL";

  // 분위기
  const mood = sentiment === 'NEGATIVE' ? 'Dark, cold lighting.'
    : sentiment === 'POSITIVE' ? 'Bright, warm lighting.'
    : 'Balanced lighting.';

  // 캐릭터 (화풍 적용)
  const styleNote = artStylePrompt ? ` Render in ${artStylePrompt} style.` : '';
  const charPrompt = type === 'NO_CHAR'
    ? `NO CHARACTER - objects/text only.${styleNote}`
    : hasCharacterRef
    ? `Use CHARACTER REFERENCE image.${styleNote}`
    : `Stick figure (${type === 'MICRO' ? '5-15%' : type === 'MACRO' ? '60-80%' : '30-40%'}).${styleNote}`;

  // 스타일
  const style = artStylePrompt
    ? `STYLE: 16:9, ${artStylePrompt}.`
    : `STYLE: 16:9, 2D hand-drawn, crayon texture.`;

  const char = hasCharacterRef
    ? `CHARACTER: Match reference image.${styleNote}`
    : `CHARACTER: ${VAR_BASE_CHAR}${styleNote}`;

  return `
${basePrompt}

MOOD: ${mood}
${charPrompt}
${keywords ? `TEXT: "${keywords}"` : ''}

${style}
${char}
${VAR_MOOD_ENFORCER}
`.trim();
};

// 트렌드 검색 프롬프트
export const getTrendSearchPrompt = (category: string, _usedTopicsString: string) =>
  `Search for 4 trending "${category}" topics. Return JSON: [{rank, topic, reason}]`;

// 스크립트 생성 프롬프트
export const getScriptGenerationPrompt = (topic: string, sourceContext?: string | null) => {
  const isManual = !!sourceContext;
  const content = sourceContext || topic;

  return `
# Task: Generate Storyboard for "${topic}"

## 씬 분할 규칙
- 1문장 = 1씬 (기본)
- 입력 문장 수 = 출력 씬 수
- 같은 내용 반복 금지
- ⚠️ narration 필드: 입력된 대본 문장을 그대로 복사해서 사용 (절대 "나레이션"이라고 쓰지 말것)

## 시각화
- 문장 의미를 그대로 이미지화
- 수식어 반영 ("거대한"→크게)

## 브랜드/유명인
- 로고 또는 텍스트로 표시
- 한국 브랜드 → 한국어 ("삼성")
- 외국 브랜드 → 영어 ("Tesla")

## 캐릭터
- 주어가 사람 → STANDARD
- 주어가 데이터 → NO_CHAR

${isManual ? '[수동 대본] 원문 수정 금지, 씬 분할만' : ''}

[입력]
${content}

### JSON 출력 형식 ###
{
  "scenes": [{
    "sceneNumber": 1,
    "narration": "입력된 대본 문장을 여기에 그대로 복사",
    "visual_keywords": "이미지에 표시할 텍스트 (없으면 빈 문자열)",
    "analysis": {
      "sentiment": "POSITIVE 또는 NEGATIVE 또는 NEUTRAL 중 하나",
      "composition_type": "MICRO 또는 STANDARD 또는 MACRO 또는 NO_CHAR 중 하나"
    },
    "image_prompt_english": "씬을 묘사하는 영문 프롬프트"
  }]
}

### 중요 ###
- narration: 입력 텍스트의 각 문장을 그대로 사용할 것!
- "나레이션"이라는 단어를 출력하면 안됨
`;
};
