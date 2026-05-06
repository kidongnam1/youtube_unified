/** TubeGen Plain — 공통 설정 (키 이름만 React판과 호환 가능하도록 별도 네임스페이스) */

export const STORAGE_KEYS = {
  geminiKey: "tubegen_plain_gemini_key",
  geminiModel: "tubegen_plain_gemini_model",
  geminiImageModel: "tubegen_plain_gemini_image_model",
  geminiStyle: "tubegen_plain_gemini_style",
  geminiCustomStyle: "tubegen_plain_gemini_custom_style",
  elevenLabsKey: "tubegen_plain_el_key",
  elevenLabsVoice: "tubegen_plain_el_voice",
  elevenLabsModel: "tubegen_plain_el_model",
  falKey: "tubegen_plain_fal_key",
  projects: "tubegen_plain_projects",
};

export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

export const GEMINI_STYLE_PRESETS = [
  { id: "gemini-none", name: "화풍 없음", prompt: "" },
  {
    id: "gemini-crayon",
    name: "크레용",
    prompt:
      "Hand-drawn crayon and colored pencil illustration style, waxy texture with rough organic strokes, warm nostalgic colors, childlike charm with innocent atmosphere, visible pencil texture on outlines and fills, soft analog warmth, 2D flat composition",
  },
  {
    id: "gemini-korea-cartoon",
    name: "한국 경제 카툰",
    prompt:
      "Korean economic cartoon style, digital illustration with clean bold black outlines, cel-shaded flat coloring, simple rounded stick figure character (white circle head, dot eyes), strong color contrasts with golden warm highlights vs cool gray tones, Korean text integration, modern webtoon infographic aesthetic, professional news graphic feel, dramatic lighting with sparkles and glow effects, 16:9 cinematic composition",
  },
  {
    id: "gemini-watercolor",
    name: "수채화",
    prompt:
      "Soft watercolor illustration style, gentle hand-drawn aesthetic, warm color palette by default, simple stick figure with white circle head and thin black line body, organic brush strokes with paint bleeding effects, soft diffused edges, analog texture.",
  },
  { id: "gemini-custom", name: "커스텀 (아래 문구)", prompt: "" },
];

export const DEFAULT_SUBTITLE_CONFIG = {
  wordsPerLine: 5,
  maxLines: 1,
  fontSize: 40,
  fontFamily: '"Noto Sans KR", "Malgun Gothic", sans-serif',
  bottomMargin: 80,
  backgroundColor: "rgba(0, 0, 0, 0.75)",
  textColor: "#FFFFFF",
};

export const ANIMATION = {
  ENABLED_SCENES: 10,
  VIDEO_DURATION: 5,
};

/** ElevenLabs 모델 선택용 */
export const ELEVENLABS_MODEL_OPTIONS = [
  { id: "eleven_multilingual_v2", name: "Multilingual v2 (기본)" },
  { id: "eleven_v3", name: "Eleven v3" },
  { id: "eleven_turbo_v2_5", name: "Turbo v2.5" },
  { id: "eleven_flash_v2_5", name: "Flash v2.5" },
  { id: "eleven_turbo_v2", name: "Turbo v2" },
];
