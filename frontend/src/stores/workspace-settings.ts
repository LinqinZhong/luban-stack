/**
 * 工作区偏好（顶栏设置）。
 * apiLatencyMs：预览调用后端 API 时额外等待的毫秒数，0 表示不延迟。
 * aiModels：OpenAI/Anthropic 兼容对话模型。
 * aiAgents：外部智能体（如 Cursor），用各自 SDK/API 执行。
 */
import { create } from 'zustand'

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

/** 目前支持的智能体类型 */
export type AiAgentKind = 'cursor'

export type AiAgentConfig = {
  id: string
  name: string
  kind: AiAgentKind
  apiKey: string
  /** Cursor 模型 id，如 composer-2.5 / auto */
  modelId: string
}

export type AiProviderSelection =
  | { type: 'model'; id: string }
  | { type: 'agent'; id: string }

type StoredSettings = {
  apiLatencyMs?: number
  aiAssistantEnabled?: boolean
  aiModels?: AiModelConfig[]
  aiAgents?: AiAgentConfig[]
  activeAiModelId?: string | null
  activeAiProvider?: AiProviderSelection | null
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

function normalizeAgentKind(value: unknown): AiAgentKind {
  return value === 'cursor' ? 'cursor' : 'cursor'
}

function normalizeAgent(raw: unknown): AiAgentConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<AiAgentConfig>
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createId()
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!name) return null
  return {
    id,
    name,
    kind: normalizeAgentKind(item.kind),
    apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
    modelId:
      typeof item.modelId === 'string' && item.modelId.trim()
        ? item.modelId.trim()
        : 'composer-2.5',
  }
}

function normalizeAgents(raw: unknown): AiAgentConfig[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeAgent).filter((item): item is AiAgentConfig => Boolean(item))
}

function normalizeProvider(
  raw: unknown,
  models: AiModelConfig[],
  agents: AiAgentConfig[],
  legacyModelId: string | null,
): AiProviderSelection | null {
  if (raw && typeof raw === 'object') {
    const row = raw as { type?: unknown; id?: unknown }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (row.type === 'agent' && id && agents.some((a) => a.id === id)) {
      return { type: 'agent', id }
    }
    if (row.type === 'model' && id && models.some((m) => m.id === id)) {
      return { type: 'model', id }
    }
  }
  if (legacyModelId && models.some((m) => m.id === legacyModelId)) {
    return { type: 'model', id: legacyModelId }
  }
  if (models[0]) return { type: 'model', id: models[0].id }
  if (agents[0]) return { type: 'agent', id: agents[0].id }
  return null
}

type WorkspaceSettingsState = {
  apiLatencyMs: number
  aiAssistantEnabled: boolean
  aiModels: AiModelConfig[]
  aiAgents: AiAgentConfig[]
  activeAiProvider: AiProviderSelection | null
  activeAiModelId: string | null
  activeModel: AiModelConfig | null
  activeAgent: AiAgentConfig | null
  setApiLatencyMs: (ms: number) => void
  setAiAssistantEnabled: (enabled: boolean) => void
  upsertAiModel: (input: Omit<AiModelConfig, 'id'> & { id?: string }) => AiModelConfig
  useAiModel: (id: string) => void
  removeAiModel: (id: string) => void
  upsertAiAgent: (input: Omit<AiAgentConfig, 'id'> & { id?: string }) => AiAgentConfig
  useAiAgent: (id: string) => void
  removeAiAgent: (id: string) => void
}

