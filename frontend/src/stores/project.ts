import { create } from 'zustand'
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
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, raw)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
    return parsed
  } catch {
    return null
  }
}

type ProjectState = {
  path: string
  config: LubanProjectConfig | null
  hasProject: boolean
  setProject: (nextPath: string, nextConfig: LubanProjectConfig) => void
  clearProject: () => void
}

const stored = loadStoredProject()

export const useProjectStore = create<ProjectState>((set) => ({
  path: stored?.path ?? '',
  config: stored?.config ?? null,
  hasProject: Boolean(stored?.path && stored?.config),
  setProject(nextPath, nextConfig) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ path: nextPath, config: nextConfig } satisfies StoredProject),
    )
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    set({
      path: nextPath,
      config: nextConfig,
      hasProject: Boolean(nextPath && nextConfig),
    })
  },
  clearProject() {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    set({ path: '', config: null, hasProject: false })
  },
}))
