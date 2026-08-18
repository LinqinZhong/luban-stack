/** 工作区 UI 状态：刷新 / 切活动栏后恢复 */

const STORAGE_PREFIX = 'luban.workspaceUi.v1:'
const LEGACY_STORAGE_PREFIX = 'voider.workspaceUi.v1:'

export type BackendLayer = 'controller' | 'service' | 'data' | 'schedule'

export type BackendLayerProcState = {
  processorId: string
  methodId: string
  /** 业务层：打开的工作流 */
  flowEditing: {
    processorId: string
    methodId: string
    focusNodeId?: string
  } | null
}

export type BackendServiceUiState = {
  layer: BackendLayer
  controllerId: string
  /** business / data */
  processors: Partial<Record<'business' | 'data', BackendLayerProcState>>
}

export type WorkspaceUiState = {
  topNav: string
  resourceKind: 'page' | 'component'
  workspaceMode: string
  activePageId: string
  activeComponentId: string
  activeServiceId: string
  backendServiceLayer: BackendLayer
  backendByService: Record<string, BackendServiceUiState>
}

function storageKey(projectPath: string): string {
  return `${STORAGE_PREFIX}${projectPath}`
}

export function loadWorkspaceUiState(
  projectPath: string,
): WorkspaceUiState | null {
  if (!projectPath) return null
  try {
    const key = storageKey(projectPath)
    let raw = localStorage.getItem(key)
    if (!raw) {
      const legacyKey = `${LEGACY_STORAGE_PREFIX}${projectPath}`
      raw = localStorage.getItem(legacyKey)
      if (raw) {
        localStorage.setItem(key, raw)
        localStorage.removeItem(legacyKey)
      }
    }
    if (!raw) return null
    return JSON.parse(raw) as WorkspaceUiState
  } catch {
    return null
  }
}

export function saveWorkspaceUiState(
  projectPath: string,
  state: WorkspaceUiState,
): void {
  if (!projectPath) return
  try {
    localStorage.setItem(storageKey(projectPath), JSON.stringify(state))
    localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${projectPath}`)
  } catch {
    // quota / private mode
  }
}

export function emptyBackendServiceUiState(
  layer: BackendLayer = 'controller',
): BackendServiceUiState {
  return {
    layer,
    controllerId: '',
    processors: {},
  }
}
