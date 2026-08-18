/**
 * AI 前端自测：驱动主工作区真实预览画布（非无头 session）。
 */
import {
  findLayoutNode,
  type PreviewLayoutNode,
  type PreviewSessionState,
} from './page-preview-session'
import {
  getLastCanvasPreviewSnapshot,
  requireCanvasPreviewCommand,
  type CanvasPreviewSnapshot,
} from './canvas-preview-bridge'
import { useAiAssistantStore } from '../stores/ai-assistant'

export type FrontendTestStep =
  | {
      op: 'reset'
      pageId?: string
      componentId?: string
      query?: Record<string, unknown>
    }
  | { op: 'setData'; field: string; value: unknown }
  | { op: 'click'; nodeId: string; eventKey?: string }
  | {
      op: 'runMethod'
      name: string
      args?: Record<string, unknown>
    }
  | { op: 'wait'; ms: number }
  | {
      op: 'assertData'
      field: string
      equals?: unknown
      contains?: string
    }
  | { op: 'assertVisible'; nodeId: string; visible: boolean }
  | {
      op: 'assertText'
      nodeId: string
      contains?: string
      equals?: string
    }
  | {
      op: 'assertStyle'
      nodeId: string
      background?: string
      textColor?: string
      containsBackground?: string
    }

export type FrontendTestCase = {
  name: string
  steps: FrontendTestStep[]
}

export type FrontendTestCaseResult = {
  name: string
  passed: boolean
  error?: string
  failedStepIndex?: number
  state?: PreviewSessionState
}

export type FrontendTestSuiteResult = {
  passed: boolean
  total: number
  passedCount: number
  failedCount: number
  results: FrontendTestCaseResult[]
}

function enqueueLocal(command: Parameters<typeof requireCanvasPreviewCommand>[0]['command'], requestId: string) {
  try {
    useAiAssistantStore.getState().requestCanvasPreview(command, requestId)
  } catch {
    // Pinia 未就绪时仅靠 BroadcastChannel
  }
}

async function canvasCmd(
  projectPath: string,
  command: Parameters<typeof requireCanvasPreviewCommand>[0]['command'],
  timeoutMs?: number,
): Promise<CanvasPreviewSnapshot> {
  return requireCanvasPreviewCommand({
    projectPath,
    command,
    enqueueLocal,
    timeoutMs,
  })
}

function snapshotToState(snap: CanvasPreviewSnapshot): PreviewSessionState {
  return {
    kind: snap.kind,
    id: snap.id,
    fields: snap.fields,
    toast: snap.toast,
    logs: snap.logs,
    navigatedTo: null,
    layoutRisks: snap.layoutRisks ?? [],
  }
}

function requireCachedLayout(projectPath: string): PreviewLayoutNode {
  const snap = getLastCanvasPreviewSnapshot(projectPath)
  if (!snap?.layout) {
    throw new Error('尚无画布布局快照，请先 preview_page / reset 或 getState(includeLayout)')
  }
  return snap.layout
}

