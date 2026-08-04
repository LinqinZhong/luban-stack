<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowRight,
  Check,
  Close,
  CopyDocument,
  Loading,
  Plus,
  Promotion,
  WarningFilled,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useWorkspaceSettingsStore } from '../../stores/workspace-settings'
import { useAiAssistantStore } from '../../stores/ai-assistant'
import { useProjectStore } from '../../stores/project'
import { agentDidMutateFromTool, runAiAgent } from '../../services/ai-agent'
import {
  deleteAiAssistantLog,
  getAiAssistantLog,
  listAiAssistantLogs,
  saveAiAssistantLog,
  type AiAssistantLogStatus,
  type AiAssistantLogSummary,
} from '../../api/ai-assistant-log'
import {
  bindExecutionLockUnload,
  getAiAssistantWindowId,
  openAiAssistantWindow,
  publishAiAssistantEvent,
  refreshExecutionLock,
  releaseExecutionLock,
  subscribeAiAssistantEvents,
  tryAcquireExecutionLock,
} from '../../services/ai-assistant-session'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    mode?: 'panel' | 'window'
    initialSessionId?: string
  }>(),
  {
    mode: 'panel',
    initialSessionId: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const PANEL_WIDTH = 300
const MIN_HEIGHT = 100
const POSITION_KEY = 'luban.aiAssistantPanel.position'
const DRAFT_TAB_ID = '__draft__'

type PanelPosition = {
  left: number
  top: number
  height: number
}

type TimelineItem =
  | { id: string; kind: 'user'; content: string }
  | {
      id: string
      kind: 'thinking'
      index: number
      content: string
      collapsed: boolean
      streaming: boolean
    }
  | {
      id: string
      kind: 'tool'
      tool: string
      label: string
      status: 'running' | 'done' | 'error'
      error?: string
    }
  | {
      id: string
      kind: 'ask'
      question: string
      options: string[]
      answered?: string
    }
  | { id: string; kind: 'result'; content: string }
  | { id: string; kind: 'error'; content: string }
  | { id: string; kind: 'status'; content: string }

const settings = useWorkspaceSettingsStore()
const aiAssistant = useAiAssistantStore()
const projectStore = useProjectStore()
const panelRef = ref<HTMLElement | null>(null)
const messagesRef = ref<HTMLElement | null>(null)
const timeline = ref<TimelineItem[]>([])
const sending = ref(false)
const waitingAsk = ref(false)
const historyLogs = ref<AiAssistantLogSummary[]>([])
const activeTabId = ref(DRAFT_TAB_ID)
const remoteLocked = ref(false)
const loadingHistory = ref(false)
const windowId = getAiAssistantWindowId()
let abortController: AbortController | null = null
let askResolver: ((answer: string) => void) | null = null
let sessionMutated = false
let thinkingSeq = 0
let activeThinkingId: string | null = null
let activeAskId: string | null = null
let needNewThinking = true
let activeLogId: string | null = null
let unsubBus: (() => void) | null = null
let unbindUnload: (() => void) | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

const isWindowMode = computed(() => props.mode === 'window')
const lockedByOther = computed(() => remoteLocked.value && !sending.value)
const draftTitle = computed(() => {
  const firstUser = timeline.value.find((item) => item.kind === 'user')
  if (!firstUser || firstUser.kind !== 'user') return '新对话'
  const text = firstUser.content.trim()
  return text ? text.slice(0, 24) : '新对话'
})
const historyTabs = computed(() => {
  const tabs: Array<{ id: string; title: string; status?: AiAssistantLogStatus }> = []
  if (activeLogId && activeTabId.value === activeLogId) {
    const hit = historyLogs.value.find((item) => item.id === activeLogId)
    tabs.push({
      id: activeLogId,
      title: hit?.title || draftTitle.value,
      status: hit?.status,
    })
  } else {
    tabs.push({ id: DRAFT_TAB_ID, title: draftTitle.value })
  }
  for (const log of historyLogs.value) {
    if (tabs.some((tab) => tab.id === log.id)) continue
    tabs.push({
      id: log.id,
      title: log.title || '未命名',
      status: log.status,
    })
  }
  return tabs
})

const mentionOptions = computed(() => {
  const seen = new Set<string>()
  const out: Array<{ label: string; value: string }> = []
  for (const item of aiAssistant.mentionOptions) {
    if (seen.has(item.value)) continue
    seen.add(item.value)
    out.push({ label: item.label, value: item.value })
  }
  return out
})

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; nodeId: string }

