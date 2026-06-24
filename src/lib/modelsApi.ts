import type { ApiProfile } from '../types'
import { buildApiUrl, type DevProxyConfig } from './devProxy'

type RawModel = {
  id?: unknown
  display_name?: unknown
}

type RawModelsResponse = {
  data?: unknown
}

export type LoadedModel = {
  id: string
  label: string
}

export function pickDefaultImageModel(models: LoadedModel[], currentModel: string) {
  if (currentModel && models.some((model) => model.id === currentModel)) return currentModel
  const preferred = models.find((model) => model.id === 'gpt-image-2')
  if (preferred) return preferred.id
  const imageModel = models.find((model) => /image/i.test(model.id))
  return imageModel?.id ?? models[0]?.id ?? currentModel
}

export async function loadOpenAICompatibleModels(
  profile: ApiProfile,
  proxyConfig: DevProxyConfig | null,
  useApiProxy: boolean,
): Promise<LoadedModel[]> {
  if (!profile.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!profile.baseUrl.trim() && !useApiProxy) throw new Error('请先填写 API URL')

  const response = await fetch(buildApiUrl(profile.baseUrl, 'models', proxyConfig, useApiProxy), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
    },
  })

  const text = await response.text()
  let payload: RawModelsResponse
  try {
    payload = JSON.parse(text) as RawModelsResponse
  } catch {
    throw new Error(text.trim() || `加载模型失败：HTTP ${response.status}`)
  }

  if (!response.ok) {
    const record = payload as Record<string, unknown>
    const message = typeof record.message === 'string'
      ? record.message
      : typeof record.error === 'string'
        ? record.error
        : `加载模型失败：HTTP ${response.status}`
    throw new Error(message)
  }

  if (!Array.isArray(payload.data)) throw new Error('模型列表格式不正确')

  const models = payload.data
    .map((item): LoadedModel | null => {
      const model = item as RawModel
      if (typeof model.id !== 'string' || !model.id.trim()) return null
      const label = typeof model.display_name === 'string' && model.display_name.trim()
        ? model.display_name.trim()
        : model.id.trim()
      return { id: model.id.trim(), label }
    })
    .filter((item): item is LoadedModel => Boolean(item))

  if (!models.length) throw new Error('没有加载到可用模型')
  return models
}