function requireCachedState(projectPath: string): PreviewSessionState {
  const snap = getLastCanvasPreviewSnapshot(projectPath)
  if (!snap) {
    throw new Error('尚无画布预览快照，请先 preview_page 或 reset')
  }
  return snapshotToState(snap)
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function assertDataField(
  state: PreviewSessionState,
  step: Extract<FrontendTestStep, { op: 'assertData' }>,
): void {
  const actual = state.fields[step.field]
  if ('equals' in step && step.equals !== undefined) {
    if (stableJson(actual) !== stableJson(step.equals)) {
      throw new Error(
        `字段 ${step.field} 不符合 equals。实际：${stableJson(actual)}`,
      )
    }
  }
  if (step.contains != null && step.contains !== '') {
    const text = stableJson(actual) ?? ''
    if (!text.includes(step.contains)) {
      throw new Error(
        `字段 ${step.field} 不含「${step.contains}」。实际：${text}`,
      )
    }
  }
  if (!('equals' in step) && (step.contains == null || step.contains === '')) {
    throw new Error('assertData 需要 equals 或 contains')
  }
}

function detectCheatSetDataAssert(steps: FrontendTestStep[]): string | null {
  const planted = new Set<string>()
  for (const step of steps) {
    if (step.op === 'reset') {
      planted.clear()
      continue
    }
    if (step.op === 'setData') {
      planted.add(step.field)
      continue
    }
    if (step.op === 'click' || step.op === 'runMethod') {
      planted.clear()
      continue
    }
    if (step.op === 'assertData' && planted.has(step.field)) {
      return `禁止用测试步骤 setData('${step.field}') 后直接 assertData 同一字段（未经过 click/runMethod）。请触发真实事件/方法再断言`
    }
  }
  return null
}

function normalizeColor(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function assertNodeStyle(
  projectPath: string,
  step: {
    nodeId: string
    background?: string
    textColor?: string
    containsBackground?: string
  },
): void {
  const layout = requireCachedLayout(projectPath)
  const node = findLayoutNode(layout, step.nodeId)
  if (!node) throw new Error(`未找到节点：${step.nodeId}`)
  const bg = normalizeColor(node.backgroundColor)
  const fg = normalizeColor(node.textColor)
  if (step.background != null && step.background !== '') {
    if (bg !== normalizeColor(step.background)) {
      throw new Error(
        `节点 ${step.nodeId} background 期望「${step.background}」，实际「${node.backgroundColor ?? ''}」`,
      )
    }
  }
  if (step.containsBackground != null && step.containsBackground !== '') {
    if (!bg.includes(normalizeColor(step.containsBackground))) {
      throw new Error(
        `节点 ${step.nodeId} background 不含「${step.containsBackground}」，实际「${node.backgroundColor ?? ''}」`,
      )
    }
  }
  if (step.textColor != null && step.textColor !== '') {
    if (fg !== normalizeColor(step.textColor)) {
      throw new Error(
        `节点 ${step.nodeId} textColor 期望「${step.textColor}」，实际「${node.textColor ?? ''}」`,
      )
    }
  }
  if (
    !(step.background != null && step.background !== '') &&
    !(step.containsBackground != null && step.containsBackground !== '') &&
    !(step.textColor != null && step.textColor !== '')
  ) {
    throw new Error('assertStyle 需要 background / containsBackground / textColor')
  }
}

async function runStep(
  projectPath: string,
  step: FrontendTestStep,
): Promise<void> {
  switch (step.op) {
    case 'reset': {
      if (step.pageId?.trim()) {
        await canvasCmd(projectPath, {
          op: 'open',
          scope: 'page',
          id: step.pageId.trim(),
          query: step.query,
        })
      } else if (step.componentId?.trim()) {
        await canvasCmd(projectPath, {
          op: 'open',
          scope: 'component',
          id: step.componentId.trim(),
        })
      } else {
        throw new Error('reset 需要 pageId 或 componentId')
      }
      return
    }
    case 'setData': {
      await canvasCmd(projectPath, {
        op: 'setData',
        field: step.field,
        value: step.value,
      })
      return
    }
    case 'click': {
      await canvasCmd(projectPath, {
        op: 'click',
        nodeId: step.nodeId,
        eventKey: step.eventKey,
      })
      return
    }
    case 'runMethod': {
      await canvasCmd(projectPath, {
        op: 'runMethod',
        name: step.name,
        args: step.args,
      })
      return
    }
    case 'wait': {
      const ms = Math.min(Math.max(0, Number(step.ms) || 0), 8000)
      await canvasCmd(
        projectPath,
        { op: 'wait', ms },
        Math.max(10_000, ms + 2000),
      )
      return
    }
    case 'assertData': {
      // 刷新快照再断言
      await canvasCmd(projectPath, { op: 'getState', includeLayout: false })
      assertDataField(requireCachedState(projectPath), step)
      return
    }
    case 'assertVisible': {
      await canvasCmd(projectPath, { op: 'getState', includeLayout: true })
      const layout = requireCachedLayout(projectPath)
      const node = findLayoutNode(layout, step.nodeId)
      if (!node) throw new Error(`未找到节点：${step.nodeId}`)
      if (node.visible !== step.visible) {
        throw new Error(
          `节点 ${step.nodeId} visible 期望 ${step.visible}，实际 ${node.visible}`,
        )
      }
      return
    }
    case 'assertText': {
      await canvasCmd(projectPath, { op: 'getState', includeLayout: true })
      const layout = requireCachedLayout(projectPath)
      const node = findLayoutNode(layout, step.nodeId)
      if (!node) throw new Error(`未找到节点：${step.nodeId}`)
      const text = node.text ?? ''
      if (step.equals != null && text !== step.equals) {
        throw new Error(
          `节点 ${step.nodeId} 文案期望「${step.equals}」，实际「${text}」`,
        )
      }
      if (
        step.contains != null &&
        step.contains !== '' &&
        !text.includes(step.contains)
      ) {
        throw new Error(
          `节点 ${step.nodeId} 文案不含「${step.contains}」，实际「${text}」`,
        )
      }
      if (
        step.equals == null &&
        (step.contains == null || step.contains === '')
      ) {
        throw new Error('assertText 需要 equals 或 contains')
      }
      return
    }
    case 'assertStyle': {
      await canvasCmd(projectPath, { op: 'getState', includeLayout: true })
      assertNodeStyle(projectPath, step)
      return
    }
    default: {
      const _exhaustive: never = step
      throw new Error(`未知步骤：${JSON.stringify(_exhaustive)}`)
    }
  }
}

export async function runFrontendTestCase(options: {
  projectPath: string
  testCase: FrontendTestCase
  defaultPageId?: string
  defaultComponentId?: string
}): Promise<FrontendTestCaseResult> {
  const { projectPath, testCase } = options
  const name = testCase.name.trim() || 'unnamed'
  const steps = Array.isArray(testCase.steps) ? testCase.steps : []
  if (!steps.length) {
    return { name, passed: false, error: 'steps 不能为空' }
  }

  const hasReset = steps.some((s) => s.op === 'reset')
  const cheat = detectCheatSetDataAssert(steps)
  if (cheat) {
    return { name, passed: false, error: cheat }
  }
  if (!hasReset) {
    try {
      if (options.defaultPageId?.trim()) {
        await canvasCmd(projectPath, {
          op: 'open',
          scope: 'page',
          id: options.defaultPageId.trim(),
        })
      } else if (options.defaultComponentId?.trim()) {
        await canvasCmd(projectPath, {
          op: 'open',
          scope: 'component',
          id: options.defaultComponentId.trim(),
        })
      } else {
        return {
          name,
          passed: false,
          error: '用例未含 reset，且未提供 pageId/componentId',
        }
      }
    } catch (err) {
      return {
        name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!
    try {
      await runStep(projectPath, step)
    } catch (err) {
      let state: PreviewSessionState | undefined
      try {
        state = requireCachedState(projectPath)
      } catch {
        state = undefined
      }
      return {
        name,
        passed: false,
        failedStepIndex: i,
        error: `步骤[${i}] ${step.op} 失败：${
          err instanceof Error ? err.message : String(err)
        }`,
        state,
      }
    }
  }

  return {
    name,
    passed: true,
    state: requireCachedState(projectPath),
  }
}

export async function runFrontendTestsForAi(options: {
  projectPath: string
  cases: FrontendTestCase[]
  pageId?: string
  componentId?: string
}): Promise<FrontendTestSuiteResult> {
  const results: FrontendTestCaseResult[] = []
  for (const testCase of options.cases) {
    const result = await runFrontendTestCase({
      projectPath: options.projectPath,
      testCase,
      defaultPageId: options.pageId,
      defaultComponentId: options.componentId,
    })
    results.push(result)
  }
  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.length - passedCount
  return {
    passed: failedCount === 0 && results.length > 0,
    total: results.length,
    passedCount,
    failedCount,
    results,
  }
}

/** 前端界面/方法/数据池写操作：调用后必须再跑测试套件 */
export function isFrontendMutatingTool(tool: string): boolean {
  return (
    tool === 'create_page' ||
    tool === 'copy_page' ||
    tool === 'delete_page' ||
    tool === 'save_page_config' ||
    tool === 'add_widget' ||
    tool === 'add_widgets' ||
    tool === 'update_widget_attrs' ||
    tool === 'remove_widget' ||
    tool === 'move_widget' ||
    tool === 'insert_component_ref' ||
    tool === 'upsert_data_field' ||
    tool === 'delete_data_field' ||
    tool === 'save_page_method' ||
    tool === 'delete_page_method' ||
    tool === 'save_page_lifecycle' ||
    tool === 'create_component' ||
    tool === 'rename_component' ||
    tool === 'delete_component' ||
    tool === 'save_component_config' ||
    tool === 'save_component_method' ||
    tool === 'delete_component_method' ||
    tool === 'save_component_lifecycle' ||
    tool === 'set_project_entry_page'
  )
}

export function parseFrontendTestCases(raw: unknown): FrontendTestCase[] {
  if (!Array.isArray(raw) || !raw.length) {
    throw new Error('cases 必须是非空数组')
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`cases[${index}] 必须是对象`)
    }
    const row = item as Record<string, unknown>
    const name = String(row.name ?? `case_${index + 1}`).trim() || `case_${index + 1}`
    const stepsRaw = row.steps
    if (!Array.isArray(stepsRaw) || !stepsRaw.length) {
      throw new Error(`cases[${index}].steps 必须是非空数组`)
    }
    const steps: FrontendTestStep[] = stepsRaw.map((s, si) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) {
        throw new Error(`cases[${index}].steps[${si}] 必须是对象`)
      }
      const step = s as Record<string, unknown>
      const op = String(step.op ?? '').trim()
      switch (op) {
        case 'reset':
          return {
            op: 'reset',
            pageId:
              typeof step.pageId === 'string' ? step.pageId.trim() : undefined,
            componentId:
              typeof step.componentId === 'string'
                ? step.componentId.trim()
                : undefined,
            query:
              step.query && typeof step.query === 'object' && !Array.isArray(step.query)
                ? (step.query as Record<string, unknown>)
                : undefined,
          }
        case 'setData':
          return {
            op: 'setData',
            field: String(step.field ?? '').trim(),
            value: step.value,
          }
        case 'click':
          return {
            op: 'click',
            nodeId: String(step.nodeId ?? '').trim(),
            eventKey:
              typeof step.eventKey === 'string' ? step.eventKey.trim() : undefined,
          }
        case 'runMethod':
          return {
            op: 'runMethod',
            name: String(step.name ?? '').trim(),
            args:
              step.args && typeof step.args === 'object' && !Array.isArray(step.args)
                ? (step.args as Record<string, unknown>)
                : undefined,
          }
        case 'wait':
          return {
            op: 'wait',
            ms: Number(step.ms) || 0,
          }
        case 'assertData':
          return {
            op: 'assertData',
            field: String(step.field ?? '').trim(),
            equals: step.equals,
            contains:
              typeof step.contains === 'string' ? step.contains : undefined,
          }
        case 'assertVisible':
          return {
            op: 'assertVisible',
            nodeId: String(step.nodeId ?? '').trim(),
            visible: step.visible !== false,
          }
        case 'assertText':
          return {
            op: 'assertText',
            nodeId: String(step.nodeId ?? '').trim(),
            equals: typeof step.equals === 'string' ? step.equals : undefined,
            contains:
              typeof step.contains === 'string' ? step.contains : undefined,
          }
        case 'assertStyle':
          return {
            op: 'assertStyle',
            nodeId: String(step.nodeId ?? '').trim(),
            background:
              typeof step.background === 'string' ? step.background : undefined,
            textColor:
              typeof step.textColor === 'string' ? step.textColor : undefined,
            containsBackground:
              typeof step.containsBackground === 'string'
                ? step.containsBackground
                : undefined,
          }
        default:
          throw new Error(`cases[${index}].steps[${si}] 未知 op：${op}`)
      }
    })
    return { name, steps }
  })
}
