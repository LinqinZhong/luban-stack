import {
  acquireAiAssistantLock,
  getAiAssistantLock,
  heartbeatAiAssistantLock,
  releaseAiAssistantLock,
} from '../api/ai-assistant-log'

const WINDOW_ID_KEY = 'luban.aiAssistant.windowId'
const CHANNEL_NAME = 'luban-ai-assistant'
const HEARTBEAT_MS = 8_000

export type AiAssistantBusEvent =
  | { type: 'lock-changed'; projectPath: string; locked: boolean; ownerId: string | null }
  | { type: 'logs-changed'; projectPath: string }

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 每个浏览器窗口唯一 id（跨刷新保持） */
export function getAiAssistantWindowId(): string {
  try {
    const existing = sessionStorage.getItem(WINDOW_ID_KEY)
    if (existing) return existing
    const id = createId()
    sessionStorage.setItem(WINDOW_ID_KEY, id)
    return id
  } catch {
    return createId()
  }
}

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

export function publishAiAssistantEvent(event: AiAssistantBusEvent) {
  try {
    getChannel()?.postMessage(event)
  } catch {
    // ignore
  }
}

export function subscribeAiAssistantEvents(
  handler: (event: AiAssistantBusEvent) => void,
): () => void {
  const ch = getChannel()
  if (!ch) return () => undefined
  const onMessage = (ev: MessageEvent<AiAssistantBusEvent>) => {
    if (ev.data && typeof ev.data === 'object' && 'type' in ev.data) {
      handler(ev.data)
    }
  }
  ch.addEventListener('message', onMessage)
  return () => ch.removeEventListener('message', onMessage)
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let holdingProjectPath = ''
let holdingOwnerId = ''

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function startHeartbeat(projectPath: string, ownerId: string) {
  stopHeartbeat()
  holdingProjectPath = projectPath
  holdingOwnerId = ownerId
  heartbeatTimer = setInterval(() => {
    void heartbeatAiAssistantLock(projectPath, ownerId).catch(() => undefined)
  }, HEARTBEAT_MS)
}

export async function tryAcquireExecutionLock(projectPath: string): Promise<{
  ok: boolean
  ownerId: string
  message?: string
}> {
  const ownerId = getAiAssistantWindowId()
  try {
    await acquireAiAssistantLock(projectPath, ownerId)
    startHeartbeat(projectPath, ownerId)
    publishAiAssistantEvent({
      type: 'lock-changed',
      projectPath,
      locked: true,
      ownerId,
    })
    return { ok: true, ownerId }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'AI 助手正在其它窗口执行任务'
    return { ok: false, ownerId, message }
  }
}

export async function releaseExecutionLock(projectPath: string): Promise<void> {
  const ownerId = getAiAssistantWindowId()
  stopHeartbeat()
  holdingProjectPath = ''
  holdingOwnerId = ''
  try {
    await releaseAiAssistantLock(projectPath, ownerId)
  } catch {
    // ignore
  }
  publishAiAssistantEvent({
    type: 'lock-changed',
    projectPath,
    locked: false,
    ownerId: null,
  })
}

export async function refreshExecutionLock(projectPath: string): Promise<{
  locked: boolean
  ownerId: string | null
  heldByMe: boolean
}> {
  const me = getAiAssistantWindowId()
  const state = await getAiAssistantLock(projectPath)
  return {
    locked: state.locked,
    ownerId: state.ownerId,
    heldByMe: Boolean(state.locked && state.ownerId === me),
  }
}

/** 页面卸载时尽量释放本窗口持有的锁 */
export function bindExecutionLockUnload() {
  const onUnload = () => {
    if (!holdingProjectPath || !holdingOwnerId) return
    const body = JSON.stringify({
      projectPath: holdingProjectPath,
      ownerId: holdingOwnerId,
    })
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' })
        navigator.sendBeacon('/api/ai/assistant/lock/release', blob)
      }
    } catch {
      // ignore
    }
  }
  window.addEventListener('pagehide', onUnload)
  window.addEventListener('beforeunload', onUnload)
  return () => {
    window.removeEventListener('pagehide', onUnload)
    window.removeEventListener('beforeunload', onUnload)
  }
}

export function openAiAssistantWindow(sessionId?: string) {
  const url = sessionId
    ? `/ai-assistant?session=${encodeURIComponent(sessionId)}`
    : '/ai-assistant'
  const name = `luban-ai-assistant-${sessionId || 'new'}-${Date.now()}`
  const features = [
    'popup=yes',
    'width=420',
    'height=720',
    'left=120',
    'top=80',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',')
  const win = window.open(url, name, features)
  if (!win) {
    // 弹窗被拦截时退化为同标签打开
    window.open(url, '_blank')
  }
}