function splitMentionParts(content: string): MessagePart[] {
  const parts: MessagePart[] = []
  const re = /@([^\s@]+)/g
  let last = 0
  let match: RegExpExecArray | null
  let occurrenceByValue = new Map<string, number>()
  while ((match = re.exec(content))) {
    if (match.index > last) {
      parts.push({ type: 'text', text: content.slice(last, match.index) })
    }
    const value = match[1]
    const occ = occurrenceByValue.get(value) ?? 0
    occurrenceByValue.set(value, occ + 1)
    const candidates = aiAssistant.mentionOptions.filter((item) => item.value === value)
    const nodeId = candidates[Math.min(occ, Math.max(0, candidates.length - 1))]?.nodeId
    if (nodeId) parts.push({ type: 'mention', text: match[0], nodeId })
    else parts.push({ type: 'text', text: match[0] })
    last = match.index + match[0].length
  }
  if (last < content.length) parts.push({ type: 'text', text: content.slice(last) })
  return parts.length ? parts : [{ type: 'text', text: content }]
}

function selectMentionNode(nodeId: string) {
  aiAssistant.requestSelectNode(nodeId)
}

function onComposerClick(event: MouseEvent) {
  const target = event.target
  const textarea =
    target instanceof HTMLTextAreaElement
      ? target
      : target instanceof Element
        ? target.closest('textarea')
        : null
  if (!(textarea instanceof HTMLTextAreaElement)) return
  void nextTick(() => {
    const caret = textarea.selectionStart ?? 0
    const hit = aiAssistant.resolveMentionAt(aiAssistant.composerText, caret)
    if (hit) aiAssistant.requestSelectMention(hit)
  })
}

const left = ref(0)
const top = ref(0)
const height = ref(280)
let hasPlaced = false
const dragging = ref(false)
const resizing = ref(false)
let dragOffsetX = 0
let dragOffsetY = 0
let resizeStartY = 0
let resizeStartHeight = 0

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const activeModel = computed(
  () => settings.aiModels.find((model) => model.id === settings.activeAiModelId) ?? null,
)
const activeModelLabel = computed(() => activeModel.value?.name || '选择模型')
const showMessages = computed(() => height.value >= 180)
const canSend = computed(
  () =>
    Boolean(aiAssistant.composerText.trim()) &&
    (!sending.value || waitingAsk.value) &&
    !lockedByOther.value,
)

function setAskResolver(resolve: ((answer: string) => void) | null) {
  askResolver = resolve
  waitingAsk.value = Boolean(resolve)
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function isTimelineItem(value: unknown): value is TimelineItem {
  if (!value || typeof value !== 'object') return false
  const row = value as { id?: unknown; kind?: unknown }
  return typeof row.id === 'string' && typeof row.kind === 'string'
}

async function refreshLockState() {
  if (!projectStore.path) {
    remoteLocked.value = false
    return
  }
  try {
    const state = await refreshExecutionLock(projectStore.path)
    remoteLocked.value = state.locked && !state.heldByMe
  } catch {
    // ignore
  }
}

async function refreshHistoryList() {
  if (!projectStore.path) {
    historyLogs.value = []
    return
  }
  loadingHistory.value = true
  try {
    const { logs } = await listAiAssistantLogs(projectStore.path)
    historyLogs.value = logs
  } catch {
    // ignore
  } finally {
    loadingHistory.value = false
  }
}

function schedulePersist(status: AiAssistantLogStatus) {
  if (!projectStore.path || !activeLogId) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void persistCurrentLog(status)
  }, 280)
}

async function persistCurrentLog(status: AiAssistantLogStatus) {
  if (!projectStore.path || !activeLogId) return
  const title = draftTitle.value === '新对话' ? '未命名' : draftTitle.value
  try {
    await saveAiAssistantLog(projectStore.path, {
      id: activeLogId,
      title,
      status,
      timeline: timeline.value,
      modelId: activeModel.value?.id,
      modelName: activeModel.value?.name,
    })
    publishAiAssistantEvent({
      type: 'logs-changed',
      projectPath: projectStore.path,
    })
    await refreshHistoryList()
  } catch {
    // 持久化失败不阻断对话
  }
}

function resetConversation() {
  if (sending.value) {
    ElMessage.warning('请等待当前任务结束')
    return
  }
  timeline.value = []
  activeLogId = null
  activeTabId.value = DRAFT_TAB_ID
  thinkingSeq = 0
  activeThinkingId = null
  activeAskId = null
  needNewThinking = true
  sessionMutated = false
  setAskResolver(null)
}

