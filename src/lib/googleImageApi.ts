import type { ApiProfile, TaskParams } from '../types'
import { DEFAULT_GOOGLE_BASE_URL, DEFAULT_GOOGLE_MODEL, DEFAULT_GOOGLE_IMAGEN_MODEL } from './apiProfiles'
import {
  assertImageInputPayloadSize,
  assertMaskEditFileSize,
  type CallApiOptions,
  type CallApiResult,
  getApiErrorMessage,
  getDataUrlDecodedByteSize,
  getDataUrlEncodedByteSize,
  MIME_MAP,
  normalizeBase64Image,
} from './imageApiShared'

/**
 * Google (Gemini / Imagen) image provider — Gemini Developer API, API-key auth.
 *
 * - gemini-*-image (Nano Banana) via `:generateContent` — text-to-image AND image editing
 *   (input/mask images attached as inline_data parts). Returns one image per call, so n>1
 *   fans out into n concurrent calls.
 * - imagen-* via `:predict` — generation only (sampleCount up to 4).
 *
 * NOTE: generativelanguage.googleapis.com does NOT send CORS headers, so a direct browser
 * fetch is blocked. Inside the CentaurAI Electron embed a scoped CORS shim on the workbench
 * webview partition makes this work; for the standalone browser build, route via a proxy.
 */

// Gemini imageConfig.aspectRatio accepts this fixed set.
const GEMINI_ASPECT_RATIOS = new Set(['21:9', '16:9', '4:3', '3:2', '1:1', '9:16', '3:4', '2:3', '5:4', '4:5'])
const ASPECT_CANDIDATES: Array<[string, number]> = [
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['21:9', 21 / 9],
]

function mapAspectRatio(size: string): string | null {
  if (!size || size === 'auto') return null
  if (GEMINI_ASPECT_RATIOS.has(size)) return size
  const match = size.match(/^(\d+)x(\d+)$/)
  if (match) {
    const w = Number(match[1])
    const h = Number(match[2])
    if (w > 0 && h > 0) {
      const ratio = w / h
      let best = ASPECT_CANDIDATES[0]
      let bestDelta = Infinity
      for (const candidate of ASPECT_CANDIDATES) {
        const delta = Math.abs(candidate[1] - ratio)
        if (delta < bestDelta) {
          bestDelta = delta
          best = candidate
        }
      }
      return best[0]
    }
  }
  return null
}

function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s)
  if (!match) return null
  return { mimeType: match[1] || 'image/png', data: match[2] }
}

function normalizeGoogleBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '') || DEFAULT_GOOGLE_BASE_URL
}

export function isImagenModel(model: string): boolean {
  return /(^|\/)imagen/i.test(model.trim())
}

function withTimeout(timeoutSec: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), Math.max(1, timeoutSec || 600) * 1000)
  return { signal: controller.signal, clear: () => clearTimeout(id) }
}

