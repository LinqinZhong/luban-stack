import { defineStore } from 'pinia'
import { ref } from 'vue'

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

/**
 * AI 助手浮窗与对话上下文（提及节点等）。
 */
export const useAiAssistantStore = defineStore('aiAssistant', () => {
  const panelOpen = ref(false)
  const composerText = ref('')
  const mentionOptions = ref<AiMentionOption[]>([])
  const pendingSelect = ref<AiPendingSelect | null>(null)
  const activeResource = ref<AiActiveResource>(null)
  /** 资源被 AI 改写后递增，工作区监听并刷新 */
  const resourceEpoch = ref(0)

  function setPanelOpen(open: boolean) {
    panelOpen.value = open
  }

  function togglePanel() {
    panelOpen.value = !panelOpen.value
  }

  function setActiveResource(next: AiActiveResource) {
    activeResource.value = next
  }

  function bumpResourceEpoch() {
    resourceEpoch.value += 1
  }

  function addWidgetMention(input: {
    nodeId: string
    resourceScope: 'page' | 'component'
    resourceId: string
  }) {
    const nodeId = input.nodeId.trim()
    const resourceId = input.resourceId.trim()
    if (!nodeId || !resourceId) return

    const value = buildAiMentionAddress({
      scope: input.resourceScope,
      resourceId,
      nodeId,
    })
    const existing = mentionOptions.value.find((item) => item.nodeId === nodeId)
    if (existing) {
      existing.value = value
      existing.label = value
      existing.resourceScope = input.resourceScope
      existing.resourceId = resourceId
    } else {
      mentionOptions.value.push({
        value,
        label: value,
        nodeId,
        resourceScope: input.resourceScope,
        resourceId,
      })
    }

    const text = composerText.value
    const needsSpace = text.length > 0 && !/\s$/.test(text)
    composerText.value = `${text}${needsSpace ? ' ' : ''}@${value} `
    panelOpen.value = true
  }

  function resolveMentionAt(
    text: string,
    caret: number,
  ): AiMentionOption | null {
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

      const candidates = mentionOptions.value.filter((item) => item.value === value)
      if (!candidates.length) return null
      return candidates[Math.min(occurrence, candidates.length - 1)] ?? null
    }
    return null
  }

  function resolveMentionNodeId(text: string, caret: number): string | null {
    return resolveMentionAt(text, caret)?.nodeId ?? null
  }

  function requestSelectNode(nodeId: string) {
    const hit =
      mentionOptions.value.find((item) => item.nodeId === nodeId) ?? null
    if (hit) {
      pendingSelect.value = {
        scope: hit.resourceScope,
        resourceId: hit.resourceId,
        nodeId: hit.nodeId,
      }
      return
    }
    const active = activeResource.value
    if (!active) {
      pendingSelect.value = null
      return
    }
    pendingSelect.value = {
      scope: active.scope,
      resourceId: active.id,
      nodeId: nodeId.trim(),
    }
  }

  function requestSelectMention(mention: AiMentionOption) {
    pendingSelect.value = {
      scope: mention.resourceScope,
      resourceId: mention.resourceId,
      nodeId: mention.nodeId,
    }
  }

  function clearPendingSelect() {
    pendingSelect.value = null
  }

  function clearComposer() {
    composerText.value = ''
  }

  function mentionsInText(text: string): AiMentionOption[] {
    const found: AiMentionOption[] = []
    const seen = new Set<string>()
    MENTION_RE.lastIndex = 0
    let match: RegExpExecArray | null
    let occurrenceByValue = new Map<string, number>()
    while ((match = MENTION_RE.exec(text))) {
      const value = match[1]
      const occ = occurrenceByValue.get(value) ?? 0
      occurrenceByValue.set(value, occ + 1)
      const candidates = mentionOptions.value.filter((item) => item.value === value)
      const hit = candidates[Math.min(occ, Math.max(0, candidates.length - 1))]
      if (hit && !seen.has(`${hit.resourceScope}:${hit.resourceId}:${hit.nodeId}`)) {
        seen.add(`${hit.resourceScope}:${hit.resourceId}:${hit.nodeId}`)
        found.push(hit)
      }
    }
    return found
  }

  return {
    panelOpen,
    composerText,
    mentionOptions,
    pendingSelect,
    activeResource,
    resourceEpoch,
    setPanelOpen,
    togglePanel,
    setActiveResource,
    bumpResourceEpoch,
    addWidgetMention,
    resolveMentionAt,
    resolveMentionNodeId,
    requestSelectNode,
    requestSelectMention,
    clearPendingSelect,
    clearComposer,
    mentionsInText,
  }
})