async function selectHistoryTab(tabId: string) {
  if (tabId === activeTabId.value) return
  if (sending.value) {
    ElMessage.warning('执行中无法切换历史记录')
    return
  }
  if (tabId === DRAFT_TAB_ID) {
    resetConversation()
    return
  }
  if (!projectStore.path) return
  try {
    const { log } = await getAiAssistantLog(projectStore.path, tabId)
    timeline.value = log.timeline.filter(isTimelineItem)
    activeLogId = log.id
    activeTabId.value = log.id
    thinkingSeq = timeline.value.filter((item) => item.kind === 'thinking').length
    activeThinkingId = null
    activeAskId = null
    needNewThinking = true
    sessionMutated = false
    setAskResolver(null)
    stickToBottom.value = true
    void flushUi()
  } catch (err) {
    const message = err instanceof Error ? err.message : '加载历史失败'
    ElMessage.error(message)
  }
}

function openInNewWindow(sessionId?: string) {
  const id = sessionId && sessionId !== DRAFT_TAB_ID ? sessionId : undefined
  openAiAssistantWindow(id)
}

async function removeHistoryTab(tabId: string, event: MouseEvent) {
  event.stopPropagation()
  if (tabId === DRAFT_TAB_ID) return
  if (sending.value && activeLogId === tabId) {
    ElMessage.warning('执行中无法删除')
    return
  }
  if (!projectStore.path) return
  try {
    await deleteAiAssistantLog(projectStore.path, tabId)
    if (activeTabId.value === tabId) resetConversation()
    publishAiAssistantEvent({
      type: 'logs-changed',
      projectPath: projectStore.path,
    })
    await refreshHistoryList()
  } catch (err) {
    const message = err instanceof Error ? err.message : '删除失败'
    ElMessage.error(message)
  }
}

function patchItem(id: string, patch: Partial<TimelineItem>) {
  const index = timeline.value.findIndex((item) => item.id === id)
  if (index < 0) return
  timeline.value[index] = { ...timeline.value[index], ...patch } as TimelineItem
}

function sealActiveThinking() {
  if (!activeThinkingId) return
  patchItem(activeThinkingId, { streaming: false })
  activeThinkingId = null
  needNewThinking = true
}

async function flushUi() {
  scrollMessagesToBottomIfNeeded()
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function maxHeight(): number {
  return Math.max(MIN_HEIGHT, window.innerHeight - 16)
}

function clampPosition() {
  const maxLeft = Math.max(8, window.innerWidth - PANEL_WIDTH - 8)
  const maxTop = Math.max(8, window.innerHeight - height.value - 8)
  left.value = Math.min(Math.max(8, left.value), maxLeft)
  top.value = Math.min(Math.max(8, top.value), maxTop)
}

function loadSavedPosition(): PanelPosition | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PanelPosition>
    if (
      typeof parsed.left !== 'number' ||
      typeof parsed.top !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return null
    }
    return {
      left: parsed.left,
      top: parsed.top,
      height: Math.min(maxHeight(), Math.max(MIN_HEIGHT, parsed.height)),
    }
  } catch {
    return null
  }
}

function savePosition() {
  localStorage.setItem(
    POSITION_KEY,
    JSON.stringify({ left: left.value, top: top.value, height: height.value }),
  )
}

function placeDefault() {
  height.value = Math.min(320, maxHeight())
  left.value = Math.max(8, window.innerWidth - PANEL_WIDTH - 16)
  top.value = 72
  clampPosition()
}

function restoreOrPlace() {
  const saved = loadSavedPosition()
  if (saved) {
    left.value = saved.left
    top.value = saved.top
    height.value = saved.height
    clampPosition()
  } else placeDefault()
  hasPlaced = true
}

function close() {
  if (!isWindowMode.value) {
    clampPosition()
    savePosition()
  }
  visible.value = false
  if (isWindowMode.value) window.close()
}

function onModelSelect(id: string) {
  settings.useAiModel(id)
}

/** 仅在用户已贴底时自动滚到底，避免打断往上翻看历史 */
const stickToBottom = ref(true)

function onMessagesScroll() {
  const el = messagesRef.value
  if (!el) return
  const gap = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom.value = gap <= 48
}

