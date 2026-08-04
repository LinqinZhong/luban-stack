import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'luban.workspaceSettings'
const LEGACY_STORAGE_KEY = 'voider.workspaceSettings'

export type AiApiType = 'openai' | 'anthropic'

export type AiModelConfig = {
  id: string
  name: string
  apiType: AiApiType
  baseUrl: string
  apiKey: string
  modelId: string
  thinking: boolean
}

type StoredSettings = {
  apiLatencyMs?: number
  aiAssistantEnabled?: boolean
  aiModels?: AiModelConfig[]
  activeAiModelId?: string | null
}

function loadStored(): StoredSettings {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return {}
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, raw)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
    return JSON.parse(raw) as StoredSettings
  } catch {
    return {}
  }
}

function clampLatency(ms: unknown): number {
  const n = typeof ms === 'number' ? ms : Number(ms)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(Math.floor(n), 60_000)
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeApiType(value: unknown): AiApiType {
  return value === 'anthropic' ? 'anthropic' : 'openai'
}

function normalizeModel(raw: unknown): AiModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<AiModelConfig>
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createId()
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!name) return null
  return {
    id,
    name,
    apiType: normalizeApiType(item.apiType),
    baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '',
    apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
    modelId: typeof item.modelId === 'string' ? item.modelId.trim() : '',
    thinking: Boolean(item.thinking),
  }
}

function normalizeModels(raw: unknown): AiModelConfig[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeModel).filter((item): item is AiModelConfig => Boolean(item))
}

/**
 * 工作区偏好（顶栏设置）。
 * apiLatencyMs：预览调用后端 API 时额外等待的毫秒数，0 表示不延迟。
 */
export const useWorkspaceSettingsStore = defineStore('workspaceSettings', () => {
  const stored = loadStored()
  const apiLatencyMs = ref(clampLatency(stored.apiLatencyMs ?? 0))
  const aiAssistantEnabled = ref(Boolean(stored.aiAssistantEnabled))
  const aiModels = ref<AiModelConfig[]>(normalizeModels(stored.aiModels))
  const activeAiModelId = ref<string | null>(
    typeof stored.activeAiModelId === 'string' && stored.activeAiModelId
      ? stored.activeAiModelId
      : aiModels.value[0]?.id ?? null,
  )

  if (
    activeAiModelId.value &&
    !aiModels.value.some((model) => model.id === activeAiModelId.value)
  ) {
    activeAiModelId.value = aiModels.value[0]?.id ?? null
  }

  function persist() {
    const next: StoredSettings = {
      apiLatencyMs: clampLatency(apiLatencyMs.value),
      aiAssistantEnabled: aiAssistantEnabled.value,
      aiModels: aiModels.value,
      activeAiModelId: activeAiModelId.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  }

  watch([apiLatencyMs, aiAssistantEnabled, aiModels, activeAiModelId], persist, {
    flush: 'sync',
    deep: true,
  })

  function setApiLatencyMs(ms: number) {
    apiLatencyMs.value = clampLatency(ms)
  }

  function upsertAiModel(input: Omit<AiModelConfig, 'id'> & { id?: string }) {
    const id = input.id?.trim() || createId()
    const next: AiModelConfig = {
      id,
      name: input.name.trim(),
      apiType: normalizeApiType(input.apiType),
      baseUrl: input.baseUrl.trim(),
      apiKey: input.apiKey,
      modelId: input.modelId.trim(),
      thinking: Boolean(input.thinking),
    }
    const index = aiModels.value.findIndex((model) => model.id === id)
    if (index >= 0) {
      aiModels.value.splice(index, 1, next)
    } else {
      aiModels.value.push(next)
    }
    if (!activeAiModelId.value) {
      activeAiModelId.value = id
    }
    return next
  }

  function useAiModel(id: string) {
    if (!aiModels.value.some((model) => model.id === id)) return
    activeAiModelId.value = id
  }

  function removeAiModel(id: string) {
    const index = aiModels.value.findIndex((model) => model.id === id)
    if (index < 0) return
    aiModels.value.splice(index, 1)
    if (activeAiModelId.value === id) {
      activeAiModelId.value = aiModels.value[0]?.id ?? null
    }
  }

  return {
    apiLatencyMs,
    setApiLatencyMs,
    aiAssistantEnabled,
    aiModels,
    activeAiModelId,
    upsertAiModel,
    useAiModel,
    removeAiModel,
  }
})
