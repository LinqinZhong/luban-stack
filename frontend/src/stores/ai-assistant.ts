import { create } from 'zustand'
import type { CanvasPreviewCommand } from '../services/canvas-preview-bridge'
import type {
  WorkspaceNavigateCommand,
  WorkspaceUiSnapshot,
} from '../services/workspace-nav'

export type AiMentionOption = {
  /** 插入到文本中 @ 后的完整地址：页面:home/0:LinearLayout/1:Button */
  value: string
  /** 下拉展示名（同 value） */
  label: string
  nodeId: string
  resourceScope: 'page' | 'component'
  resourceId: string
}

export type AiActiveResource = {
  scope: 'page' | 'component'
  id: string
} | null

export type AiPendingSelect = {
  scope: 'page' | 'component'
  resourceId: string
  nodeId: string
}

export type AiPendingNavigate = {
  command: WorkspaceNavigateCommand
  requestId: string
}

export type AiPendingCanvasPreview = {
  command: CanvasPreviewCommand
  requestId: string
}

const MENTION_RE = /@([^\s@]+)/g

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 生成提及地址：页面:home/0:LinearLayout/1:Button */
export function buildAiMentionAddress(options: {
  scope: 'page' | 'component'
  resourceId: string
  nodeId: string
}): string {
  const kind = options.scope === 'page' ? '页面' : '组件'
  return `${kind}:${options.resourceId}/${options.nodeId}`
}

type AiAssistantState = {
  panelOpen: boolean
  composerText: string
  mentionOptions: AiMentionOption[]
  pendingSelect: AiPendingSelect | null
  pendingNavigate: AiPendingNavigate | null
  pendingCanvasPreview: AiPendingCanvasPreview | null
  uiSnapshot: WorkspaceUiSnapshot | null
  pendingUiQueryId: string | null
  activeResource: AiActiveResource
  resourceEpoch: number
  projectBusyByAi: boolean
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setProjectBusyByAi: (busy: boolean) => void
  setActiveResource: (next: AiActiveResource) => void
  bumpResourceEpoch: () => void
  setUiSnapshot: (snapshot: WorkspaceUiSnapshot | null) => void
  requestNavigate: (command: WorkspaceNavigateCommand, requestId: string) => void
  clearPendingNavigate: () => void
  requestCanvasPreview: (
    command: CanvasPreviewCommand,
    requestId: string,
  ) => void
  clearPendingCanvasPreview: () => void
  requestUiQuery: (requestId: string) => void
  clearPendingUiQuery: () => void
  setComposerText: (text: string) => void
  addWidgetMention: (input: {
    nodeId: string
    resourceScope: 'page' | 'component'
    resourceId: string
  }) => void
  resolveMentionAt: (text: string, caret: number) => AiMentionOption | null
  resolveMentionNodeId: (text: string, caret: number) => string | null
  requestSelectNode: (nodeId: string) => void
  requestSelectMention: (mention: AiMentionOption) => void
  clearPendingSelect: () => void
  clearComposer: () => void
  mentionsInText: (text: string) => AiMentionOption[]
}