function scrollMessagesToBottomIfNeeded() {
  if (!stickToBottom.value) return
  void nextTick(() => {
    const el = messagesRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function toggleThinking(id: string) {
  const item = timeline.value.find((row) => row.id === id)
  if (!item || item.kind !== 'thinking') return
  patchItem(id, { collapsed: !item.collapsed })
}

function resolveAsk(answer: string) {
  if (activeAskId) {
    const item = timeline.value.find((row) => row.id === activeAskId)
    if (item?.kind === 'ask' && !item.answered) {
      patchItem(activeAskId, { answered: answer })
    }
  }
  const resolve = askResolver
  setAskResolver(null)
  activeAskId = null
  needNewThinking = true
  if (resolve) resolve(answer)
  void flushUi()
}

function onOptionClick(option: string) {
  if (!askResolver) return
  timeline.value.push({
    id: uid('user'),
    kind: 'user',
    content: option,
  })
  resolveAsk(option)
}

function ensureThinkingSlot() {
  if (!needNewThinking && activeThinkingId) return
  sealActiveThinking()
  thinkingSeq += 1
  const id = uid('think')
  activeThinkingId = id
  needNewThinking = false
  timeline.value.push({
    id,
    kind: 'thinking',
    index: thinkingSeq,
    content: '',
    collapsed: false,
    streaming: true,
  })
}

function upsertThinking(full: string) {
  ensureThinkingSlot()
  if (!activeThinkingId) return
  patchItem(activeThinkingId, {
    content: full,
    streaming: true,
    collapsed: false,
  })
}

async function sendMessage() {
  const text = aiAssistant.composerText.trim()
  if (!text) return

  if (askResolver) {
    timeline.value.push({
      id: uid('user'),
      kind: 'user',
      content: text,
    })
    aiAssistant.clearComposer()
    resolveAsk(text)
    return
  }

  if (sending.value) return
  if (lockedByOther.value) {
    ElMessage.warning('AI 助手正在其它窗口执行任务，请稍候')
    return
  }
  if (!activeModel.value) {
    ElMessage.warning('请先在设置中添加模型，并在此选择')
    return
  }
  if (!projectStore.path) {
    ElMessage.warning('请先打开项目')
    return
  }

  const lock = await tryAcquireExecutionLock(projectStore.path)
  if (!lock.ok) {
    remoteLocked.value = true
    ElMessage.warning(lock.message || 'AI 助手正在其它窗口执行任务')
    return
  }
  remoteLocked.value = false

  if (!isWindowMode.value && height.value < 360) {
    height.value = Math.min(460, maxHeight())
    clampPosition()
    savePosition()
  }

  const mentions = aiAssistant.mentionsInText(text).map((item) => ({
    nodeId: item.nodeId,
    label: item.label,
    address: item.value,
    resourceScope: item.resourceScope,
    resourceId: item.resourceId,
  }))

  // 从历史只读切到新执行时开新会话
  if (activeTabId.value !== DRAFT_TAB_ID && activeTabId.value !== activeLogId) {
    activeLogId = null
  }
  if (!activeLogId || activeTabId.value === DRAFT_TAB_ID) {
    activeLogId = uid('log')
    activeTabId.value = activeLogId
  }

  timeline.value.push({
    id: uid('user'),
    kind: 'user',
    content: text,
  })
  aiAssistant.clearComposer()

  sessionMutated = false
  thinkingSeq = 0
  activeThinkingId = null
  activeAskId = null
  needNewThinking = true
  stickToBottom.value = true
  sending.value = true
  ensureThinkingSlot()
  timeline.value.push({
    id: 'status_live',
    kind: 'status',
    content: '正在连接模型…',
  })
  await persistCurrentLog('running')
  await flushUi()

  abortController?.abort()
  abortController = new AbortController()

  let finalStatus: AiAssistantLogStatus = 'done'
  try {
    await runAiAgent({
      projectPath: projectStore.path,
      model: activeModel.value,
      userText: text,
      active: aiAssistant.activeResource,
      mentions,
      signal: abortController.signal,
      hooks: {
        onThinking: (full) => {
          upsertThinking(full)
          void flushUi()
        },
        onTool: (event) => {
          sealActiveThinking()
          const existing = timeline.value.find(
            (item) => item.kind === 'tool' && item.id === event.id,
          )
          if (existing && existing.kind === 'tool') {
            patchItem(event.id, {
              status: event.status,
              error: event.error,
              label: event.label,
              tool: event.tool,
            })
          } else {
            timeline.value.push({
              id: event.id,
              kind: 'tool',
              tool: event.tool,
              label: event.label,
              status: event.status,
              error: event.error,
            })
          }
          if (event.status === 'done' && agentDidMutateFromTool(event.tool)) {
            sessionMutated = true
            // 每次改动后立刻刷新当前工作区内容
            aiAssistant.bumpResourceEpoch()
          }
          needNewThinking = true
          schedulePersist('running')
          void flushUi()
        },
        onStatus: (text) => {
          if (!text) {
            // 清掉临时状态条
            timeline.value = timeline.value.filter((item) => item.kind !== 'status')
            void flushUi()
            return
          }
          const statusId = 'status_live'
          const existing = timeline.value.find((item) => item.id === statusId)
          if (existing) patchItem(statusId, { content: text })
          else timeline.value.push({ id: statusId, kind: 'status', content: text })
          void flushUi()
        },
        onAskUser: ({ question, options }) =>
          new Promise<string>((resolve) => {
            sealActiveThinking()
            timeline.value = timeline.value.filter((item) => item.kind !== 'status')
            const id = uid('ask')
            activeAskId = id
            timeline.value.push({
              id,
              kind: 'ask',
              question,
              options,
            })
            setAskResolver(resolve)
            schedulePersist('running')
            void flushUi()
          }),
        onFinish: (message) => {
          sealActiveThinking()
          setAskResolver(null)
          timeline.value = timeline.value.filter((item) => item.kind !== 'status')
          timeline.value.push({
            id: uid('result'),
            kind: 'result',
            content: message,
          })
          void flushUi()
        },
      },
    })
  } catch (err) {
    setAskResolver(null)
    sealActiveThinking()
    timeline.value = timeline.value.filter((item) => item.kind !== 'status')
    if (err instanceof DOMException && err.name === 'AbortError') {
      finalStatus = 'cancelled'
      timeline.value.push({
        id: uid('error'),
        kind: 'error',
        content: '已取消',
      })
    } else {
      finalStatus = 'error'
      const message = err instanceof Error ? err.message : 'AI 执行失败'
      timeline.value.push({
        id: uid('error'),
        kind: 'error',
        content: message,
      })
      ElMessage.error(message)
    }
  } finally {
    // 异常中断时也确保已改动内容刷到画布
    if (sessionMutated) aiAssistant.bumpResourceEpoch()
    sending.value = false
    if (!askResolver) waitingAsk.value = false
    abortController = null
    await persistCurrentLog(finalStatus)
    if (projectStore.path) await releaseExecutionLock(projectStore.path)
    await refreshLockState()
    await flushUi()
  }
}

function onComposerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendMessage()
  }
}

function onDragStart(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('button, .el-dropdown')) return
  dragging.value = true
  dragOffsetX = event.clientX - left.value
  dragOffsetY = event.clientY - top.value
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  event.preventDefault()
}

