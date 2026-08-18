/**
 * AI ↔ 工作区 UI 导航：命令类型、校验、跨窗等待快照。
 */
import { publishAiAssistantEvent, subscribeAiAssistantEvents } from './ai-assistant-session'

export const WORKSPACE_TOP_NAVS = [
  'frontend',
  'backend',
  'datatypes',
  'mysql',
  'oss',
  'icons',
  'palette',
] as const

export type WorkspaceTopNav = (typeof WORKSPACE_TOP_NAVS)[number]

export const WORKSPACE_FRONTEND_MODES = [
  'preview',
  'edit',
  'datapool',
  'methods',
  'lifecycle',
] as const

export type WorkspaceFrontendMode = (typeof WORKSPACE_FRONTEND_MODES)[number]

export const WORKSPACE_PROPS_TABS = ['style', 'event', 'dynamic'] as const
export type WorkspacePropsTab = (typeof WORKSPACE_PROPS_TABS)[number]

export const WORKSPACE_BACKEND_LAYERS = [
  'controller',
  'service',
  'data',
  'schedule',
] as const

export type WorkspaceBackendLayer = (typeof WORKSPACE_BACKEND_LAYERS)[number]

export const WORKSPACE_CANVAS_SCENES = ['h5', 'miniprogram'] as const
export type WorkspaceCanvasScene = (typeof WORKSPACE_CANVAS_SCENES)[number]

export type WorkspaceNavigateCommand =
  | { op: 'switchNav'; topNav: WorkspaceTopNav }
  | { op: 'switchMode'; mode: WorkspaceFrontendMode }
  | {
      op: 'openResource'
      scope: 'page' | 'component'
      id: string
      mode?: WorkspaceFrontendMode
    }
  | {
      op: 'selectWidget'
      scope: 'page' | 'component'
      resourceId: string
      nodeId: string
    }
  | { op: 'focusPropsTab'; tab: WorkspacePropsTab }
  | {
      op: 'openBackend'
      serviceId: string
      layer?: WorkspaceBackendLayer
      controllerId?: string
      processorId?: string
      methodId?: string
    }
  | { op: 'setCanvasScene'; scene: WorkspaceCanvasScene }
  | {
      op: 'reveal'
      topNav?: WorkspaceTopNav
      mode?: WorkspaceFrontendMode
      scope?: 'page' | 'component'
      resourceId?: string
      nodeId?: string
      propsTab?: WorkspacePropsTab
      canvasScene?: WorkspaceCanvasScene
    }

export type WorkspaceUiSnapshot = {
  topNav: WorkspaceTopNav | string
  workspaceMode: string
  resourceKind: 'page' | 'component' | ''
  activePageId: string
  activeComponentId: string
  selectedNodeId: string
  propsTab: WorkspacePropsTab | string
  canvasScene: WorkspaceCanvasScene | string
  activeServiceId: string
  backendLayer: WorkspaceBackendLayer | string
  backendControllerId: string
  backendProcessorId: string
  backendMethodId: string
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `nav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${label} 必须是 ${allowed.join(' | ')}`)
  }
  return value as T
}

function optionalOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T | undefined {
  if (value == null || value === '') return undefined
  return requireOneOf(value, allowed, label)
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少参数 ${label}`)
  }
  return value.trim()
}

function requireScope(value: unknown): 'page' | 'component' {
  if (value !== 'page' && value !== 'component') {
    throw new Error('scope 必须是 page 或 component')
  }
  return value
}

/** 从工具 args 解析为导航命令 */
export function parseWorkspaceNavigateCommand(
  op: string,
  args: Record<string, unknown>,
): WorkspaceNavigateCommand {
  switch (op) {
    case 'switchNav':
      return {
        op: 'switchNav',
        topNav: requireOneOf(args.topNav, WORKSPACE_TOP_NAVS, 'topNav'),
      }
    case 'switchMode':
      return {
        op: 'switchMode',
        mode: requireOneOf(args.mode, WORKSPACE_FRONTEND_MODES, 'mode'),
      }
    case 'openResource':
      return {
        op: 'openResource',
        scope: requireScope(args.scope),
        id: requireNonEmptyString(args.id, 'id'),
        mode: optionalOneOf(args.mode, WORKSPACE_FRONTEND_MODES, 'mode'),
      }
    case 'selectWidget':
      return {
        op: 'selectWidget',
        scope: requireScope(args.scope),
        resourceId: requireNonEmptyString(args.resourceId, 'resourceId'),
        nodeId: requireNonEmptyString(args.nodeId, 'nodeId'),
      }
    case 'focusPropsTab':
      return {
        op: 'focusPropsTab',
        tab: requireOneOf(args.tab, WORKSPACE_PROPS_TABS, 'tab'),
      }
    case 'openBackend':
      return {
        op: 'openBackend',
        serviceId: requireNonEmptyString(args.serviceId, 'serviceId'),
        layer: optionalOneOf(args.layer, WORKSPACE_BACKEND_LAYERS, 'layer'),
        controllerId:
          typeof args.controllerId === 'string'
            ? args.controllerId.trim() || undefined
            : undefined,
        processorId:
          typeof args.processorId === 'string'
            ? args.processorId.trim() || undefined
            : undefined,
        methodId:
          typeof args.methodId === 'string'
            ? args.methodId.trim() || undefined
            : undefined,
      }
    case 'setCanvasScene':
      return {
        op: 'setCanvasScene',
        scene: requireOneOf(args.scene, WORKSPACE_CANVAS_SCENES, 'scene'),
      }
    case 'reveal':
      return {
        op: 'reveal',
        topNav: optionalOneOf(args.topNav, WORKSPACE_TOP_NAVS, 'topNav'),
        mode: optionalOneOf(args.mode, WORKSPACE_FRONTEND_MODES, 'mode'),
        scope:
          args.scope == null || args.scope === ''
            ? undefined
            : requireScope(args.scope),
        resourceId:
          typeof args.resourceId === 'string'
            ? args.resourceId.trim() || undefined
            : undefined,
        nodeId:
          typeof args.nodeId === 'string'
            ? args.nodeId.trim() || undefined
            : undefined,
        propsTab: optionalOneOf(args.propsTab, WORKSPACE_PROPS_TABS, 'propsTab'),
        canvasScene: optionalOneOf(
          args.canvasScene,
          WORKSPACE_CANVAS_SCENES,
          'canvasScene',
        ),
      }
    default:
      throw new Error(`未知导航 op：${op}`)
  }
}

type SnapshotWaiter = {
  requestId: string
  resolve: (snapshot: WorkspaceUiSnapshot) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const snapshotWaiters = new Map<string, SnapshotWaiter>()

let busSubscribed = false

function ensureSnapshotBusSubscription(): void {
  if (busSubscribed) return
  busSubscribed = true
  subscribeAiAssistantEvents((event) => {
    if (event.type === 'workspace-ui-snapshot') {
      handleWorkspaceUiSnapshotEvent(event)
    }
  })
}

/** 工作区发布快照时调用（含导航完成） */
export function resolveWorkspaceUiSnapshotWaiters(
  snapshot: WorkspaceUiSnapshot,
  requestId?: string,
): void {
  if (requestId) {
    const waiter = snapshotWaiters.get(requestId)
    if (waiter) {
      clearTimeout(waiter.timer)
      snapshotWaiters.delete(requestId)
      waiter.resolve(snapshot)
      return
    }
  }
  // 无 requestId 时兑现最早的一个等待（同窗导航）
  const first = snapshotWaiters.values().next().value as
    | SnapshotWaiter
    | undefined
  if (first) {
    clearTimeout(first.timer)
    snapshotWaiters.delete(first.requestId)
    first.resolve(snapshot)
  }
}

function waitForUiSnapshot(
  requestId: string,
  timeoutMs = 4000,
): Promise<WorkspaceUiSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      snapshotWaiters.delete(requestId)
      reject(
        new Error(
          '工作区未响应导航（请确认主编辑器窗口已打开且项目已加载）',
        ),
      )
    }, timeoutMs)
    snapshotWaiters.set(requestId, { requestId, resolve, reject, timer })
  })
}

export type RequestNavigateOptions = {
  projectPath: string
  command: WorkspaceNavigateCommand
  /** 同窗：写入 Pinia pendingNavigate */
  enqueueLocal?: (command: WorkspaceNavigateCommand, requestId: string) => void
}

/**
 * 发起导航：BroadcastChannel + 可选同窗 store；等待工作区回传快照。
 */
export async function requestWorkspaceNavigate(
  options: RequestNavigateOptions,
): Promise<WorkspaceUiSnapshot> {
  ensureSnapshotBusSubscription()
  const projectPath = options.projectPath.trim()
  if (!projectPath) throw new Error('缺少 projectPath')
  const requestId = createRequestId()
  options.enqueueLocal?.(options.command, requestId)
  publishAiAssistantEvent({
    type: 'workspace-navigate',
    projectPath,
    requestId,
    command: options.command,
  })
  return waitForUiSnapshot(requestId)
}

export type RequestUiSnapshotOptions = {
  projectPath: string
  /** 同窗已有快照时可直接返回 */
  localSnapshot?: WorkspaceUiSnapshot | null
  /** 同窗：请求工作区立刻刷新快照 */
  requestLocalRefresh?: (requestId: string) => void
}

export async function requestWorkspaceUiSnapshot(
  options: RequestUiSnapshotOptions,
): Promise<WorkspaceUiSnapshot> {
  ensureSnapshotBusSubscription()
  const projectPath = options.projectPath.trim()
  if (!projectPath) throw new Error('缺少 projectPath')
  if (options.localSnapshot) {
    return options.localSnapshot
  }
  const requestId = createRequestId()
  options.requestLocalRefresh?.(requestId)
  publishAiAssistantEvent({
    type: 'workspace-ui-query',
    projectPath,
    requestId,
  })
  return waitForUiSnapshot(requestId)
}

/** 弹窗侧：收到 workspace-ui-snapshot 时兑现等待 */
export function handleWorkspaceUiSnapshotEvent(event: {
  requestId?: string
  snapshot: WorkspaceUiSnapshot
}): void {
  resolveWorkspaceUiSnapshotWaiters(event.snapshot, event.requestId)
}
