import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Dropdown, Mentions } from 'antd'
import {
  ArrowDownOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  LoadingOutlined,
  PlusOutlined,
  SendOutlined,
  WarningFilled,
} from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import { useWorkspaceSettingsStore } from '../../stores/workspace-settings'
import { useAiAssistantStore } from '../../stores/ai-assistant'
import { useProjectStore } from '../../stores/project'
import { agentDidMutateFromTool, runAiAgent, type AiAgentPriorMessage } from '../../services/ai-agent'
import { runCursorAgent } from '../../services/ai-cursor-agent'
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
import './AiAssistantPanel.css'

const PANEL_WIDTH = 300
const MIN_HEIGHT = 260
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

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; nodeId: string }

export default function AiAssistantPanel({
  open,
  onOpenChange,
  mode = 'panel',
  initialSessionId = '',
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  mode?: 'panel' | 'window'
  initialSessionId?: string
}) {
  const settings = useWorkspaceSettingsStore()
  const aiAssistant = useAiAssistantStore()
  const projectStore = useProjectStore()
  const panelRef = useRef<HTMLElement | null>(null)
  const messagesRef = useRef<HTMLElement | null>(null)

  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const timelineRef = useRef<TimelineItem[]>([])
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [waitingAsk, setWaitingAsk] = useState(false)
  const [historyLogs, setHistoryLogs] = useState<AiAssistantLogSummary[]>([])
  const [activeTabId, setActiveTabId] = useState(DRAFT_TAB_ID)
  const activeTabIdRef = useRef(DRAFT_TAB_ID)
  const [remoteLocked, setRemoteLocked] = useState(false)
  const remoteLockedRef = useRef(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const windowId = getAiAssistantWindowId()
  const abortControllerRef = useRef<AbortController | null>(null)
  const askResolverRef = useRef<((answer: string) => void) | null>(null)
  const sessionMutatedRef = useRef(false)
  const thinkingSeqRef = useRef(0)
  const activeThinkingIdRef = useRef<string | null>(null)
  const activeAskIdRef = useRef<string | null>(null)
  const needNewThinkingRef = useRef(true)
  const activeLogIdRef = useRef<string | null>(null)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [left, setLeft] = useState(0)
  const [top, setTop] = useState(0)
  const [height, setHeight] = useState(280)
  const leftRef = useRef(0)
  const topRef = useRef(0)
  const heightRef = useRef(280)
  const hasPlacedRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(false)
  const dragOffsetXRef = useRef(0)
  const dragOffsetYRef = useRef(0)
  const resizeStartYRef = useRef(0)
  const resizeStartHeightRef = useRef(0)
  const stickToBottomRef = useRef(true)

  function syncTimeline(next: TimelineItem[]) {
    timelineRef.current = next
    setTimeline(next)
  }

  function setSendingBoth(v: boolean) {
    sendingRef.current = v
    setSending(v)
  }

  function setRemoteLockedBoth(v: boolean) {
    remoteLockedRef.current = v
    setRemoteLocked(v)
  }

  function setActiveTabIdBoth(v: string) {
    activeTabIdRef.current = v
    setActiveTabId(v)
  }

  function setLeftBoth(v: number) {
    leftRef.current = v
    setLeft(v)
  }
  function setTopBoth(v: number) {
    topRef.current = v
    setTop(v)
  }
  function setHeightBoth(v: number) {
    heightRef.current = v
    setHeight(v)
  }

  const isWindowMode = mode === 'window'
  const lockedByOther = remoteLocked && !sending
  const draftTitle = useMemo(() => {
    const firstUser = timeline.find((item) => item.kind === 'user')
    if (!firstUser || firstUser.kind !== 'user') return '新对话'
    const text = firstUser.content.trim()
    return text ? text.slice(0, 24) : '新对话'
  }, [timeline])

  const historyTabs = useMemo(() => {
    const tabs: Array<{ id: string; title: string; status?: AiAssistantLogStatus }> = []
    const activeLogId = activeLogIdRef.current
    if (activeLogId && activeTabId === activeLogId) {
      const hit = historyLogs.find((item) => item.id === activeLogId)
      tabs.push({
        id: activeLogId,
        title: hit?.title || draftTitle,
        status: hit?.status,
      })
    } else {
      tabs.push({ id: DRAFT_TAB_ID, title: draftTitle })
    }
    for (const log of historyLogs) {
      if (tabs.some((tab) => tab.id === log.id)) continue
      tabs.push({
        id: log.id,
        title: log.title || '未命名',
        status: log.status,
      })
    }
    return tabs
  }, [historyLogs, activeTabId, draftTitle])

  const mentionOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ label: string; value: string }> = []
    for (const item of aiAssistant.mentionOptions) {
      if (seen.has(item.value)) continue
      seen.add(item.value)
      out.push({ label: item.label, value: item.value })
    }
    return out
  }, [aiAssistant.mentionOptions])

  function splitMentionParts(content: string): MessagePart[] {
    const parts: MessagePart[] = []
    const re = /@([^\s@]+)/g
    let last = 0
    let match: RegExpExecArray | null
    const occurrenceByValue = new Map<string, number>()
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

  function onComposerClick(event: React.MouseEvent) {
    const target = event.target
    const textarea =
      target instanceof HTMLTextAreaElement
        ? target
        : target instanceof Element
          ? target.closest('textarea')
          : null
    if (!(textarea instanceof HTMLTextAreaElement)) return
    queueMicrotask(() => {
      const caret = textarea.selectionStart ?? 0
      const hit = aiAssistant.resolveMentionAt(aiAssistant.composerText, caret)
      if (hit) aiAssistant.requestSelectMention(hit)
    })
  }

  const activeModel = settings.activeModel
  const activeAgent = settings.activeAgent
  const activeModelLabel = activeAgent
    ? `智能体 · ${activeAgent.name}`
    : activeModel?.name || '选择模型/智能体'
  const hasProvider = Boolean(activeModel || activeAgent)
  const providerOptions = useMemo(() => {
    const models = settings.aiModels.map((m) => ({
      key: `model:${m.id}`,
      label: `模型 · ${m.name}`,
      type: 'model' as const,
      id: m.id,
    }))
    const agents = settings.aiAgents.map((a) => ({
      key: `agent:${a.id}`,
      label: `智能体 · ${a.name}`,
      type: 'agent' as const,
      id: a.id,
    }))
    return [...models, ...agents]
  }, [settings.aiModels, settings.aiAgents])
  const showMessages = height >= 180
  const canSend =
    Boolean(aiAssistant.composerText.trim()) &&
    hasProvider &&
    (!sending || waitingAsk) &&
    !lockedByOther

  function setAskResolver(resolve: ((answer: string) => void) | null) {
    askResolverRef.current = resolve
    setWaitingAsk(Boolean(resolve))
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
      setRemoteLockedBoth(false)
      if (!sendingRef.current) aiAssistant.setProjectBusyByAi(false)
      return
    }
    try {
      const state = await refreshExecutionLock(projectStore.path)
      setRemoteLockedBoth(state.locked && !state.heldByMe)
      if (state.locked) {
        aiAssistant.setProjectBusyByAi(true)
      } else if (!sendingRef.current) {
        aiAssistant.setProjectBusyByAi(false)
      }
    } catch {
      // ignore
    }
  }

  async function refreshHistoryList() {
    if (!projectStore.path) {
      setHistoryLogs([])
      return
    }
    setLoadingHistory(true)
    try {
      const { logs } = await listAiAssistantLogs(projectStore.path)
      setHistoryLogs(logs)
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false)
    }
  }

  function schedulePersist(status: AiAssistantLogStatus) {
    if (!projectStore.path || !activeLogIdRef.current) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      void persistCurrentLog(status)
    }, 280)
  }

  async function persistCurrentLog(status: AiAssistantLogStatus) {
    if (!projectStore.path || !activeLogIdRef.current) return
    const title = draftTitle === '新对话' ? '未命名' : draftTitle
    try {
      await saveAiAssistantLog(projectStore.path, {
        id: activeLogIdRef.current,
        title,
        status,
        timeline: timelineRef.current,
        modelId: activeAgent?.id ?? activeModel?.id,
        modelName: activeAgent
          ? `智能体 · ${activeAgent.name}`
          : activeModel?.name,
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
    if (sendingRef.current) {
      ElMessage.warning('请等待当前任务结束')
      return
    }
    syncTimeline([])
    activeLogIdRef.current = null
    setActiveTabIdBoth(DRAFT_TAB_ID)
    thinkingSeqRef.current = 0
    activeThinkingIdRef.current = null
    activeAskIdRef.current = null
    needNewThinkingRef.current = true
    sessionMutatedRef.current = false
    setAskResolver(null)
  }

  async function selectHistoryTab(tabId: string) {
    if (tabId === activeTabIdRef.current) return
    if (sendingRef.current) {
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
      syncTimeline(log.timeline.filter(isTimelineItem))
      activeLogIdRef.current = log.id
      setActiveTabIdBoth(log.id)
      thinkingSeqRef.current = timelineRef.current.filter((item) => item.kind === 'thinking').length
      activeThinkingIdRef.current = null
      activeAskIdRef.current = null
      needNewThinkingRef.current = true
      sessionMutatedRef.current = false
      setAskResolver(null)
      stickToBottomRef.current = true
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

  async function removeHistoryTab(tabId: string, event: React.MouseEvent) {
    event.stopPropagation()
    if (tabId === DRAFT_TAB_ID) return
    if (sendingRef.current && activeLogIdRef.current === tabId) {
      ElMessage.warning('执行中无法删除')
      return
    }
    if (!projectStore.path) return
    try {
      await deleteAiAssistantLog(projectStore.path, tabId)
      if (activeTabIdRef.current === tabId) resetConversation()
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
    const index = timelineRef.current.findIndex((item) => item.id === id)
    if (index < 0) return
    const next = [...timelineRef.current]
    next[index] = { ...next[index], ...patch } as TimelineItem
    syncTimeline(next)
  }

  function notifyResourcesChanged() {
    aiAssistant.bumpResourceEpoch()
    const projectPath = projectStore.path?.trim()
    if (projectPath) {
      publishAiAssistantEvent({
        type: 'resources-changed',
        projectPath,
      })
    }
  }

  function sealActiveThinking() {
    if (!activeThinkingIdRef.current) return
    patchItem(activeThinkingIdRef.current, { streaming: false })
    activeThinkingIdRef.current = null
    needNewThinkingRef.current = true
  }

  async function flushUi() {
    scrollMessagesToBottomIfNeeded()
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
  }

  function maxHeight(): number {
    return Math.max(MIN_HEIGHT, window.innerHeight - 16)
  }

  function clampPosition() {
    const maxLeft = Math.max(8, window.innerWidth - PANEL_WIDTH - 8)
    const maxTop = Math.max(8, window.innerHeight - heightRef.current - 8)
    setLeftBoth(Math.min(Math.max(8, leftRef.current), maxLeft))
    setTopBoth(Math.min(Math.max(8, topRef.current), maxTop))
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
      JSON.stringify({ left: leftRef.current, top: topRef.current, height: heightRef.current }),
    )
  }

  function placeDefault() {
    setHeightBoth(Math.min(320, maxHeight()))
    setLeftBoth(Math.max(8, window.innerWidth - PANEL_WIDTH - 16))
    setTopBoth(72)
    clampPosition()
  }

  function restoreOrPlace() {
    const saved = loadSavedPosition()
    if (saved) {
      setLeftBoth(saved.left)
      setTopBoth(saved.top)
      setHeightBoth(saved.height)
      clampPosition()
    } else placeDefault()
    hasPlacedRef.current = true
  }

  function close() {
    if (!isWindowMode) {
      clampPosition()
      savePosition()
    }
    onOpenChange?.(false)
    if (isWindowMode) window.close()
  }

  function onModelSelect(command: string) {
    if (command.startsWith('agent:')) {
      settings.useAiAgent(command.slice('agent:'.length))
      return
    }
    if (command.startsWith('model:')) {
      settings.useAiModel(command.slice('model:'.length))
      return
    }
    settings.useAiModel(command)
  }

  function buildPriorMessagesFromTimeline(items: TimelineItem[]): AiAgentPriorMessage[] {
    const out: AiAgentPriorMessage[] = []
    const toolLabels: string[] = []

    const flushTools = () => {
      if (!toolLabels.length) return
      out.push({
        role: 'assistant',
        content: `本轮已执行工具：${toolLabels.join('、')}`,
      })
      toolLabels.length = 0
    }

    for (const item of items) {
      if (item.kind === 'user') {
        flushTools()
        const text = item.content.trim()
        if (text) out.push({ role: 'user', content: text })
        continue
      }
      if (item.kind === 'ask') {
        flushTools()
        const q = item.question.trim()
        if (q) {
          const opts =
            item.options?.length > 0 ? `\n选项：${item.options.join(' / ')}` : ''
          out.push({ role: 'assistant', content: `向用户确认：${q}${opts}` })
        }
        if (item.answered?.trim()) {
          out.push({ role: 'user', content: item.answered.trim() })
        }
        continue
      }
      if (item.kind === 'result') {
        flushTools()
        const text = item.content.trim()
        if (text) out.push({ role: 'assistant', content: text })
        continue
      }
      if (item.kind === 'error') {
        flushTools()
        const text = item.content.trim()
        if (text) out.push({ role: 'assistant', content: `（执行中断）${text}` })
        continue
      }
      if (item.kind === 'tool' && item.status === 'done') {
        const label = (item.label || item.tool || '').trim()
        if (label) toolLabels.push(label)
        continue
      }
    }
    flushTools()
    return out
  }

  function onMessagesScroll() {
    const el = messagesRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = gap <= 48
  }

  function scrollMessagesToBottomIfNeeded() {
    if (!stickToBottomRef.current) return
    queueMicrotask(() => {
      const el = messagesRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  function toggleThinking(id: string) {
    const item = timelineRef.current.find((row) => row.id === id)
    if (!item || item.kind !== 'thinking') return
    patchItem(id, { collapsed: !item.collapsed })
  }

  function resolveAsk(answer: string) {
    if (activeAskIdRef.current) {
      const item = timelineRef.current.find((row) => row.id === activeAskIdRef.current)
      if (item?.kind === 'ask' && !item.answered) {
        patchItem(activeAskIdRef.current, { answered: answer })
      }
    }
    const resolve = askResolverRef.current
    setAskResolver(null)
    activeAskIdRef.current = null
    needNewThinkingRef.current = true
    if (resolve) resolve(answer)
    void flushUi()
  }

  function onOptionClick(option: string) {
    if (!askResolverRef.current) return
    syncTimeline([
      ...timelineRef.current,
      {
        id: uid('user'),
        kind: 'user',
        content: option,
      },
    ])
    resolveAsk(option)
  }

  function ensureThinkingSlot() {
    if (!needNewThinkingRef.current && activeThinkingIdRef.current) return
    sealActiveThinking()
    thinkingSeqRef.current += 1
    const id = uid('think')
    activeThinkingIdRef.current = id
    needNewThinkingRef.current = false
    syncTimeline([
      ...timelineRef.current,
      {
        id,
        kind: 'thinking',
        index: thinkingSeqRef.current,
        content: '',
        collapsed: false,
        streaming: true,
      },
    ])
  }

  function upsertThinking(full: string) {
    ensureThinkingSlot()
    if (!activeThinkingIdRef.current) return
    patchItem(activeThinkingIdRef.current, {
      content: full,
      streaming: true,
      collapsed: false,
    })
  }

  async function sendMessage() {
    const text = aiAssistant.composerText.trim()
    if (!text) return

    if (askResolverRef.current) {
      syncTimeline([
        ...timelineRef.current,
        {
          id: uid('user'),
          kind: 'user',
          content: text,
        },
      ])
      aiAssistant.clearComposer()
      resolveAsk(text)
      return
    }

    if (sendingRef.current) return
    if (remoteLockedRef.current && !sendingRef.current) {
      ElMessage.warning('AI 助手正在其它窗口执行任务，请稍候')
      return
    }
    if (!activeModel && !activeAgent) {
      ElMessage.warning('请先在设置中添加模型或智能体，并在此选择')
      return
    }
    if (activeAgent && !activeAgent.apiKey.trim()) {
      ElMessage.warning('请先为 Cursor 智能体配置 API Key')
      return
    }
    if (!projectStore.path) {
      ElMessage.warning('请先打开项目')
      return
    }

    const lock = await tryAcquireExecutionLock(projectStore.path)
    if (!lock.ok) {
      setRemoteLockedBoth(true)
      ElMessage.warning(lock.message || 'AI 助手正在其它窗口执行任务')
      return
    }
    setRemoteLockedBoth(false)

    if (!isWindowMode && heightRef.current < 360) {
      setHeightBoth(Math.min(460, maxHeight()))
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

    const priorMessages = buildPriorMessagesFromTimeline(timelineRef.current)

    if (activeTabIdRef.current !== DRAFT_TAB_ID && activeTabIdRef.current !== activeLogIdRef.current) {
      activeLogIdRef.current = null
    }
    if (!activeLogIdRef.current || activeTabIdRef.current === DRAFT_TAB_ID) {
      activeLogIdRef.current = uid('log')
      setActiveTabIdBoth(activeLogIdRef.current)
    }

    syncTimeline([
      ...timelineRef.current,
      {
        id: uid('user'),
        kind: 'user',
        content: text,
      },
    ])
    aiAssistant.clearComposer()

    sessionMutatedRef.current = false
    thinkingSeqRef.current = 0
    activeThinkingIdRef.current = null
    activeAskIdRef.current = null
    needNewThinkingRef.current = true
    stickToBottomRef.current = true
    setSendingBoth(true)
    aiAssistant.setProjectBusyByAi(true)
    ensureThinkingSlot()
    syncTimeline([
      ...timelineRef.current,
      {
        id: 'status_live',
        kind: 'status',
        content: '正在连接模型…',
      },
    ])
    await persistCurrentLog('running')
    await flushUi()

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    let finalStatus: AiAssistantLogStatus = 'done'
    try {
      if (activeAgent?.kind === 'cursor') {
        const priorSummary = priorMessages
          .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
          .join('\n')
          .slice(0, 8000)
        await runCursorAgent({
          projectPath: projectStore.path,
          agent: activeAgent,
          userText: text,
          active: aiAssistant.activeResource,
          priorSummary,
          signal: abortControllerRef.current.signal,
          hooks: {
            onThinking: (full) => {
              upsertThinking(full)
              void flushUi()
            },
            onStatus: (statusText) => {
              if (!statusText) {
                syncTimeline(timelineRef.current.filter((item) => item.kind !== 'status'))
                void flushUi()
                return
              }
              const statusId = 'status_live'
              const existing = timelineRef.current.find((item) => item.id === statusId)
              if (existing) patchItem(statusId, { content: statusText })
              else
                syncTimeline([
                  ...timelineRef.current,
                  {
                    id: statusId,
                    kind: 'status',
                    content: statusText,
                  },
                ])
              void flushUi()
            },
            onFinish: (message) => {
              sealActiveThinking()
              setAskResolver(null)
              syncTimeline([
                ...timelineRef.current.filter((item) => item.kind !== 'status'),
                {
                  id: uid('result'),
                  kind: 'result',
                  content: message,
                },
              ])
              sessionMutatedRef.current = true
              notifyResourcesChanged()
              void flushUi()
            },
          },
        })
      } else if (activeModel) {
        await runAiAgent({
          projectPath: projectStore.path,
          model: activeModel,
          userText: text,
          active: aiAssistant.activeResource,
          mentions,
          priorMessages,
          signal: abortControllerRef.current.signal,
          hooks: {
            onThinking: (full) => {
              upsertThinking(full)
              void flushUi()
            },
            onTool: (event) => {
              sealActiveThinking()
              const existing = timelineRef.current.find(
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
                syncTimeline([
                  ...timelineRef.current,
                  {
                    id: event.id,
                    kind: 'tool',
                    tool: event.tool,
                    label: event.label,
                    status: event.status,
                    error: event.error,
                  },
                ])
              }
              if (event.status === 'done' && agentDidMutateFromTool(event.tool)) {
                sessionMutatedRef.current = true
                notifyResourcesChanged()
              }
              needNewThinkingRef.current = true
              schedulePersist('running')
              void flushUi()
            },
            onStatus: (statusText) => {
              if (!statusText) {
                syncTimeline(timelineRef.current.filter((item) => item.kind !== 'status'))
                void flushUi()
                return
              }
              const statusId = 'status_live'
              const existing = timelineRef.current.find((item) => item.id === statusId)
              if (existing) patchItem(statusId, { content: statusText })
              else
                syncTimeline([
                  ...timelineRef.current,
                  {
                    id: statusId,
                    kind: 'status',
                    content: statusText,
                  },
                ])
              void flushUi()
            },
            onAskUser: ({ question, options }) =>
              new Promise<string>((resolve) => {
                sealActiveThinking()
                const id = uid('ask')
                activeAskIdRef.current = id
                syncTimeline([
                  ...timelineRef.current.filter((item) => item.kind !== 'status'),
                  {
                    id,
                    kind: 'ask',
                    question,
                    options,
                  },
                ])
                setAskResolver(resolve)
                schedulePersist('running')
                void flushUi()
              }),
            onFinish: (message) => {
              sealActiveThinking()
              setAskResolver(null)
              syncTimeline([
                ...timelineRef.current.filter((item) => item.kind !== 'status'),
                {
                  id: uid('result'),
                  kind: 'result',
                  content: message,
                },
              ])
              void flushUi()
            },
          },
        })
      } else {
        throw new Error('未选择可用的模型或智能体')
      }
    } catch (err) {
      setAskResolver(null)
      sealActiveThinking()
      syncTimeline(timelineRef.current.filter((item) => item.kind !== 'status'))
      if (err instanceof DOMException && err.name === 'AbortError') {
        finalStatus = 'cancelled'
        syncTimeline([
          ...timelineRef.current,
          {
            id: uid('error'),
            kind: 'error',
            content: '已取消',
          },
        ])
      } else {
        finalStatus = 'error'
        const message = err instanceof Error ? err.message : 'AI 执行失败'
        syncTimeline([
          ...timelineRef.current,
          {
            id: uid('error'),
            kind: 'error',
            content: message,
          },
        ])
        ElMessage.error(message)
      }
    } finally {
      if (sessionMutatedRef.current) notifyResourcesChanged()
      setSendingBoth(false)
      if (!askResolverRef.current) setWaitingAsk(false)
      abortControllerRef.current = null
      await persistCurrentLog(finalStatus)
      if (projectStore.path) await releaseExecutionLock(projectStore.path)
      aiAssistant.setProjectBusyByAi(false)
      await refreshLockState()
      await flushUi()
    }
  }

  function onComposerKeydown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const onDragMove = useCallback((event: PointerEvent) => {
    if (!draggingRef.current) return
    setLeftBoth(event.clientX - dragOffsetXRef.current)
    setTopBoth(event.clientY - dragOffsetYRef.current)
    clampPosition()
  }, [])

  const onDragEnd = useCallback(() => {
    draggingRef.current = false
    setDragging(false)
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    clampPosition()
    savePosition()
  }, [onDragMove])

  function onDragStart(event: React.PointerEvent) {
    if (isWindowMode) return
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('button, .ant-dropdown, .el-dropdown')) return
    draggingRef.current = true
    setDragging(true)
    dragOffsetXRef.current = event.clientX - leftRef.current
    dragOffsetYRef.current = event.clientY - topRef.current
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    event.preventDefault()
  }

  const onResizeMove = useCallback((event: PointerEvent) => {
    if (!resizingRef.current) return
    setHeightBoth(
      Math.min(
        maxHeight(),
        Math.max(MIN_HEIGHT, resizeStartHeightRef.current + (event.clientY - resizeStartYRef.current)),
      ),
    )
    clampPosition()
  }, [])

  const onResizeEnd = useCallback(() => {
    resizingRef.current = false
    setResizing(false)
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', onResizeEnd)
    clampPosition()
    savePosition()
  }, [onResizeMove])

  function onResizeStart(event: React.PointerEvent) {
    if (event.button !== 0) return
    resizingRef.current = true
    setResizing(true)
    resizeStartYRef.current = event.clientY
    resizeStartHeightRef.current = heightRef.current
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeEnd)
    event.preventDefault()
    event.stopPropagation()
  }

  function onWindowResize() {
    if (isWindowMode) {
      setHeightBoth(window.innerHeight)
      return
    }
    setHeightBoth(Math.min(heightRef.current, maxHeight()))
    clampPosition()
    if (hasPlacedRef.current) savePosition()
  }

  useEffect(() => {
    if (isWindowMode) return
    if (open) {
      restoreOrPlace()
      void refreshHistoryList()
      void refreshLockState()
    } else if (hasPlacedRef.current) savePosition()
  }, [open, isWindowMode])

  useEffect(() => {
    void refreshHistoryList()
    void refreshLockState()
  }, [projectStore.path])

  useEffect(() => {
    window.addEventListener('resize', onWindowResize)
    const unbindUnload = bindExecutionLockUnload()
    const unsubBus = subscribeAiAssistantEvents((event) => {
      if (!projectStore.path || event.projectPath !== projectStore.path) return
      if (event.type === 'lock-changed') {
        setRemoteLockedBoth(event.locked && event.ownerId !== windowId)
        if (event.locked) {
          aiAssistant.setProjectBusyByAi(true)
        } else if (!sendingRef.current) {
          aiAssistant.setProjectBusyByAi(false)
        }
      } else if (event.type === 'logs-changed') {
        void refreshHistoryList()
      }
    })
    if (isWindowMode) {
      hasPlacedRef.current = true
      setLeftBoth(0)
      setTopBoth(0)
      setHeightBoth(window.innerHeight)
    } else if (open) {
      restoreOrPlace()
    }
    void refreshHistoryList()
    void refreshLockState()
    if (initialSessionId) {
      void selectHistoryTab(initialSessionId)
    }
    return () => {
      abortControllerRef.current?.abort()
      setAskResolver(null)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      if (projectStore.path && sendingRef.current) {
        void releaseExecutionLock(projectStore.path)
      }
      if (sendingRef.current) {
        aiAssistant.setProjectBusyByAi(false)
      }
      unsubBus?.()
      unbindUnload?.()
      if (hasPlacedRef.current && !isWindowMode) savePosition()
      window.removeEventListener('resize', onWindowResize)
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onDragEnd)
      window.removeEventListener('pointermove', onResizeMove)
      window.removeEventListener('pointerup', onResizeEnd)
    }
    // mount/unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!open) return null

  const panel = (
    <div
      ref={panelRef as React.RefObject<HTMLDivElement>}
      className={[
        'ai-assistant-panel',
        dragging ? 'is-dragging' : '',
        resizing ? 'is-resizing' : '',
        isWindowMode ? 'is-window' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        isWindowMode
          ? { width: '100%', height: '100%', left: 0, top: 0 }
          : {
              width: `${PANEL_WIDTH}px`,
              height: `${height}px`,
              left: `${left}px`,
              top: `${top}px`,
            }
      }
    >
      <div
        className={['ai-header', !isWindowMode ? 'is-draggable' : ''].filter(Boolean).join(' ')}
        onPointerDown={onDragStart}
      >
        <span className="ai-title">AI 助手</span>
        <div className="ai-header-actions">
          <button
            type="button"
            className="ai-icon-btn"
            aria-label="新开窗口"
            title="新开窗口"
            onClick={() => openInNewWindow()}
          >
            <CopyOutlined style={{ fontSize: 14 }} />
          </button>
          <button type="button" className="ai-icon-btn" aria-label="关闭" onClick={close}>
            <CloseOutlined style={{ fontSize: 14 }} />
          </button>
        </div>
      </div>

      <div className="ai-history-bar">
        <button
          type="button"
          className="ai-history-new"
          title="新对话"
          disabled={sending}
          onClick={resetConversation}
        >
          <PlusOutlined style={{ fontSize: 12 }} />
        </button>
        <div className="ai-history-tabs">
          {historyTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={[
                'ai-history-tab',
                tab.id === activeTabId ? 'is-active' : '',
                tab.status === 'running' ? 'is-running' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={tab.title}
              disabled={sending && tab.id !== activeTabId}
              onClick={() => void selectHistoryTab(tab.id)}
              onDoubleClick={() => {
                if (tab.id !== DRAFT_TAB_ID) openInNewWindow(tab.id)
              }}
            >
              <span className="ai-history-tab-text">{tab.title}</span>
              {tab.id !== DRAFT_TAB_ID ? (
                <span
                  className="ai-history-tab-close"
                  title="删除"
                  onClick={(e) => void removeHistoryTab(tab.id, e)}
                >
                  ×
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {lockedByOther ? <div className="ai-lock-banner">其它窗口正在执行任务，请稍候</div> : null}

      <div
        ref={messagesRef as React.RefObject<HTMLDivElement>}
        className="ai-messages"
        style={{ display: showMessages || isWindowMode ? undefined : 'none' }}
        onScroll={onMessagesScroll}
      >
        {!timeline.length ? (
          <div className="ai-empty">
            {loadingHistory ? '加载历史记录…' : '描述需求，AI 将检索并操作项目'}
          </div>
        ) : null}

        {timeline.map((item) => (
          <div key={item.id} className={`ai-item is-${item.kind}`}>
            {item.kind === 'user' ? (
              <div className="ai-bubble is-user">
                {splitMentionParts(item.content).map((part, index) =>
                  part.type === 'mention' ? (
                    <button
                      key={index}
                      type="button"
                      className="ai-msg-mention"
                      onClick={() => selectMentionNode(part.nodeId)}
                    >
                      {part.text}
                    </button>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </div>
            ) : item.kind === 'thinking' ? (
              <div className="ai-thinking-card">
                <button type="button" className="ai-thinking-toggle" onClick={() => toggleThinking(item.id)}>
                  {item.collapsed ? (
                    <ArrowRightOutlined style={{ fontSize: 12 }} />
                  ) : (
                    <ArrowDownOutlined style={{ fontSize: 12 }} />
                  )}
                  <span>{item.streaming ? `思考${item.index}中` : `思考${item.index}`}</span>
                </button>
                <pre
                  className="ai-thinking-body"
                  style={{ display: item.collapsed ? 'none' : undefined }}
                >
                  {item.content || (item.streaming ? '…' : '')}
                </pre>
              </div>
            ) : item.kind === 'tool' ? (
              <div className={`ai-tool-line is-${item.status}`}>
                <span className="ai-tool-label">{item.label}</span>
                {item.status === 'running' ? (
                  <LoadingOutlined className="ai-tool-icon is-loading" style={{ fontSize: 14 }} spin />
                ) : item.status === 'done' ? (
                  <CheckOutlined className="ai-tool-icon is-done" style={{ fontSize: 14 }} />
                ) : (
                  <WarningFilled
                    className="ai-tool-icon is-error"
                    style={{ fontSize: 14 }}
                    title={item.error || '失败'}
                  />
                )}
              </div>
            ) : item.kind === 'ask' ? (
              <div className="ai-ask-card">
                <div className="ai-ask-question">{item.question}</div>
                {item.options.length ? (
                  <div className="ai-ask-options">
                    {item.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`ai-ask-option${item.answered === option ? ' is-selected' : ''}`}
                        disabled={Boolean(item.answered) || !waitingAsk}
                        onClick={() => onOptionClick(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : !item.answered ? (
                  <div className="ai-ask-hint">请在下方输入框直接回复</div>
                ) : null}
              </div>
            ) : item.kind === 'result' ? (
              <div className="ai-bubble is-result">
                {splitMentionParts(item.content).map((part, index) =>
                  part.type === 'mention' ? (
                    <button
                      key={index}
                      type="button"
                      className="ai-msg-mention"
                      onClick={() => selectMentionNode(part.nodeId)}
                    >
                      {part.text}
                    </button>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )}
              </div>
            ) : item.kind === 'error' ? (
              <div className="ai-bubble is-error">{item.content}</div>
            ) : item.kind === 'status' ? (
              <div className="ai-status">{item.content}</div>
            ) : null}
          </div>
        ))}
      </div>

      <div
        className={`ai-composer${!showMessages && !isWindowMode ? ' is-compact' : ''}`}
      >
        <Mentions
          value={aiAssistant.composerText}
          className="ai-input"
          autoSize={{ minRows: 2, maxRows: 6 }}
          options={mentionOptions}
          disabled={(sending && !waitingAsk) || lockedByOther}
          placeholder={
            lockedByOther
              ? '其它窗口执行中，暂不可发送'
              : waitingAsk
                ? '回复 AI 的问题，或点击上方选项'
                : '输入需求，Enter 发送'
          }
          onChange={(v) => aiAssistant.setComposerText(v)}
          onKeyDown={onComposerKeydown}
          onClick={onComposerClick}
        />
        <div className="ai-toolbar">
          <Dropdown
            trigger={['click']}
            placement="topLeft"
            overlayClassName="ai-assistant-model-popper"
            disabled={
              !providerOptions.length || (sending && !waitingAsk) || lockedByOther
            }
            menu={{
              items: providerOptions.map((item) => ({
                key: item.key,
                label: item.label,
                className:
                  (item.type === 'model' &&
                    settings.activeAiProvider?.type === 'model' &&
                    settings.activeAiProvider.id === item.id) ||
                  (item.type === 'agent' &&
                    settings.activeAiProvider?.type === 'agent' &&
                    settings.activeAiProvider.id === item.id)
                    ? 'is-active-model'
                    : undefined,
              })),
              onClick: ({ key }) => onModelSelect(String(key)),
            }}
          >
            <button
              type="button"
              className="model-trigger"
              disabled={
                !providerOptions.length || (sending && !waitingAsk) || lockedByOther
              }
            >
              <span className="model-name">{activeModelLabel}</span>
              <ArrowDownOutlined className="model-chevron" style={{ fontSize: 12 }} />
            </button>
          </Dropdown>
          <button
            type="button"
            className="send-btn"
            disabled={!canSend}
            aria-label="发送"
            onClick={() => void sendMessage()}
          >
            <SendOutlined style={{ fontSize: 16 }} />
          </button>
        </div>
      </div>

      {!isWindowMode ? (
        <div className="ai-resize-handle" title="拖拽调整高度" onPointerDown={onResizeStart} />
      ) : null}
    </div>
  )

  return createPortal(panel, document.body)
}