function onDragMove(event: PointerEvent) {
  if (!dragging.value) return
  left.value = event.clientX - dragOffsetX
  top.value = event.clientY - dragOffsetY
  clampPosition()
}

function onDragEnd() {
  dragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  clampPosition()
  savePosition()
}

function onResizeStart(event: PointerEvent) {
  if (event.button !== 0) return
  resizing.value = true
  resizeStartY = event.clientY
  resizeStartHeight = height.value
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
  event.preventDefault()
  event.stopPropagation()
}

function onResizeMove(event: PointerEvent) {
  if (!resizing.value) return
  height.value = Math.min(
    maxHeight(),
    Math.max(MIN_HEIGHT, resizeStartHeight + (event.clientY - resizeStartY)),
  )
  clampPosition()
}

function onResizeEnd() {
  resizing.value = false
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  clampPosition()
  savePosition()
}

function onWindowResize() {
  if (isWindowMode.value) {
    height.value = window.innerHeight
    return
  }
  height.value = Math.min(height.value, maxHeight())
  clampPosition()
  if (hasPlaced) savePosition()
}

watch(visible, (open) => {
  if (isWindowMode.value) return
  if (open) {
    restoreOrPlace()
    void refreshHistoryList()
    void refreshLockState()
  } else if (hasPlaced) savePosition()
})

watch(
  () => projectStore.path,
  () => {
    void refreshHistoryList()
    void refreshLockState()
  },
)

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  unbindUnload = bindExecutionLockUnload()
  unsubBus = subscribeAiAssistantEvents((event) => {
    if (!projectStore.path || event.projectPath !== projectStore.path) return
    if (event.type === 'lock-changed') {
      remoteLocked.value = event.locked && event.ownerId !== windowId
    } else if (event.type === 'logs-changed') {
      void refreshHistoryList()
    }
  })
  if (isWindowMode.value) {
    hasPlaced = true
    left.value = 0
    top.value = 0
    height.value = window.innerHeight
  } else if (visible.value) {
    restoreOrPlace()
  }
  void refreshHistoryList()
  void refreshLockState()
  if (props.initialSessionId) {
    void selectHistoryTab(props.initialSessionId)
  }
})