async function callGeminiOnce(opts: CallApiOptions, profile: ApiProfile, aspectRatio: string | null): Promise<string[]> {
  const parts: Array<Record<string, unknown>> = [{ text: opts.prompt }]
  for (const dataUrl of opts.inputImageDataUrls) {
    const split = splitDataUrl(dataUrl)
    if (split) parts.push({ inline_data: { mime_type: split.mimeType, data: split.data } })
  }
  if (opts.maskDataUrl) {
    const split = splitDataUrl(opts.maskDataUrl)
    if (split) parts.push({ inline_data: { mime_type: split.mimeType, data: split.data } })
  }

  const generationConfig: Record<string, unknown> = { responseModalities: ['IMAGE'] }
  if (aspectRatio) generationConfig.imageConfig = { aspectRatio }

  const model = profile.model.trim() || DEFAULT_GOOGLE_MODEL
  const url = `${normalizeGoogleBaseUrl(profile.baseUrl)}/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const { signal, clear } = withTimeout(profile.timeout)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': profile.apiKey },
      cache: 'no-store',
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
      signal,
    })
  } finally {
    clear()
  }
  if (!response.ok) throw new Error(await getApiErrorMessage(response))

  const payload = await response.json()
  const images: string[] = []
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : []
  for (const candidate of candidates) {
    const candidateParts = candidate?.content?.parts
    if (!Array.isArray(candidateParts)) continue
    for (const part of candidateParts) {
      const inline = part?.inlineData ?? part?.inline_data
      if (inline && typeof inline.data === 'string' && inline.data) {
        images.push(normalizeBase64Image(inline.data, inline.mimeType || inline.mime_type || 'image/png'))
      }
    }
  }
  if (!images.length) {
    const blocked = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason
    const err = new Error(
      blocked
        ? `Google Gemini 未返回图片（${blocked}），可能被安全策略拦截或该模型不支持图像输出。`
        : 'Google Gemini 未返回图片数据，请确认所选模型支持图像输出（如 gemini-2.5-flash-image）。',
    )
    ;(err as Error & { rawResponsePayload?: string }).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }
  return images
}

async function callImagen(opts: CallApiOptions, profile: ApiProfile, aspectRatio: string | null): Promise<string[]> {
  const model = profile.model.trim() || DEFAULT_GOOGLE_IMAGEN_MODEL
  const url = `${normalizeGoogleBaseUrl(profile.baseUrl)}/v1beta/models/${encodeURIComponent(model)}:predict`
  const parameters: Record<string, unknown> = { sampleCount: Math.min(4, Math.max(1, opts.params.n || 1)) }
  if (aspectRatio) parameters.aspectRatio = aspectRatio

  const { signal, clear } = withTimeout(profile.timeout)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': profile.apiKey },
      cache: 'no-store',
      body: JSON.stringify({ instances: [{ prompt: opts.prompt }], parameters }),
      signal,
    })
  } finally {
    clear()
  }
  if (!response.ok) throw new Error(await getApiErrorMessage(response))

  const payload = await response.json()
  const predictions = Array.isArray(payload?.predictions) ? payload.predictions : []
  const images: string[] = []
  for (const prediction of predictions) {
    if (prediction && typeof prediction.bytesBase64Encoded === 'string' && prediction.bytesBase64Encoded) {
      images.push(normalizeBase64Image(prediction.bytesBase64Encoded, prediction.mimeType || 'image/png'))
    }
  }
  if (!images.length) {
    const err = new Error('Google Imagen 未返回图片数据')
    ;(err as Error & { rawResponsePayload?: string }).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }
  return images
}

export async function callGoogleImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  if (!profile.apiKey.trim()) throw new Error('缺少 Google API Key')

  if (opts.maskDataUrl) {
    assertMaskEditFileSize('遮罩文件', getDataUrlDecodedByteSize(opts.maskDataUrl))
  }
  assertImageInputPayloadSize(
    opts.inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0) +
      (opts.maskDataUrl ? getDataUrlEncodedByteSize(opts.maskDataUrl) : 0),
  )

  const aspectRatio = mapAspectRatio(opts.params.size)
  void MIME_MAP

  if (isImagenModel(profile.model)) {
    const images = await callImagen(opts, profile, aspectRatio)
    return { images, revisedPrompts: images.map(() => undefined) }
  }

  const n = Math.min(4, Math.max(1, opts.params.n || 1))
  if (n <= 1) {
    const images = await callGeminiOnce(opts, profile, aspectRatio)
    return { images, revisedPrompts: images.map(() => undefined) }
  }

  // Gemini returns one image per call → fan out for multi-image, tolerate partial failures.
  const settled = await Promise.allSettled(Array.from({ length: n }, () => callGeminiOnce(opts, profile, aspectRatio)))
  const images: string[] = []
  const failedRequests: Array<{ requestIndex: number; error: string }> = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      images.push(...result.value)
    } else {
      failedRequests.push({ requestIndex: index, error: result.reason instanceof Error ? result.reason.message : String(result.reason) })
    }
  })
  if (!images.length) {
    throw new Error(failedRequests[0]?.error || 'Google 图像生成失败')
  }
  return {
    images,
    revisedPrompts: images.map(() => undefined),
    ...(failedRequests.length ? { failedRequests } : {}),
  }
}
