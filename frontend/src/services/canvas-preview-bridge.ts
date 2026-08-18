/**
 * AI ↔ 工作区真实预览画布：命令类型、跨窗等待结果。
 */
import {
  publishAiAssistantEvent,
  subscribeAiAssistantEvents,
} from './ai-assistant-session'
import type { PreviewLayoutNode } from './page-preview-session'

export type CanvasPreviewCommand =
  | {
      op: 'open'
      scope: 'page' | 'component'
      id: string
      query?: Record<string, unknown>
    }
  | {
      op: 'click'
      nodeId: string
      eventKey?: string
      scope?: { item?: unknown; index?: number }
      eventArgs?: Record<string, unknown>
    }
  | { op: 'setData'; field: string; value: unknown }
  | {
      op: 'runMethod'
      name: string
      args?: Record<string, unknown>
    }
  | {
      op: 'getState'
      includeLayout?: boolean
      fields?: string[]
    }
  | {
      op: 'wait'
      ms?: number
      field?: string
      equals?: unknown
      contains?: string
      timeoutMs?: number
    }

export type CanvasPreviewSnapshot = {
  kind: 'page' | 'component'
  id: string
  fields: Record<string, unknown>
  toast: { message: string; id: number } | null
  logs: Array<{ level: string; message: string; location?: string }>
  layout?: PreviewLayoutNode
  layoutRisks?: string[]
  /** 真实预览 DOM 测得的屏幕溢出情况 */
  viewportOverflow?: import('./viewport-overflow').ViewportOverflowReport | null
  workspaceMode: string
}

export type CanvasPreviewResultPayload = {
  ok: boolean
  snapshot?: CanvasPreviewSnapshot
  error?: string
  /** click 等附加信息 */
  meta?: Record<string, unknown>
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

type ResultWaiter = {
  requestId: string
  resolve: (payload: CanvasPreviewResultPayload) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const resultWaiters = new Map<string, ResultWaiter>()

/** 最近一次画布快照（供 assert 与测试步骤读取 layout） */
const lastSnapshots = new Map<string, CanvasPreviewSnapshot>()

let busSubscribed = false

function ensureResultBusSubscription(): void {
  if (busSubscribed) return
  busSubscribed = true
  subscribeAiAssistantEvents((event) => {
    if (event.type === 'canvas-preview-result') {
      resolveCanvasPreviewResultWaiters(
        {
          ok: event.ok,
          snapshot: event.snapshot,
          error: event.error,
          meta: event.meta,
        },
        event.requestId,
      )
    }
  })
}

export function getLastCanvasPreviewSnapshot(
  projectPath: string,
): CanvasPreviewSnapshot | null {
  return lastSnapshots.get(projectPath.trim()) ?? null
}

export function rememberCanvasPreviewSnapshot(
  projectPath: string,
  snapshot: CanvasPreviewSnapshot,
): void {
  lastSnapshots.set(projectPath.trim(), snapshot)
}

export function resolveCanvasPreviewResultWaiters(
  payload: CanvasPreviewResultPayload,
  requestId?: string,
): void {
  if (requestId) {
    const waiter = resultWaiters.get(requestId)
    if (waiter) {
      clearTimeout(waiter.timer)
      resultWaiters.delete(requestId)
      waiter.resolve(payload)
      return
    }
  }
  const first = resultWaiters.values().next().value as ResultWaiter | undefined
  if (first) {
    clearTimeout(first.timer)
    resultWaiters.delete(first.requestId)
    first.resolve(payload)
  }
}

function waitForCanvasResult(
  requestId: string,
  timeoutMs: number,
): Promise<CanvasPreviewResultPayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resultWaiters.delete(requestId)
      reject(
        new Error(
          '工作区未响应画布预览命令（请确认主编辑器窗口已打开且项目已加载）',
        ),
      )
    }, timeoutMs)
    resultWaiters.set(requestId, { requestId, resolve, reject, timer })
  })
}

export type RequestCanvasPreviewOptions = {
  projectPath: string
  command: CanvasPreviewCommand
  /** 同窗：写入 Pinia pending */
  enqueueLocal?: (command: CanvasPreviewCommand, requestId: string) => void
  /** open / wait 可能较久 */
  timeoutMs?: number
}

/**
 * 发起画布预览命令：BroadcastChannel + 可选同窗 store；等待工作区回传结果。
 */
export async function requestCanvasPreviewCommand(
  options: RequestCanvasPreviewOptions,
): Promise<CanvasPreviewResultPayload> {
  ensureResultBusSubscription()
  const projectPath = options.projectPath.trim()
  if (!projectPath) throw new Error('缺少 projectPath')
  const requestId = createRequestId()
  const timeoutMs =
    options.timeoutMs ??
    (options.command.op === 'wait'
      ? Math.max(10_000, (options.command.timeoutMs ?? 8000) + 2000)
      : options.command.op === 'open'
        ? 12_000
        : 8000)
  options.enqueueLocal?.(options.command, requestId)
  publishAiAssistantEvent({
    type: 'canvas-preview-command',
    projectPath,
    requestId,
    command: options.command,
  })
  const payload = await waitForCanvasResult(requestId, timeoutMs)
  if (payload.ok && payload.snapshot) {
    rememberCanvasPreviewSnapshot(projectPath, payload.snapshot)
  }
  return payload
}

export async function requireCanvasPreviewCommand(
  options: RequestCanvasPreviewOptions,
): Promise<CanvasPreviewSnapshot> {
  const payload = await requestCanvasPreviewCommand(options)
  if (!payload.ok) {
    throw new Error(payload.error || '画布预览命令失败')
  }
  if (!payload.snapshot) {
    throw new Error('画布预览未返回快照')
  }
  return payload.snapshot
}