onBeforeUnmount(() => {
  abortController?.abort()
  setAskResolver(null)
  if (persistTimer) clearTimeout(persistTimer)
  if (projectStore.path && sending.value) {
    void releaseExecutionLock(projectStore.path)
  }
  unsubBus?.()
  unbindUnload?.()
  if (hasPlaced && !isWindowMode.value) savePosition()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="panelRef"
      class="ai-assistant-panel"
      :class="{
        'is-dragging': dragging,
        'is-resizing': resizing,
        'is-window': isWindowMode,
      }"
      :style="
        isWindowMode
          ? { width: '100%', height: '100%', left: '0', top: '0' }
          : {
              width: `${PANEL_WIDTH}px`,
              height: `${height}px`,
              left: `${left}px`,
              top: `${top}px`,
            }
      "
    >
      <div
        class="ai-header"
        :class="{ 'is-draggable': !isWindowMode }"
        @pointerdown="isWindowMode ? undefined : onDragStart"
      >
        <span class="ai-title">AI 助手</span>
        <div class="ai-header-actions">
          <button
            type="button"
            class="ai-icon-btn"
            aria-label="新开窗口"
            title="新开窗口"
            @click="openInNewWindow()"
          >
            <el-icon :size="14"><CopyDocument /></el-icon>
          </button>
          <button type="button" class="ai-icon-btn" aria-label="关闭" @click="close">
            <el-icon :size="14"><Close /></el-icon>
          </button>
        </div>
      </div>

      <div class="ai-history-bar">
        <button
          type="button"
          class="ai-history-new"
          title="新对话"
          :disabled="sending"
          @click="resetConversation"
        >
          <el-icon :size="12"><Plus /></el-icon>
        </button>
        <div class="ai-history-tabs">
          <button
            v-for="tab in historyTabs"
            :key="tab.id"
            type="button"
            class="ai-history-tab"
            :class="{
              'is-active': tab.id === activeTabId,
              'is-running': tab.status === 'running',
            }"
            :title="tab.title"
            :disabled="sending && tab.id !== activeTabId"
            @click="selectHistoryTab(tab.id)"
            @dblclick="tab.id !== DRAFT_TAB_ID && openInNewWindow(tab.id)"
          >
            <span class="ai-history-tab-text">{{ tab.title }}</span>
            <span
              v-if="tab.id !== DRAFT_TAB_ID"
              class="ai-history-tab-close"
              title="删除"
              @click="removeHistoryTab(tab.id, $event)"
            >
              ×
            </span>
          </button>
        </div>
      </div>

      <div v-if="lockedByOther" class="ai-lock-banner">
        其它窗口正在执行任务，请稍候
      </div>

      <div
        v-show="showMessages || isWindowMode"
        ref="messagesRef"
        class="ai-messages"
        @scroll="onMessagesScroll"
      >
        <div v-if="!timeline.length" class="ai-empty">
          {{
            loadingHistory
              ? '加载历史记录…'
              : '描述需求，AI 将检索并操作项目'
          }}
        </div>

        <div
          v-for="item in timeline"
          :key="item.id"
          class="ai-item"
          :class="`is-${item.kind}`"
        >
          <!-- 需求 / 回答 -->
          <div v-if="item.kind === 'user'" class="ai-bubble is-user">
            <template v-for="(part, index) in splitMentionParts(item.content)" :key="index">
              <button
                v-if="part.type === 'mention'"
                type="button"
                class="ai-msg-mention"
                @click="selectMentionNode(part.nodeId)"
              >
                {{ part.text }}
              </button>
              <span v-else>{{ part.text }}</span>
            </template>
          </div>

          <!-- 思考 N -->
          <div v-else-if="item.kind === 'thinking'" class="ai-thinking-card">
            <button
              type="button"
              class="ai-thinking-toggle"
              @click="toggleThinking(item.id)"
            >
              <el-icon :size="12">
                <ArrowRight v-if="item.collapsed" />
                <ArrowDown v-else />
              </el-icon>
              <span>{{ item.streaming ? `思考${item.index}中` : `思考${item.index}` }}</span>
            </button>
            <pre v-show="!item.collapsed" class="ai-thinking-body">{{
              item.content || (item.streaming ? '…' : '')
            }}</pre>
          </div>

          <!-- 处理 N -->
          <div
            v-else-if="item.kind === 'tool'"
            class="ai-tool-line"
            :class="`is-${item.status}`"
          >
            <span class="ai-tool-label">{{ item.label }}</span>
            <el-icon
              v-if="item.status === 'running'"
              class="ai-tool-icon is-loading"
              :size="14"
            >
              <Loading />
            </el-icon>
            <el-icon
              v-else-if="item.status === 'done'"
              class="ai-tool-icon is-done"
              :size="14"
            >
              <Check />
            </el-icon>
            <el-icon
              v-else
              class="ai-tool-icon is-error"
              :size="14"
              :title="item.error || '失败'"
            >
              <WarningFilled />
            </el-icon>
          </div>

          <!-- 询问 -->
          <div v-else-if="item.kind === 'ask'" class="ai-ask-card">
            <div class="ai-ask-question">{{ item.question }}</div>
            <div v-if="item.options.length" class="ai-ask-options">
              <button
                v-for="option in item.options"
                :key="option"
                type="button"
                class="ai-ask-option"
                :disabled="Boolean(item.answered) || !waitingAsk"
                :class="{ 'is-selected': item.answered === option }"
                @click="onOptionClick(option)"
              >
                {{ option }}
              </button>
            </div>
            <div v-else-if="!item.answered" class="ai-ask-hint">请在下方输入框直接回复</div>
          </div>

          <!-- 最终结果 -->
          <div v-else-if="item.kind === 'result'" class="ai-bubble is-result">
            <template v-for="(part, index) in splitMentionParts(item.content)" :key="index">
              <button
                v-if="part.type === 'mention'"
                type="button"
                class="ai-msg-mention"
                @click="selectMentionNode(part.nodeId)"
              >
                {{ part.text }}
              </button>
              <span v-else>{{ part.text }}</span>
            </template>
          </div>

          <div v-else-if="item.kind === 'error'" class="ai-bubble is-error">
            {{ item.content }}
          </div>

          <div v-else-if="item.kind === 'status'" class="ai-status">
            {{ item.content }}
          </div>
        </div>
      </div>

      <div
        class="ai-composer"
        :class="{ 'is-compact': !showMessages && !isWindowMode }"
      >
        <el-mention
          v-model="aiAssistant.composerText"
          class="ai-input"
          type="textarea"
          :rows="2"
          :options="mentionOptions"
          whole
          :disabled="(sending && !waitingAsk) || lockedByOther"
          :placeholder="
            lockedByOther
              ? '其它窗口执行中，暂不可发送'
              : waitingAsk
                ? '回复 AI 的问题，或点击上方选项'
                : '输入需求，Enter 发送'
          "
          @keydown="onComposerKeydown"
          @click="onComposerClick"
        />
        <div class="ai-toolbar">
          <el-dropdown
            trigger="click"
            placement="top-start"
            :disabled="
              !settings.aiModels.length ||
              (sending && !waitingAsk) ||
              lockedByOther
            "
            @command="onModelSelect"
          >
            <button
              type="button"
              class="model-trigger"
              :disabled="
                !settings.aiModels.length ||
                (sending && !waitingAsk) ||
                lockedByOther
              "
            >
              <span class="model-name">{{ activeModelLabel }}</span>
              <el-icon :size="12" class="model-chevron"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="model in settings.aiModels"
                  :key="model.id"
                  :command="model.id"
                  :class="{ 'is-active-model': model.id === settings.activeAiModelId }"
                >
                  {{ model.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <button
            type="button"
            class="send-btn"
            :disabled="!canSend"
            aria-label="发送"
            @click="sendMessage"
          >
            <el-icon :size="16"><Promotion /></el-icon>
          </button>
        </div>
      </div>

      <div
        v-if="!isWindowMode"
        class="ai-resize-handle"
        title="拖拽调整高度"
        @pointerdown="onResizeStart"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.ai-assistant-panel {
  position: fixed;
  z-index: 5200;
  display: flex;
  flex-direction: column;
  min-height: 100px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 14px;
  box-shadow:
    0 8px 28px rgba(15, 23, 42, 0.12),
    0 2px 8px rgba(15, 23, 42, 0.06);
  overflow: hidden;
  user-select: none;
}

.ai-assistant-panel.is-window {
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.ai-assistant-panel.is-dragging,
.ai-assistant-panel.is-resizing {
  cursor: grabbing;
}

.ai-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid #f0f2f5;
  background: #fafbfc;
}

.ai-header.is-draggable {
  cursor: grab;
}

.ai-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.ai-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.ai-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #909399;
  cursor: pointer;
}

.ai-icon-btn:hover {
  background: #eef1f6;
  color: #606266;
}

.ai-history-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 4px 6px;
  border-bottom: 1px solid #f0f2f5;
  background: #fff;
}

