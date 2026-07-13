import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { VoiderProjectConfig } from '../api/projects'

const STORAGE_KEY = 'voider.activeProject'

interface StoredProject {
  path: string
  config: VoiderProjectConfig
}

function loadStoredProject(): StoredProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredProject
  } catch {
    return null
  }
}

export const useProjectStore = defineStore('project', () => {
  const stored = loadStoredProject()
  const path = ref(stored?.path ?? '')
  const config = ref<VoiderProjectConfig | null>(stored?.config ?? null)

  const hasProject = computed(() => Boolean(path.value && config.value))

  function setProject(nextPath: string, nextConfig: VoiderProjectConfig) {
    path.value = nextPath
    config.value = nextConfig
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ path: nextPath, config: nextConfig } satisfies StoredProject),
    )
  }

  function clearProject() {
    path.value = ''
    config.value = null
    localStorage.removeItem(STORAGE_KEY)
  }

  return {
    path,
    config,
    hasProject,
    setProject,
    clearProject,
  }
})
