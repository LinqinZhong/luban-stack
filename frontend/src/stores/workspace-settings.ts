import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'voider.workspaceSettings'

type StoredSettings = {
  apiLatencyMs?: number
}

function loadStored(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
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

/**
 * 工作区偏好（顶栏设置）。
 * apiLatencyMs：预览调用后端 API 时额外等待的毫秒数，0 表示不延迟。
 */
export const useWorkspaceSettingsStore = defineStore('workspaceSettings', () => {
  const stored = loadStored()
  const apiLatencyMs = ref(clampLatency(stored.apiLatencyMs ?? 0))

  watch(
    apiLatencyMs,
    (value) => {
      const next: StoredSettings = { apiLatencyMs: clampLatency(value) }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    },
    { flush: 'sync' },
  )

  function setApiLatencyMs(ms: number) {
    apiLatencyMs.value = clampLatency(ms)
  }

  return {
    apiLatencyMs,
    setApiLatencyMs,
  }
})