.ai-history-new {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  background: #fafbfc;
  color: #909399;
  cursor: pointer;
}

.ai-history-new:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
}

.ai-history-new:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ai-history-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}

.ai-history-tab {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 110px;
  height: 22px;
  margin: 0;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #f2f3f5;
  color: #606266;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.ai-history-tab:hover:not(:disabled) {
  background: #e9edf5;
}

.ai-history-tab.is-active {
  border-color: #c6e2ff;
  background: #ecf5ff;
  color: #409eff;
}

.ai-history-tab.is-running {
  box-shadow: inset 0 -2px 0 #409eff;
}

.ai-history-tab:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.ai-history-tab-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-history-tab-close {
  flex-shrink: 0;
  width: 12px;
  color: #c0c4cc;
  font-size: 12px;
  line-height: 1;
}

.ai-history-tab-close:hover {
  color: #f56c6c;
}

.ai-lock-banner {
  flex-shrink: 0;
  padding: 4px 10px;
  background: #fdf6ec;
  color: #e6a23c;
  font-size: 11px;
  line-height: 1.4;
}

.ai-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 12px 8px;
  user-select: text;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-empty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: #c0c4cc;
}

.ai-item {
  max-width: 100%;
}

.ai-bubble {
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-bubble.is-user {
  margin-left: auto;
  max-width: 92%;
  background: #ecf5ff;
  color: #303133;
}

.ai-bubble.is-result {
  background: #f5f7fa;
  color: #303133;
}

.ai-bubble.is-error {
  background: #fef0f0;
  color: #f56c6c;
}

.ai-thinking-card {
  padding: 8px 10px;
  border-radius: 10px;
  background: #fafafa;
  border: 1px solid #f0f2f5;
}

.ai-thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #909399;
  font-size: 12px;
  cursor: pointer;
}

