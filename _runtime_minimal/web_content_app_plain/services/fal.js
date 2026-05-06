function base64ToDataUrl(base64, mimeType = "image/png") {
  return `data:${mimeType};base64,${base64}`;
}

async function uploadImageToFal(imageBase64, apiKey) {
  try {
    const binaryString = atob(imageBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/png" });

    const formData = new FormData();
    formData.append("file", blob, "image.png");

    const BACKEND_URL = "http://localhost:8000";
    const uploadResponse = await fetch(`${BACKEND_URL}/api/proxy/fal?model=fal-ai/storage/upload`, {
      method: "POST",
      headers: { "X-Fal-API-Key": apiKey },
      body: formData,
    });

    if (!uploadResponse.ok) {
      console.warn("[FAL] 파일 업로드 실패, data URL 사용 시도");
      return base64ToDataUrl(imageBase64);
    }

    const uploadResult = await uploadResponse.json();
    return uploadResult.url;
  } catch {
    return base64ToDataUrl(imageBase64);
  }
}

/**
 * @returns 영상 URL 또는 null
 */
export async function generateVideoFromImage(imageBase64, motionPrompt, apiKey) {
  if (!apiKey) {
    console.warn("[FAL] API 키가 설정되지 않았습니다.");
    return null;
  }

  try {
    const imageUrl = await uploadImageToFal(imageBase64, apiKey);
    if (!imageUrl) return null;

    const requestBody = {
      prompt: motionPrompt,
      image_url: imageUrl,
      duration: 5,
      aspect_ratio: "16:9",
      resolution: "720p",
      negative_prompt:
        "blurry, low quality, low resolution, pixelated, noisy, grainy, distorted, static",
    };

    const BACKEND_URL = "http://localhost:8000";
    const response = await fetch(`${BACKEND_URL}/api/proxy/fal?model=fal-ai/pixverse/v5.5/image-to-video`, {
      method: "POST",
      headers: {
        "X-Fal-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FAL API 오류: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const result = await response.json();
    return result.video?.url || null;
  } catch (error) {
    console.error("[FAL] 영상 생성 실패:", error.message);
    return null;
  }
}

export async function fetchVideoAsBase64(videoUrl) {
  try {
    const response = await fetch(videoUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = String(reader.result || "").split(",")[1];
        resolve(base64 || null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