export const useAiAssistantStore = create<AiAssistantState>((set, get) => ({
  panelOpen: false,
  composerText: '',
  mentionOptions: [],
  pendingSelect: null,
  pendingNavigate: null,
  pendingCanvasPreview: null,
  uiSnapshot: null,
  pendingUiQueryId: null,
  activeResource: null,
  resourceEpoch: 0,
  projectBusyByAi: false,

  setPanelOpen(open) {
    if (!open && get().projectBusyByAi) return
    if (get().panelOpen === open) return
    set({ panelOpen: open })
  },

  togglePanel() {
    const { panelOpen, projectBusyByAi } = get()
    if (panelOpen && projectBusyByAi) return
    set({ panelOpen: !panelOpen })
  },

  setProjectBusyByAi(busy) {
    set({ projectBusyByAi: busy, ...(busy ? { panelOpen: true } : {}) })
  },

  setActiveResource(next) {
    set({ activeResource: next })
  },

  bumpResourceEpoch() {
    set({ resourceEpoch: get().resourceEpoch + 1 })
  },

  setUiSnapshot(snapshot) {
    set({ uiSnapshot: snapshot })
  },

  requestNavigate(command, requestId) {
    set({ pendingNavigate: { command, requestId } })
  },

  clearPendingNavigate() {
    set({ pendingNavigate: null })
  },

  requestCanvasPreview(command, requestId) {
    set({ pendingCanvasPreview: { command, requestId } })
  },

  clearPendingCanvasPreview() {
    set({ pendingCanvasPreview: null })
  },

  requestUiQuery(requestId) {
    set({ pendingUiQueryId: requestId })
  },

  clearPendingUiQuery() {
    set({ pendingUiQueryId: null })
  },

  setComposerText(text) {
    set({ composerText: text })
  },

  addWidgetMention(input) {
    const nodeId = input.nodeId.trim()
    const resourceId = input.resourceId.trim()
    if (!nodeId || !resourceId) return

    const value = buildAiMentionAddress({
      scope: input.resourceScope,
      resourceId,
      nodeId,
    })
    const mentionOptions = [...get().mentionOptions]
    const existing = mentionOptions.find((item) => item.nodeId === nodeId)
    if (existing) {
      existing.value = value
      existing.label = value
      existing.resourceScope = input.resourceScope
      existing.resourceId = resourceId
    } else {
      mentionOptions.push({
        value,
        label: value,
        nodeId,
        resourceScope: input.resourceScope,
        resourceId,
      })
    }

    const text = get().composerText
    const needsSpace = text.length > 0 && !/\s$/.test(text)
    set({
      mentionOptions,
      composerText: `${text}${needsSpace ? ' ' : ''}@${value} `,
      panelOpen: true,
    })
  },

  resolveMentionAt(text, caret) {
    MENTION_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MENTION_RE.exec(text))) {
      const start = match.index
      const end = start + match[0].length
      if (caret < start || caret > end) continue

      const value = match[1]
      const before = text.slice(0, start)
      const occRe = new RegExp(`@${escapeRegExp(value)}(?=[\\s@]|$)`, 'g')
      let occurrence = 0
      while (occRe.exec(before)) occurrence += 1

      const candidates = get().mentionOptions.filter((item) => item.value === value)
      if (!candidates.length) return null
      return candidates[Math.min(occurrence, candidates.length - 1)] ?? null
    }
    return null
  },

  resolveMentionNodeId(text, caret) {
    return get().resolveMentionAt(text, caret)?.nodeId ?? null
  },

  requestSelectNode(nodeId) {
    const hit =
      get().mentionOptions.find((item) => item.nodeId === nodeId) ?? null
    if (hit) {
      set({
        pendingSelect: {
          scope: hit.resourceScope,
          resourceId: hit.resourceId,
          nodeId: hit.nodeId,
        },
      })
      return
    }
    const active = get().activeResource
    if (!active) {
      set({ pendingSelect: null })
      return
    }
    set({
      pendingSelect: {
        scope: active.scope,
        resourceId: active.id,
        nodeId: nodeId.trim(),
      },
    })
  },

  requestSelectMention(mention) {
    set({
      pendingSelect: {
        scope: mention.resourceScope,
        resourceId: mention.resourceId,
        nodeId: mention.nodeId,
      },
    })
  },

  clearPendingSelect() {
    set({ pendingSelect: null })
  },

  clearComposer() {
    set({ composerText: '' })
  },

  mentionsInText(text) {
    const found: AiMentionOption[] = []
    const seen = new Set<string>()
    MENTION_RE.lastIndex = 0
    let match: RegExpExecArray | null
    const occurrenceByValue = new Map<string, number>()
    while ((match = MENTION_RE.exec(text))) {
      const value = match[1]
      const occ = occurrenceByValue.get(value) ?? 0
      occurrenceByValue.set(value, occ + 1)
      const candidates = get().mentionOptions.filter((item) => item.value === value)
      const hit = candidates[Math.min(occ, Math.max(0, candidates.length - 1))]
      if (hit && !seen.has(`${hit.resourceScope}:${hit.resourceId}:${hit.nodeId}`)) {
        seen.add(`${hit.resourceScope}:${hit.resourceId}:${hit.nodeId}`)
        found.push(hit)
      }
    }
    return found
  },
}))