.ai-thinking-body {
  margin: 6px 0 0;
  padding: 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.03);
  color: #909399;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
  font-family: inherit;
}

.ai-tool-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #ebeef5;
  font-size: 12px;
  color: #606266;
}

.ai-tool-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-tool-icon.is-loading {
  color: #409eff;
  animation: ai-spin 0.9s linear infinite;
}

.ai-tool-icon.is-done {
  color: #67c23a;
}

.ai-tool-icon.is-error {
  color: #f56c6c;
}

@keyframes ai-spin {
  to {
    transform: rotate(360deg);
  }
}

.ai-status {
  font-size: 12px;
  color: #e6a23c;
  padding: 2px 4px;
}

.ai-ask-card {
  padding: 8px 10px;
  border-radius: 10px;
  background: #fff7e6;
  border: 1px solid #ffe1a8;
}

.ai-ask-question {
  margin-bottom: 8px;
  color: #303133;
  font-size: 13px;
  white-space: pre-wrap;
}

.ai-ask-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-ask-option {
  margin: 0;
  padding: 7px 10px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
  color: #303133;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ai-ask-option:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}

.ai-ask-option.is-selected {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}

.ai-ask-option:disabled {
  cursor: default;
  opacity: 0.85;
}

.ai-ask-hint {
  font-size: 12px;
  color: #909399;
}

.ai-msg-mention {
  display: inline;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: #409eff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.ai-composer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 8px 10px;
  padding: 8px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  background: #fff;
}

.ai-composer:not(.is-compact) {
  flex: 0 0 auto;
}

.ai-input {
  flex: 1;
  width: 100%;
  min-height: 0;
}

.ai-input :deep(.el-textarea__inner) {
  min-height: 40px !important;
  max-height: 120px;
  padding: 0;
  border: none;
  box-shadow: none;
  background: transparent;
  font-size: 13px;
  line-height: 1.45;
  color: #303133;
  resize: none;
  user-select: text;
}

.ai-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.model-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 170px;
  margin: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 999px;
  background: #f2f3f5;
  color: #606266;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
}

.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: #3a3a3c;
  color: #fff;
  cursor: pointer;
}

.send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.ai-resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 8px;
  cursor: ns-resize;
}

.ai-resize-handle::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: 28px;
  height: 3px;
  margin-left: -14px;
  border-radius: 999px;
  background: #dcdfe6;
}

:deep(.is-active-model) {
  color: #409eff;
  font-weight: 600;
}
</style>
