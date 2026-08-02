import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LubanProjectConfig } from '../api/projects'

const STORAGE_KEY = 'luban.activeProject'
const LEGACY_STORAGE_KEY = 'voider.activeProject'

interface StoredProject {
  path: string
  config: LubanProjectConfig
}

function loadStoredProject(): StoredProject | null {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredProject
    // 迁移旧 key
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, raw)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
    return parsed
  } catch {
    return null
  }
}

export const useProjectStore = defineStore('project', () => {
  const stored = loadStoredProject()
  const path = ref(stored?.path ?? '')
  const config = ref<LubanProjectConfig | null>(stored?.config ?? null)

  const hasProject = computed(() => Boolean(path.value && config.value))

  function setProject(nextPath: string, nextConfig: LubanProjectConfig) {
    path.value = nextPath
    config.value = nextConfig
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ path: nextPath, config: nextConfig } satisfies StoredProject),
    )
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  }

  function clearProject() {
    path.value = ''
    config.value = null
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  }

  return {
    path,
    config,
    hasProject,
    setProject,
    clearProject,
  }
})