function persist(state: {
  apiLatencyMs: number
  aiAssistantEnabled: boolean
  aiModels: AiModelConfig[]
  aiAgents: AiAgentConfig[]
  activeAiProvider: AiProviderSelection | null
}) {
  const next: StoredSettings = {
    apiLatencyMs: clampLatency(state.apiLatencyMs),
    aiAssistantEnabled: state.aiAssistantEnabled,
    aiModels: state.aiModels,
    aiAgents: state.aiAgents,
    activeAiModelId:
      state.activeAiProvider?.type === 'model'
        ? state.activeAiProvider.id
        : null,
    activeAiProvider: state.activeAiProvider,
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

function derived(
  aiModels: AiModelConfig[],
  aiAgents: AiAgentConfig[],
  activeAiProvider: AiProviderSelection | null,
) {
  const activeAiModelId =
    activeAiProvider?.type === 'model' ? activeAiProvider.id : null
  const activeModel =
    activeAiProvider?.type === 'model'
      ? (aiModels.find((m) => m.id === activeAiProvider.id) ?? null)
      : null
  const activeAgent =
    activeAiProvider?.type === 'agent'
      ? (aiAgents.find((a) => a.id === activeAiProvider.id) ?? null)
      : null
  return { activeAiModelId, activeModel, activeAgent }
}

const stored = loadStored()
const initialModels = normalizeModels(stored.aiModels)
const initialAgents = normalizeAgents(stored.aiAgents)
const initialProvider = normalizeProvider(
  stored.activeAiProvider,
  initialModels,
  initialAgents,
  typeof stored.activeAiModelId === 'string' ? stored.activeAiModelId : null,
)

export const useWorkspaceSettingsStore = create<WorkspaceSettingsState>(
  (set, get) => ({
    apiLatencyMs: clampLatency(stored.apiLatencyMs ?? 0),
    aiAssistantEnabled: Boolean(stored.aiAssistantEnabled),
    aiModels: initialModels,
    aiAgents: initialAgents,
    activeAiProvider: initialProvider,
    ...derived(initialModels, initialAgents, initialProvider),

    setApiLatencyMs(ms) {
      const apiLatencyMs = clampLatency(ms)
      set({ apiLatencyMs })
      persist({ ...get(), apiLatencyMs })
    },

    setAiAssistantEnabled(enabled) {
      set({ aiAssistantEnabled: enabled })
      persist({ ...get(), aiAssistantEnabled: enabled })
    },

    upsertAiModel(input) {
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
      const aiModels = [...get().aiModels]
      const index = aiModels.findIndex((model) => model.id === id)
      if (index >= 0) aiModels.splice(index, 1, next)
      else aiModels.push(next)
      let { activeAiProvider } = get()
      if (!activeAiProvider) activeAiProvider = { type: 'model', id }
      set({
        aiModels,
        activeAiProvider,
        ...derived(aiModels, get().aiAgents, activeAiProvider),
      })
      persist({ ...get(), aiModels, activeAiProvider })
      return next
    },

    useAiModel(id) {
      if (!get().aiModels.some((model) => model.id === id)) return
      const activeAiProvider = { type: 'model' as const, id }
      set({
        activeAiProvider,
        ...derived(get().aiModels, get().aiAgents, activeAiProvider),
      })
      persist({ ...get(), activeAiProvider })
    },

    removeAiModel(id) {
      const aiModels = get().aiModels.filter((model) => model.id !== id)
      let { activeAiProvider } = get()
      if (activeAiProvider?.type === 'model' && activeAiProvider.id === id) {
        activeAiProvider = normalizeProvider(null, aiModels, get().aiAgents, null)
      }
      set({
        aiModels,
        activeAiProvider,
        ...derived(aiModels, get().aiAgents, activeAiProvider),
      })
      persist({ ...get(), aiModels, activeAiProvider })
    },

    upsertAiAgent(input) {
      const id = input.id?.trim() || createId()
      const next: AiAgentConfig = {
        id,
        name: input.name.trim(),
        kind: normalizeAgentKind(input.kind),
        apiKey: input.apiKey,
        modelId: input.modelId.trim() || 'composer-2.5',
      }
      const aiAgents = [...get().aiAgents]
      const index = aiAgents.findIndex((agent) => agent.id === id)
      if (index >= 0) aiAgents.splice(index, 1, next)
      else aiAgents.push(next)
      const activeAiProvider = { type: 'agent' as const, id }
      set({
        aiAgents,
        activeAiProvider,
        ...derived(get().aiModels, aiAgents, activeAiProvider),
      })
      persist({ ...get(), aiAgents, activeAiProvider })
      return next
    },

    useAiAgent(id) {
      if (!get().aiAgents.some((agent) => agent.id === id)) return
      const activeAiProvider = { type: 'agent' as const, id }
      set({
        activeAiProvider,
        ...derived(get().aiModels, get().aiAgents, activeAiProvider),
      })
      persist({ ...get(), activeAiProvider })
    },

    removeAiAgent(id) {
      const aiAgents = get().aiAgents.filter((agent) => agent.id !== id)
      let { activeAiProvider } = get()
      if (activeAiProvider?.type === 'agent' && activeAiProvider.id === id) {
        activeAiProvider = normalizeProvider(null, get().aiModels, aiAgents, null)
      }
      set({
        aiAgents,
        activeAiProvider,
        ...derived(get().aiModels, aiAgents, activeAiProvider),
      })
      persist({ ...get(), aiAgents, activeAiProvider })
    },
  }),
)
