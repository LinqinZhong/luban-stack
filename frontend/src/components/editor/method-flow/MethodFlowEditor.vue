<script lang="ts">
import { markRaw } from 'vue'
import StartNode from './nodes/StartNode.vue'
import InputNode from './nodes/InputNode.vue'
import BranchNode from './nodes/BranchNode.vue'
import ActionNode from './nodes/ActionNode.vue'
import OutputNode from './nodes/OutputNode.vue'
import DefineNode from './nodes/DefineNode.vue'
import PageMapNode from './nodes/PageMapNode.vue'
import ObjectMapNode from './nodes/ObjectMapNode.vue'
import ThrowNode from './nodes/ThrowNode.vue'
import EndNode from './nodes/EndNode.vue'

/** 模块级注册，避免 setup 重跑时自定义节点类型失效 */
const methodFlowNodeTypes = markRaw({
  start: markRaw(StartNode),
  input: markRaw(InputNode),
  branch: markRaw(BranchNode),
  action: markRaw(ActionNode),
  output: markRaw(OutputNode),
  define: markRaw(DefineNode),
  pageMap: markRaw(PageMapNode),
  objectMap: markRaw(ObjectMapNode),
  throw: markRaw(ThrowNode),
  end: markRaw(EndNode),
})
</script>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  toRef,
  watch,
} from 'vue'
import {
  VueFlow,
  useVueFlow,
  type Connection,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeMouseEvent,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { Plus } from '@element-plus/icons-vue'
import type {
  FlowNodeKind,
  MethodFlow,
  ProcessorMethodParam,
  ProcessorTypeExpr,
  ServiceProcessor,
} from '../../../types/backend-services'
import { createDefaultMethodFlow } from '../../../types/backend-services'
import type { DataTypeLibrary } from '../../../types/data-types'
import type { MethodParam, MethodParamType, MethodReturnType } from '../../../types/page-method'
import {
  buildTypeLibraryAmbientDeclarations,
  processorTypeExprToMethodParamType,
  processorTypeExprToTs,
} from '../../../types/page-method'
import { flowDraftToTypeExpr } from '../../../utils/flow-type-select'
import {
  QUERY_PAGE_VO_TYPE_ID,
  readFieldMappings,
} from '../../../utils/page-map-flow'
import { coarseToProcessorTypeExpr } from '../../../utils/typed-binding-paths'
import InputNodeDialog from './dialogs/InputNodeDialog.vue'
import {
  createEmptyInputNodeForm,
  normalizeInputDataSource,
  type InputModuleOption,
  type InputNodeForm,
} from './dialogs/input-node'
import BranchNodeDialog from './dialogs/BranchNodeDialog.vue'
import ActionNodeDialog, {
  type ActionNodeForm,
} from './dialogs/ActionNodeDialog.vue'
import OutputNodeDialog, {
  type OutputNodeForm,
} from './dialogs/OutputNodeDialog.vue'
import DefineNodeDialog, {
  type DefineNodeForm,
} from './dialogs/DefineNodeDialog.vue'
import PageMapNodeDialog, {
  type PageMapNodeForm,
} from './dialogs/PageMapNodeDialog.vue'
import EndNodeDialog, { type EndNodeForm } from './dialogs/EndNodeDialog.vue'
import ThrowNodeDialog, {
  type ThrowNodeForm,
} from './dialogs/ThrowNodeDialog.vue'
import AddFlowNodeDialog from './dialogs/AddFlowNodeDialog.vue'
import StartNodeDialog from './dialogs/StartNodeDialog.vue'
import { FLOW_DEBUG_KEY } from './flow-debug-inject'
import FlowHelperLines from './FlowHelperLines.vue'
import { getHelperLines } from './helper-lines'
import BackLink from '../BackLink.vue'
import { getServiceProcessors } from '../../../api/projects'

const nodeTypes = methodFlowNodeTypes
const FLOW_ID = 'method-flow-editor'

const { applyNodeChanges, applyEdgeChanges, getNodes } = useVueFlow({
  id: FLOW_ID,
})

const helperLineHorizontal = ref<number | undefined>(undefined)
const helperLineVertical = ref<number | undefined>(undefined)

/** 跨模块输入节点：缓存其它服务的处理器列表 */
const remoteProcessorsByService = ref(
  new Map<string, { data: ServiceProcessor[]; business: ServiceProcessor[] }>(),
)

const props = defineProps<{
  methodName: string
  /** 工具栏标题前缀，默认「方法」 */
  titleKind?: string
  flow: MethodFlow
  methodParams: ProcessorMethodParam[]
  methodOutput: ProcessorTypeExpr
  dataProcessors: ServiceProcessor[]
  /** 业务层处理器列表 */
  businessProcessors?: ServiceProcessor[]
  currentProcessorId?: string
  currentMethodId?: string
  /** 当前业务绑定的数据层 id */
  boundDataProcessorId?: string
  /** 当前模块（服务）id */
  currentServiceId?: string
  /** 全部模块选项 */
  moduleOptions?: InputModuleOption[]
  projectPath?: string
  /**
   * 输入节点数据来源：
   * - all：业务方法流默认
   * - business：仅业务层（API 编排）
   */
  inputSourceMode?: 'all' | 'business'
  typeLibrary?: DataTypeLibrary | null
  /** 调试游标节点 */
  debugCursorId?: string | null
  /** 已执行过的节点 */
  debugVisitedIds?: string[]
  /** 各节点打印文案 */
  debugPrintByNode?: Record<string, string>
}>()

const emit = defineEmits<{
  back: []
  'update:flow': [flow: MethodFlow]
  'update:selected-node': [nodeId: string | null]
}>()

type FlowGraphNode = {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
  deletable?: boolean
  selected?: boolean
}
type FlowGraphEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  selected?: boolean
  animated?: boolean
  class?: string
}

provide(FLOW_DEBUG_KEY, {
  cursorId: toRef(props, 'debugCursorId'),
  visitedIds: toRef(props, 'debugVisitedIds'),
  printByNode: toRef(props, 'debugPrintByNode'),
})

function flowToNodes(flow: MethodFlow): FlowGraphNode[] {
  return flow.nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: { ...n.position },
    data: enrichNodeData(n.kind, { ...n.data }),
    deletable: n.kind !== 'start',
  }))
}

function sameJson(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/** 按 id 合并，保留已有节点对象，避免 Vue Flow 自定义节点整表替换后消失 */
function syncNodesFromFlow(flow: MethodFlow) {
  const incoming = flowToNodes(flow)
  const prevById = new Map<string, FlowGraphNode>()
  for (const n of nodes.value) {
    prevById.set(n.id, n)
  }
  const incomingIds = new Set(incoming.map((n) => n.id))
  const structureChanged =
    incoming.length !== nodes.value.length ||
    incoming.some((n, i) => nodes.value[i]?.id !== n.id) ||
    nodes.value.some((n) => !incomingIds.has(n.id))

  for (const n of incoming) {
    const prev = prevById.get(n.id)
    if (!prev) continue
    if (prev.type !== n.type) prev.type = n.type
    if (prev.deletable !== n.deletable) prev.deletable = n.deletable
    if (
      prev.position.x !== n.position.x ||
      prev.position.y !== n.position.y
    ) {
      prev.position.x = n.position.x
      prev.position.y = n.position.y
    }
    if (!sameJson(prev.data, n.data)) {
      prev.data = n.data
    }
  }

  if (structureChanged) {
    nodes.value = incoming.map((n) => prevById.get(n.id) ?? n)
  }
}

function syncEdgesFromFlow(flow: MethodFlow) {
  const incoming = flowToEdges(flow)
  const prevById = new Map(edges.value.map((e) => [e.id, e]))
  const incomingIds = new Set(incoming.map((e) => e.id))
  const structureChanged =
    incoming.length !== edges.value.length ||
    incoming.some((e, i) => edges.value[i]?.id !== e.id) ||
    edges.value.some((e) => !incomingIds.has(e.id))

  for (const e of incoming) {
    const prev = prevById.get(e.id)
    if (!prev) continue
    prev.source = e.source
    prev.target = e.target
    prev.sourceHandle = e.sourceHandle
    prev.label = e.label
  }

  if (structureChanged) {
    edges.value = incoming.map((e) => prevById.get(e.id) ?? e)
  }
  patchDebugEdgeStyles()
}

/** visited 相邻节点之间的边 id */
function debugActiveEdgeIds(list: FlowGraphEdge[]): Set<string> {
  const visited = props.debugVisitedIds ?? []
  const active = new Set<string>()
  for (let i = 0; i < visited.length - 1; i++) {
    const from = visited[i]!
    const to = visited[i + 1]!
    for (const e of list) {
      if (e.source === from && e.target === to) active.add(e.id)
    }
  }
  return active
}

/** 套上调试流动样式；无变化时返回原数组引用，避免受控边更新死循环 */
function withDebugEdgeStyles(list: FlowGraphEdge[]): FlowGraphEdge[] {
  const active = debugActiveEdgeIds(list)
  let needsReplace = false
  for (const e of list) {
    const on = active.has(e.id)
    const cls = on ? 'is-debug-edge' : undefined
    if (e.animated !== on || e.class !== cls) {
      needsReplace = true
      break
    }
  }
  if (!needsReplace) return list

  return list.map((e) => {
    const on = active.has(e.id)
    return {
      ...e,
      animated: on,
      class: on ? 'is-debug-edge' : undefined,
      style: on
        ? { stroke: '#1d4ed8', strokeWidth: 2.5 }
        : { stroke: '#b1b3b8', strokeWidth: 1.5 },
    }
  })
}

function patchDebugEdgeStyles() {
  const next = withDebugEdgeStyles(edges.value)
  if (next !== edges.value) edges.value = next
}

/** 方法是否配置了有效出参（非空、非 void） */
const methodHasReturn = computed(() => {
  const t = (props.methodOutput?.type || '').trim()
  if (!t || t === 'void') return false
  return true
})

const methodOutputLabel = computed(() => {
  const expr = props.methodOutput
  if (!expr || !methodHasReturn.value) return 'void'
  return processorTypeExprToTs(expr, props.typeLibrary) || '—'
})

function enrichNodeData(
  kind: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (kind === 'end') {
    return { ...data, needsReturn: methodHasReturn.value }
  }
  return data
}

function stripUiOnlyData(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data }
  delete next.needsReturn
  return next
}

function flowToEdges(flow: MethodFlow): FlowGraphEdge[] {
  return flow.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || 'default',
    label: e.label,
  }))
}

function ensureFlow(flow: MethodFlow | undefined | null): MethodFlow {
  return flow?.nodes?.length ? flow : createDefaultMethodFlow()
}

const nodes = ref<FlowGraphNode[]>(flowToNodes(ensureFlow(props.flow)))
const edges = ref<FlowGraphEdge[]>(flowToEdges(ensureFlow(props.flow)))

watch(
  () =>
    nodes.value
      .filter((n) => n.selected)
      .map((n) => n.id)
      .join(','),
  () => {
    const selected = nodes.value.find((n) => n.selected)
    emit('update:selected-node', selected?.id ?? null)
  },
)

watch(
  () => (props.debugVisitedIds ?? []).join('\0'),
  () => patchDebugEdgeStyles(),
)

watch(
  () => props.debugCursorId,
  (cursorId) => {
    if (!cursorId) return
    let changed = false
    for (const n of nodes.value) {
      const next = n.id === cursorId
      if (n.selected !== next) {
        n.selected = next
        changed = true
      }
    }
    if (changed) emit('update:selected-node', cursorId)
  },
)

function onNodesChange(changes: NodeChange[]) {
  helperLineHorizontal.value = undefined
  helperLineVertical.value = undefined

  if (
    changes.length === 1 &&
    changes[0]!.type === 'position' &&
    changes[0]!.dragging &&
    changes[0]!.position
  ) {
    const helper = getHelperLines(changes[0]!, getNodes.value)
    changes[0]!.position.x = helper.snapPosition.x ?? changes[0]!.position.x
    changes[0]!.position.y = helper.snapPosition.y ?? changes[0]!.position.y
    helperLineHorizontal.value = helper.horizontal
    helperLineVertical.value = helper.vertical
  }

  nodes.value = applyNodeChanges(changes) as FlowGraphNode[]
}

function onEdgesChange(changes: EdgeChange[]) {
  // applyEdgeChanges 可能丢掉 class/animated，合并调试样式后再写回
  edges.value = withDebugEdgeStyles(applyEdgeChanges(changes) as FlowGraphEdge[])
}

let syncingFromProps = false
let lastEmitted = serializeFlowSnapshot(ensureFlow(props.flow))

function serializeFlowSnapshot(flow: MethodFlow): string {
  return JSON.stringify({
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      position: {
        x: Number(n.position.x) || 0,
        y: Number(n.position.y) || 0,
      },
      data: stripUiOnlyData({ ...(n.data as Record<string, unknown>) }),
    })),
    edges: flow.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle && e.sourceHandle !== 'default'
        ? e.sourceHandle
        : undefined,
      label: e.label || undefined,
    })),
  })
}

function serializeFlow(flow: MethodFlow): string {
  return serializeFlowSnapshot(flow)
}

function currentFlow(): MethodFlow {
  return {
    nodes: nodes.value.map((n) => ({
      id: n.id,
      kind: (n.type || 'action') as FlowNodeKind,
      position: { x: n.position.x, y: n.position.y },
      data: stripUiOnlyData({ ...(n.data as Record<string, unknown>) }),
    })),
    edges: edges.value.map((e) => {
      const edge: MethodFlow['edges'][number] = {
        id: e.id,
        source: e.source,
        target: e.target,
      }
      const handle = e.sourceHandle
      if (handle && handle !== 'default') edge.sourceHandle = handle
      if (typeof e.label === 'string' && e.label) edge.label = e.label
      return edge
    }),
  }
}

function emitFlow() {
  if (syncingFromProps) return
  const flow = currentFlow()
  const serialized = serializeFlow(flow)
  if (serialized === lastEmitted) return
  lastEmitted = serialized
  emit('update:flow', flow)
}

watch(
  () => serializeFlowSnapshot(ensureFlow(props.flow)),
  (serialized) => {
    if (serialized === lastEmitted) return
    if (serialized === serializeFlowSnapshot(currentFlow())) {
      lastEmitted = serialized
      return
    }
    syncingFromProps = true
    lastEmitted = serialized
    syncNodesFromFlow(ensureFlow(props.flow))
    syncEdgesFromFlow(ensureFlow(props.flow))
    void nextTick(() => {
      syncingFromProps = false
    })
  },
)

watch([nodes, edges], () => emitFlow(), { deep: true })

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target) return
  if (connection.source === connection.target) return
  const sourceNode = nodes.value.find((n) => n.id === connection.source)
  if (sourceNode?.type === 'end') return
  const sourceHandle = connection.sourceHandle || 'default'
  edges.value = [
    ...edges.value,
    {
      id: `e_${connection.source}_${sourceHandle}_${connection.target}_${Date.now().toString(36)}`,
      source: connection.source,
      target: connection.target,
      sourceHandle,
      label:
        sourceHandle === 'true'
          ? '是'
          : sourceHandle === 'false'
            ? '否'
            : undefined,
    },
  ]
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function pickInsertPosition(): { x: number; y: number } {
  const selected = nodes.value.find((n) => n.selected)
  if (selected) {
    return { x: selected.position.x, y: selected.position.y + 120 }
  }
  const start = nodes.value.find((n) => n.type === 'start')
  if (start) {
    return { x: start.position.x, y: start.position.y + 120 }
  }
  return { x: 280, y: 160 }
}

function defaultDataForKind(kind: Exclude<FlowNodeKind, 'start'>): Record<string, unknown> {
  switch (kind) {
    case 'input':
      return {
        serviceId: props.currentServiceId ?? '',
        dataSource:
          props.inputSourceMode === 'business' ? 'business' : 'data',
        dataProcessorId: '',
        dataMethodId: '',
        headerField: '',
        varName: '',
        methodLabel: '',
        paramBindings: {},
        printExpr: '',
      }
    case 'branch':
      return { expression: '', printExpr: '' }
    case 'action':
      return {
        code: '',
        description: '',
        printExpr: '',
        outputType: 'void',
        outputTypeRef: '',
        outputItemType: '',
        outputItemTypeRef: '',
        outputItemItemType: '',
        outputItemItemTypeRef: '',
        outputGenericArgs: {},
        outputVarName: '',
      }
    case 'output':
      return {
        dataProcessorId: '',
        dataMethodId: '',
        methodLabel: '',
        paramBindings: {},
        resultVarName: '',
        description: '',
        printExpr: '',
      }
    case 'define':
      return {
        varName: '',
        valueType: 'any',
        valueTypeRef: '',
        valueItemType: '',
        valueItemTypeRef: '',
        valueItemItemType: '',
        valueItemItemTypeRef: '',
        valueGenericArgs: {},
        initExpr: 'null',
        description: '',
        printExpr: '',
      }
    case 'pageMap':
      return {
        sourceKind: 'page',
        sourcePath: '',
        currentExpr: '',
        pageSizeExpr: '',
        totalExpr: '',
        hasNextExpr: '',
        targetTypeRef: QUERY_PAGE_VO_TYPE_ID,
        targetGenericArgs: {},
        targetVarName: '',
        fieldMappings: [],
        description: '',
        printExpr: '',
      }
    case 'objectMap':
      return {
        sourcePath: '',
        targetTypeRef: '',
        targetGenericArgs: {},
        targetVarName: '',
        fieldMappings: [],
        description: '',
        printExpr: '',
      }
    case 'throw':
      return {
        messageExpr: '',
        printExpr: '',
      }
    case 'end':
      return {
        returnExpr: '',
        printExpr: '',
        needsReturn: methodHasReturn.value,
      }
    default:
      return {}
  }
}

function addFlowNode(kind: Exclude<FlowNodeKind, 'start'>) {
  const id = uid(kind)
  const position = pickInsertPosition()
  const data = defaultDataForKind(kind)

  const from =
    nodes.value.find((n) => n.selected) ??
    nodes.value.find((n) => n.type === 'start')
  const fromId = from?.id
  const fromType = from?.type

  // 终止 / 业务异常节点不应作为连线起点自动接后续
  const skipAutoEdge = fromType === 'end' || fromType === 'throw'

  nodes.value = [
    ...nodes.value,
    {
      id,
      type: kind,
      position,
      data,
      deletable: true,
    },
  ]

  if (fromId && fromId !== id && !skipAutoEdge) {
    const sourceHandle = fromType === 'branch' ? 'true' : 'default'
    edges.value = [
      ...edges.value,
      {
        id: uid('edge'),
        source: fromId,
        target: id,
        sourceHandle,
        label: sourceHandle === 'true' ? '是' : undefined,
      },
    ]
  }
}

const addNodeDialogVisible = ref(false)
const inputDialogVisible = ref(false)
const branchDialogVisible = ref(false)
const actionDialogVisible = ref(false)
const outputDialogVisible = ref(false)
const defineDialogVisible = ref(false)
const pageMapDialogVisible = ref(false)
const throwDialogVisible = ref(false)
const endDialogVisible = ref(false)
const startDialogVisible = ref(false)
const editingNodeId = ref('')

const editingInputForm = ref<InputNodeForm>(
  createEmptyInputNodeForm({
    serviceId: '',
    dataSource: 'data',
  }),
)
const editingExpression = ref('')
const editingBranchPrintExpr = ref('')
const editingStartPrintExpr = ref('')
const editingActionForm = ref<ActionNodeForm>({
  code: '',
  description: '',
  printExpr: '',
  outputType: 'void',
  outputTypeRef: '',
  outputItemType: '',
  outputItemTypeRef: '',
  outputItemItemType: '',
  outputItemItemTypeRef: '',
  outputGenericArgs: {},
  outputVarName: '',
})
const editingOutputForm = ref<OutputNodeForm>({
  dataProcessorId: '',
  dataMethodId: '',
  methodLabel: '',
  paramBindings: {},
  resultVarName: '',
  description: '',
  printExpr: '',
})
const editingDefineForm = ref<DefineNodeForm>({
  varName: '',
  valueType: 'any',
  valueTypeRef: '',
  valueItemType: '',
  valueItemTypeRef: '',
  valueItemItemType: '',
  valueItemItemTypeRef: '',
  valueGenericArgs: {},
  initExpr: 'null',
  description: '',
  printExpr: '',
})
const editingPageMapForm = ref<PageMapNodeForm>({
  sourceKind: 'page',
  sourcePath: '',
  currentExpr: '',
  pageSizeExpr: '',
  totalExpr: '',
  hasNextExpr: '',
  targetTypeRef: QUERY_PAGE_VO_TYPE_ID,
  targetGenericArgs: {},
  targetVarName: '',
  fieldMappings: [],
  description: '',
  printExpr: '',
})
const editingEndForm = ref<EndNodeForm>({
  returnExpr: '',
  printExpr: '',
})
const editingThrowForm = ref<ThrowNodeForm>({
  messageExpr: '',
  printExpr: '',
})

function readGenericArgs(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function strField(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

function actionOutputToParam(data: Record<string, unknown>): MethodParam | null {
  const outputType = (
    typeof data.outputType === 'string' ? data.outputType : 'void'
  ) as MethodReturnType
  const outputTypeRef = strField(data, 'outputTypeRef').trim()
  const outputVarName = strField(data, 'outputVarName').trim()
  if (!outputVarName) return null
  if (outputType === 'void' && !outputTypeRef) return null
  const type =
    outputType === 'void' ? 'object' : (outputType as MethodParam['type'])
  const typeExpr = flowDraftToTypeExpr({
    type: outputType === 'void' ? 'object' : outputType,
    typeRef: outputTypeRef,
    itemType: strField(data, 'outputItemType'),
    itemTypeRef: strField(data, 'outputItemTypeRef'),
    itemItemType: strField(data, 'outputItemItemType'),
    itemItemTypeRef: strField(data, 'outputItemItemTypeRef'),
    genericArgs: readGenericArgs(data.outputGenericArgs),
  })
  const tsType = processorTypeExprToTs(typeExpr, props.typeLibrary)
  return {
    name: outputVarName,
    type,
    typeExpr,
    ...(tsType ? { tsType } : {}),
  }
}

function defineToParam(data: Record<string, unknown>): MethodParam | null {
  const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
  if (!varName) return null
  const valueType = (
    typeof data.valueType === 'string' ? data.valueType : 'any'
  ) as MethodParamType
  const valueTypeRef = strField(data, 'valueTypeRef').trim()
  const typeExpr = flowDraftToTypeExpr({
    type: valueType,
    typeRef: valueTypeRef,
    itemType: strField(data, 'valueItemType'),
    itemTypeRef: strField(data, 'valueItemTypeRef'),
    itemItemType: strField(data, 'valueItemItemType'),
    itemItemTypeRef: strField(data, 'valueItemItemTypeRef'),
    genericArgs: readGenericArgs(data.valueGenericArgs),
  })
  const tsType = processorTypeExprToTs(typeExpr, props.typeLibrary)
  return {
    name: varName,
    type: valueType,
    typeExpr,
    ...(tsType ? { tsType } : {}),
  }
}

function pageMapToParam(data: Record<string, unknown>): MethodParam | null {
  const varName =
    (typeof data.targetVarName === 'string' ? data.targetVarName.trim() : '') ||
    (typeof data.targetPath === 'string' ? data.targetPath.trim() : '')
  if (!varName) return null
  const typeRef =
    typeof data.targetTypeRef === 'string' ? data.targetTypeRef.trim() : ''
  const typeExpr = flowDraftToTypeExpr({
    type: 'object',
    typeRef,
    genericArgs: readGenericArgs(data.targetGenericArgs),
  })
  const tsType = processorTypeExprToTs(typeExpr, props.typeLibrary)
  return {
    name: varName,
    type: 'object',
    typeExpr,
    ...(tsType ? { tsType } : {}),
  }
}

const reservedNames = computed(() => {
  const names = props.methodParams.map((p) => p.name.trim()).filter(Boolean)
  for (const n of nodes.value) {
    if (n.id === editingNodeId.value) continue
    const data = (n.data ?? {}) as Record<string, unknown>
    if (n.type === 'input' || n.type === 'define') {
      const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
      if (varName) names.push(varName)
    } else if (n.type === 'action') {
      const varName =
        typeof data.outputVarName === 'string' ? data.outputVarName.trim() : ''
      if (varName) names.push(varName)
    } else if (n.type === 'output') {
      const varName =
        typeof data.resultVarName === 'string' ? data.resultVarName.trim() : ''
      if (varName) names.push(varName)
    } else if (n.type === 'pageMap' || n.type === 'objectMap') {
      const varName =
        (typeof data.targetVarName === 'string'
          ? data.targetVarName.trim()
          : '') ||
        (typeof data.targetPath === 'string' ? data.targetPath.trim() : '')
      if (varName) names.push(varName)
    }
  }
  return names
})

function findDataMethod(processorId: string, methodId: string) {
  if (!processorId || !methodId) return null
  const proc = props.dataProcessors.find((p) => p.id === processorId)
  return proc?.methods.find((m) => m.id === methodId) ?? null
}

function findProcessorMethodIn(
  processors: ServiceProcessor[],
  processorId: string,
  methodId: string,
) {
  if (!processorId || !methodId) return null
  const proc = processors.find((p) => p.id === processorId)
  return proc?.methods.find((m) => m.id === methodId) ?? null
}

function processorsForService(serviceId: string): {
  data: ServiceProcessor[]
  business: ServiceProcessor[]
} {
  const sid = serviceId.trim()
  if (!sid || sid === (props.currentServiceId ?? '')) {
    return {
      data: props.dataProcessors,
      business: props.businessProcessors ?? [],
    }
  }
  return (
    remoteProcessorsByService.value.get(sid) ?? { data: [], business: [] }
  )
}

watch(
  () => {
    const ids: string[] = []
    for (const n of nodes.value) {
      if (n.type !== 'input') continue
      const d = (n.data ?? {}) as Record<string, unknown>
      const sid = typeof d.serviceId === 'string' ? d.serviceId.trim() : ''
      if (sid && sid !== props.currentServiceId) ids.push(sid)
    }
    return [props.projectPath, props.currentServiceId, ids.sort().join('|')] as const
  },
  async ([projectPath]) => {
    const path = typeof projectPath === 'string' ? projectPath.trim() : ''
    if (!path) return
    const needed = new Set<string>()
    for (const n of nodes.value) {
      if (n.type !== 'input') continue
      const d = (n.data ?? {}) as Record<string, unknown>
      const sid = typeof d.serviceId === 'string' ? d.serviceId.trim() : ''
      if (sid && sid !== props.currentServiceId) needed.add(sid)
    }
    let changed = false
    const next = new Map(remoteProcessorsByService.value)
    await Promise.all(
      [...needed].map(async (sid) => {
        if (next.has(sid)) return
        try {
          const [biz, data] = await Promise.all([
            getServiceProcessors(path, sid, 'business'),
            getServiceProcessors(path, sid, 'data'),
          ])
          next.set(sid, {
            business: biz.processors ?? [],
            data: data.processors ?? [],
          })
          changed = true
        } catch {
          /* ignore */
        }
      }),
    )
    if (changed) remoteProcessorsByService.value = next
  },
  { immediate: true },
)

function readSavedOutputTypeExpr(
  data: Record<string, unknown>,
): ProcessorTypeExpr | null {
  const raw = data.outputTypeExpr
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const type = (raw as { type?: unknown }).type
  if (typeof type !== 'string' || !type.trim()) return null
  return raw as ProcessorTypeExpr
}

function inputNodeToParam(data: Record<string, unknown>): MethodParam | null {
  const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
  if (!varName) return null
  const dataSource = typeof data.dataSource === 'string' ? data.dataSource : ''
  if (
    dataSource === 'request_header' ||
    (typeof data.headerField === 'string' &&
      data.headerField.trim() &&
      !data.dataProcessorId)
  ) {
    return { name: varName, type: 'string', tsType: 'string' }
  }
  const saved = readSavedOutputTypeExpr(data)
  if (saved) {
    return {
      name: varName,
      type: processorTypeExprToMethodParamType(saved),
      tsType: processorTypeExprToTs(saved, props.typeLibrary),
      typeExpr: saved,
    }
  }
  const processorId =
    typeof data.dataProcessorId === 'string' ? data.dataProcessorId : ''
  const methodId = typeof data.dataMethodId === 'string' ? data.dataMethodId : ''
  const serviceId =
    (typeof data.serviceId === 'string' ? data.serviceId.trim() : '') ||
    props.currentServiceId ||
    ''
  // 依赖 remoteProcessorsByService，跨模块拉取后触发 ambient 重算
  void remoteProcessorsByService.value
  const { data: dataList, business: bizList } = processorsForService(serviceId)
  const method =
    findProcessorMethodIn(dataList, processorId, methodId) ??
    findProcessorMethodIn(bizList, processorId, methodId)
  if (method?.output) {
    return {
      name: varName,
      type: processorTypeExprToMethodParamType(method.output),
      tsType: processorTypeExprToTs(method.output, props.typeLibrary),
      typeExpr: method.output,
    }
  }
  return {
    name: varName,
    type: 'any',
    typeExpr: coarseToProcessorTypeExpr('any'),
  }
}

function outputNodeToParam(data: Record<string, unknown>): MethodParam | null {
  const varName =
    typeof data.resultVarName === 'string' ? data.resultVarName.trim() : ''
  if (!varName) return null
  const processorId =
    typeof data.dataProcessorId === 'string' ? data.dataProcessorId : ''
  const methodId = typeof data.dataMethodId === 'string' ? data.dataMethodId : ''
  const method = findDataMethod(processorId, methodId)
  if (method?.output) {
    return {
      name: varName,
      type: processorTypeExprToMethodParamType(method.output),
      tsType: processorTypeExprToTs(method.output, props.typeLibrary),
      typeExpr: method.output,
    }
  }
  return {
    name: varName,
    type: 'any',
    typeExpr: coarseToProcessorTypeExpr('any'),
  }
}

const ambientVars = computed((): MethodParam[] => {
  const vars: MethodParam[] = props.methodParams
    .filter((p) => p.name.trim())
    .map((p) => ({
      name: p.name.trim(),
      type: processorTypeExprToMethodParamType(p.typeExpr),
      tsType: processorTypeExprToTs(p.typeExpr, props.typeLibrary),
      typeExpr: p.typeExpr,
    }))
  for (const n of nodes.value) {
    const data = (n.data ?? {}) as Record<string, unknown>
    if (n.type === 'input') {
      if (n.id === editingNodeId.value && inputDialogVisible.value) continue
      const param = inputNodeToParam(data)
      if (!param) continue
      if (vars.some((v) => v.name === param.name)) continue
      vars.push(param)
      continue
    }
    if (n.type === 'output') {
      if (n.id === editingNodeId.value && outputDialogVisible.value) continue
      const param = outputNodeToParam(data)
      if (!param) continue
      if (vars.some((v) => v.name === param.name)) continue
      vars.push(param)
      continue
    }
    if (n.type === 'define') {
      if (n.id === editingNodeId.value && defineDialogVisible.value) continue
      const param = defineToParam(data)
      if (!param) continue
      if (vars.some((v) => v.name === param.name)) continue
      vars.push(param)
      continue
    }
    if (n.type === 'action') {
      if (n.id === editingNodeId.value && actionDialogVisible.value) continue
      const param = actionOutputToParam(data)
      if (!param) continue
      if (vars.some((v) => v.name === param.name)) continue
      vars.push(param)
      continue
    }
    if (n.type === 'pageMap') {
      if (n.id === editingNodeId.value && pageMapDialogVisible.value) continue
      const param = pageMapToParam(data)
      if (!param) continue
      if (vars.some((v) => v.name === param.name)) continue
      vars.push(param)
    }
  }
  return vars
})

const ambientExtra = computed(() =>
  buildTypeLibraryAmbientDeclarations(props.typeLibrary),
)

const ambientHint = computed(() =>
  ambientVars.value.map((v) => v.name).join(', ') || '（暂无）',
)

function readParamBindings(data: Record<string, unknown>): Record<string, string> {
  const raw = data.paramBindings
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function inferInputDataSource(
  data: Record<string, unknown>,
): ReturnType<typeof normalizeInputDataSource> {
  const businessOnly = props.inputSourceMode === 'business'
  if (data.dataSource === 'request_header') return 'request_header'
  if (
    typeof data.headerField === 'string' &&
    data.headerField.trim() &&
    !data.dataSource
  ) {
    return 'request_header'
  }
  return normalizeInputDataSource(data.dataSource, { businessOnly })
}

function inferInputServiceId(data: Record<string, unknown>): string {
  if (typeof data.serviceId === 'string' && data.serviceId.trim()) {
    return data.serviceId.trim()
  }
  return props.currentServiceId ?? ''
}

function openNodeEditor(node: Node) {
  if (node.type === 'start') {
    editingNodeId.value = node.id
    const data = (node.data ?? {}) as Record<string, unknown>
    editingStartPrintExpr.value =
      typeof data.printExpr === 'string' ? data.printExpr : ''
    startDialogVisible.value = true
    return
  }
  if (node.type === 'end') {
    editingNodeId.value = node.id
    const data = (node.data ?? {}) as Record<string, unknown>
    editingEndForm.value = {
      returnExpr: typeof data.returnExpr === 'string' ? data.returnExpr : '',
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
    }
    endDialogVisible.value = true
    return
  }
  if (node.type === 'throw') {
    editingNodeId.value = node.id
    const data = (node.data ?? {}) as Record<string, unknown>
    editingThrowForm.value = {
      messageExpr:
        typeof data.messageExpr === 'string' ? data.messageExpr : '',
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
    }
    throwDialogVisible.value = true
    return
  }
  editingNodeId.value = node.id
  const data = (node.data ?? {}) as Record<string, unknown>
  if (node.type === 'input') {
    editingInputForm.value = {
      serviceId: inferInputServiceId(data),
      dataSource: inferInputDataSource(data),
      dataProcessorId:
        typeof data.dataProcessorId === 'string' ? data.dataProcessorId : '',
      dataMethodId:
        typeof data.dataMethodId === 'string' ? data.dataMethodId : '',
      headerField:
        typeof data.headerField === 'string' ? data.headerField : '',
      varName: typeof data.varName === 'string' ? data.varName : '',
      methodLabel:
        typeof data.methodLabel === 'string' ? data.methodLabel : '',
      paramBindings: readParamBindings(data),
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
    }
    inputDialogVisible.value = true
  } else if (node.type === 'branch') {
    editingExpression.value =
      typeof data.expression === 'string' ? data.expression : ''
    editingBranchPrintExpr.value =
      typeof data.printExpr === 'string' ? data.printExpr : ''
    branchDialogVisible.value = true
  } else if (node.type === 'action') {
    const outputTypeRaw =
      typeof data.outputType === 'string' ? data.outputType : 'void'
    editingActionForm.value = {
      code: typeof data.code === 'string' ? data.code : '',
      description:
        typeof data.description === 'string' ? data.description : '',
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
      outputType: (
        ['void', 'string', 'number', 'boolean', 'object', 'array', 'any'].includes(
          outputTypeRaw,
        )
          ? outputTypeRaw
          : 'void'
      ) as MethodReturnType,
      outputTypeRef:
        typeof data.outputTypeRef === 'string' ? data.outputTypeRef : '',
      outputItemType:
        typeof data.outputItemType === 'string' ? data.outputItemType : '',
      outputItemTypeRef:
        typeof data.outputItemTypeRef === 'string'
          ? data.outputItemTypeRef
          : '',
      outputItemItemType:
        typeof data.outputItemItemType === 'string'
          ? data.outputItemItemType
          : '',
      outputItemItemTypeRef:
        typeof data.outputItemItemTypeRef === 'string'
          ? data.outputItemItemTypeRef
          : '',
      outputGenericArgs: readGenericArgs(data.outputGenericArgs),
      outputVarName:
        typeof data.outputVarName === 'string' ? data.outputVarName : '',
    }
    actionDialogVisible.value = true
  } else if (node.type === 'output') {
    editingOutputForm.value = {
      dataProcessorId:
        typeof data.dataProcessorId === 'string' ? data.dataProcessorId : '',
      dataMethodId:
        typeof data.dataMethodId === 'string' ? data.dataMethodId : '',
      methodLabel:
        typeof data.methodLabel === 'string' ? data.methodLabel : '',
      paramBindings: readParamBindings(data),
      resultVarName:
        typeof data.resultVarName === 'string' ? data.resultVarName : '',
      description:
        typeof data.description === 'string' ? data.description : '',
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
    }
    outputDialogVisible.value = true
  } else if (node.type === 'define') {
    const valueTypeRaw =
      typeof data.valueType === 'string' ? data.valueType : 'any'
    editingDefineForm.value = {
      varName: typeof data.varName === 'string' ? data.varName : '',
      valueType: (
        ['string', 'number', 'boolean', 'object', 'array', 'any'].includes(
          valueTypeRaw,
        )
          ? valueTypeRaw
          : 'any'
      ) as MethodParamType,
      valueTypeRef:
        typeof data.valueTypeRef === 'string' ? data.valueTypeRef : '',
      valueItemType:
        typeof data.valueItemType === 'string' ? data.valueItemType : '',
      valueItemTypeRef:
        typeof data.valueItemTypeRef === 'string' ? data.valueItemTypeRef : '',
      valueItemItemType:
        typeof data.valueItemItemType === 'string'
          ? data.valueItemItemType
          : '',
      valueItemItemTypeRef:
        typeof data.valueItemItemTypeRef === 'string'
          ? data.valueItemItemTypeRef
          : '',
      valueGenericArgs: readGenericArgs(data.valueGenericArgs),
      initExpr: typeof data.initExpr === 'string' ? data.initExpr : 'null',
      description:
        typeof data.description === 'string' ? data.description : '',
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
    }
    defineDialogVisible.value = true
  } else if (node.type === 'pageMap') {
    editingPageMapForm.value = {
      sourceKind: data.sourceKind === 'array' ? 'array' : 'page',
      sourcePath:
        typeof data.sourcePath === 'string' ? data.sourcePath : '',
      currentExpr:
        typeof data.currentExpr === 'string' ? data.currentExpr : '',
      pageSizeExpr:
        typeof data.pageSizeExpr === 'string' ? data.pageSizeExpr : '',
      totalExpr: typeof data.totalExpr === 'string' ? data.totalExpr : '',
      hasNextExpr:
        typeof data.hasNextExpr === 'string' ? data.hasNextExpr : '',
      targetTypeRef:
        typeof data.targetTypeRef === 'string' ? data.targetTypeRef : '',
      targetGenericArgs: readGenericArgs(data.targetGenericArgs),
      targetVarName:
        typeof data.targetVarName === 'string'
          ? data.targetVarName
          : typeof data.targetPath === 'string'
            ? data.targetPath
            : '',
      fieldMappings: readFieldMappings(data.fieldMappings),
      description:
        typeof data.description === 'string' ? data.description : '',
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
    }
    pageMapDialogVisible.value = true
  } else if (node.type === 'objectMap') {
    editingObjectMapForm.value = {
      sourcePath: typeof data.sourcePath === 'string' ? data.sourcePath : '',
      targetTypeRef:
        typeof data.targetTypeRef === 'string' ? data.targetTypeRef : '',
      targetGenericArgs: readGenericArgs(data.targetGenericArgs),
      targetVarName:
        typeof data.targetVarName === 'string'
          ? data.targetVarName
          : typeof data.targetPath === 'string'
            ? data.targetPath
            : '',
      fieldMappings: readFieldMappings(data.fieldMappings),
      description:
        typeof data.description === 'string' ? data.description : '',
      printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
    }
    objectMapDialogVisible.value = true
  }
}

function onNodeDoubleClick(event: NodeMouseEvent) {
  openNodeEditor(event.node)
}

function patchNodeData(id: string, patch: Record<string, unknown>) {
  const node = nodes.value.find((n) => n.id === id)
  if (!node) return
  node.data = { ...(node.data as Record<string, unknown>), ...patch }
}

function saveInputNode(form: InputNodeForm) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, { ...form })
}

function saveBranchNode(payload: { expression: string; printExpr: string }) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, {
    expression: payload.expression,
    printExpr: payload.printExpr,
  })
}

function saveStartNode(payload: { printExpr: string }) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, { printExpr: payload.printExpr })
}

function saveActionNode(form: ActionNodeForm) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, { ...form })
}

function saveOutputNode(form: OutputNodeForm) {
  if (!editingNodeId.value) return
  // 清除旧版 DTO 绑定字段
  patchNodeData(editingNodeId.value, {
    ...form,
    dtoTypeRef: '',
    dtoLabel: '',
  })
}

function saveDefineNode(form: DefineNodeForm) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, { ...form })
}

function savePageMapNode(form: PageMapNodeForm) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, { ...form })
}

function saveObjectMapNode(form: ObjectMapNodeForm) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, { ...form })
}

function saveEndNode(form: EndNodeForm) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, {
    returnExpr: form.returnExpr,
    printExpr: form.printExpr,
    needsReturn: methodHasReturn.value,
  })
}

function saveThrowNode(form: ThrowNodeForm) {
  if (!editingNodeId.value) return
  patchNodeData(editingNodeId.value, {
    messageExpr: form.messageExpr,
    printExpr: form.printExpr,
  })
}

watch(methodHasReturn, (needs) => {
  for (const n of nodes.value) {
    if (n.type !== 'end') continue
    const data: Record<string, unknown> = {
      ...(n.data as Record<string, unknown>),
      needsReturn: needs,
    }
    if (!needs) data.returnExpr = ''
    n.data = data
  }
})

function onKeyDown(event: KeyboardEvent) {
  const el = event.target as HTMLElement | null
  const tag = el?.tagName?.toLowerCase()
  if (
    tag === 'input' ||
    tag === 'textarea' ||
    el?.isContentEditable ||
    el?.closest?.('.monaco-editor')
  ) {
    return
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  const selectedNodeIds = nodes.value
    .filter((n) => n.selected && n.type !== 'start')
    .map((n) => n.id)
  const selectedEdgeIds = edges.value.filter((e) => e.selected).map((e) => e.id)
  if (!selectedNodeIds.length && !selectedEdgeIds.length) return
  event.preventDefault()
  if (selectedNodeIds.length) {
    const remove = new Set(selectedNodeIds)
    nodes.value = nodes.value.filter((n) => !remove.has(n.id))
    edges.value = edges.value.filter(
      (e) => !remove.has(e.source) && !remove.has(e.target),
    )
  }
  if (selectedEdgeIds.length) {
    const remove = new Set(selectedEdgeIds)
    edges.value = edges.value.filter((e) => !remove.has(e.id))
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  const start = nodes.value.find((n) => n.type === 'start')
  if (start && !nodes.value.some((n) => n.selected)) {
    for (const n of nodes.value) {
      n.selected = n.id === start.id
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="method-flow-editor">
    <header class="flow-toolbar">
      <div class="toolbar-left">
        <BackLink @click="emit('back')" />
        <span class="method-title"
          >{{ titleKind || '方法' }} {{ methodName || '未命名' }}</span
        >
      </div>
    </header>

    <div class="flow-canvas">
      <div class="flow-stage-toolbar">
        <el-tooltip content="添加节点" placement="left" :enterable="false">
          <el-button
            type="primary"
            circle
            :icon="Plus"
            @click="addNodeDialogVisible = true"
          />
        </el-tooltip>
      </div>
      <VueFlow
        :id="FLOW_ID"
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        fit-view-on-init
        :default-edge-options="{ type: 'smoothstep' }"
        :pan-activation-key-code="null"
        disable-keyboard-a11y
        @nodes-change="onNodesChange"
        @edges-change="onEdgesChange"
        @connect="onConnect"
        @node-double-click="onNodeDoubleClick"
      >
        <Background pattern-color="#e4e7ed" :gap="18" />
        <Controls />
        <FlowHelperLines
          :horizontal="helperLineHorizontal"
          :vertical="helperLineVertical"
        />
      </VueFlow>
    </div>

    <AddFlowNodeDialog
      v-model="addNodeDialogVisible"
      @select="addFlowNode"
    />
    <InputNodeDialog
      v-model="inputDialogVisible"
      :form="editingInputForm"
      :project-path="projectPath ?? ''"
      :current-service-id="currentServiceId ?? ''"
      :module-options="moduleOptions ?? []"
      :business-processors="businessProcessors ?? []"
      :data-processors="dataProcessors"
      :current-processor-id="currentProcessorId ?? ''"
      :current-method-id="currentMethodId ?? ''"
      :source-mode="inputSourceMode ?? 'all'"
      :reserved-names="reservedNames"
      :ambient-vars="ambientVars"
      :type-library="typeLibrary"
      @save="saveInputNode"
    />
    <BranchNodeDialog
      v-model="branchDialogVisible"
      :expression="editingExpression"
      :print-expr="editingBranchPrintExpr"
      :ambient-hint="ambientHint"
      @save="saveBranchNode"
    />
    <StartNodeDialog
      v-model="startDialogVisible"
      :print-expr="editingStartPrintExpr"
      @save="saveStartNode"
    />
    <ActionNodeDialog
      v-model="actionDialogVisible"
      :form="editingActionForm"
      :ambient-vars="ambientVars"
      :ambient-extra="ambientExtra"
      :ambient-hint="ambientHint"
      :type-library="typeLibrary"
      :reserved-names="reservedNames"
      @save="saveActionNode"
    />
    <OutputNodeDialog
      v-model="outputDialogVisible"
      :form="editingOutputForm"
      :data-processors="dataProcessors"
      :reserved-names="reservedNames"
      :ambient-vars="ambientVars"
      :type-library="typeLibrary"
      @save="saveOutputNode"
    />
    <DefineNodeDialog
      v-model="defineDialogVisible"
      :form="editingDefineForm"
      :type-library="typeLibrary"
      :reserved-names="reservedNames"
      @save="saveDefineNode"
    />
    <PageMapNodeDialog
      v-model="pageMapDialogVisible"
      :form="editingPageMapForm"
      :ambient-vars="ambientVars"
      :type-library="typeLibrary"
      @save="savePageMapNode"
    />
    <ObjectMapNodeDialog
      v-model="objectMapDialogVisible"
      :form="editingObjectMapForm"
      :ambient-vars="ambientVars"
      :type-library="typeLibrary"
      @save="saveObjectMapNode"
    />
    <ThrowNodeDialog
      v-model="throwDialogVisible"
      :form="editingThrowForm"
      :ambient-hint="ambientHint"
      @save="saveThrowNode"
    />
    <EndNodeDialog
      v-model="endDialogVisible"
      :form="editingEndForm"
      :require-return="methodHasReturn"
      :output-type-label="methodOutputLabel"
      :output-type="methodOutput"
      :ambient-vars="ambientVars"
      :type-library="typeLibrary"
      @save="saveEndNode"
    />
  </div>
</template>

<style scoped>
.method-flow-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #fafafa;
}

.flow-toolbar {
  flex-shrink: 0;
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.method-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
}

.flow-stage-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 5;
  display: flex;
  gap: 8px;
  pointer-events: none;
}

.flow-stage-toolbar > * {
  pointer-events: auto;
}

.flow-canvas :deep(.vue-flow) {
  width: 100%;
  height: 100%;
}

/* 去掉 Vue Flow 默认节点外框，避免与自定义卡片双层边框 */
.flow-canvas :deep(.vue-flow__node) {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  width: auto !important;
  overflow: visible;
}

.flow-canvas :deep(.vue-flow__node.selected) {
  box-shadow: none;
  z-index: 6 !important;
}

.flow-canvas :deep(.vue-flow__node.selected .flow-debug-target) {
  outline: 2px solid #409eff;
  outline-offset: 3px;
  box-shadow:
    0 0 0 4px rgba(64, 158, 255, 0.22),
    0 8px 20px rgba(64, 158, 255, 0.28),
    0 2px 8px rgba(15, 23, 42, 0.12);
  transform-origin: center center;
  animation: flow-node-breathe 1.6s ease-in-out infinite;
}

.flow-canvas :deep(.flow-debug-target.is-debug-cursor) {
  outline: 2px solid #e6a23c;
  outline-offset: 3px;
  box-shadow: 0 0 0 4px rgba(230, 162, 60, 0.22);
}

.flow-canvas :deep(.vue-flow__node.selected .flow-debug-target.is-debug-cursor) {
  outline-color: #409eff;
  box-shadow:
    0 0 0 4px rgba(64, 158, 255, 0.22),
    0 8px 20px rgba(64, 158, 255, 0.28),
    0 2px 8px rgba(15, 23, 42, 0.12);
}

.flow-canvas :deep(.flow-debug-target.is-debug-visited:not(.is-debug-cursor)) {
  opacity: 0.88;
}

@keyframes flow-node-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.06);
  }
}

.flow-canvas :deep(.vue-flow__handle) {
  width: 8px;
  height: 8px;
  border: 1px solid #fff;
  background: #909399;
}

/* 已执行路径上的边：深蓝 + 虚线流动 */
.flow-canvas :deep(.vue-flow__edge.is-debug-edge .vue-flow__edge-path) {
  stroke: #1d4ed8 !important;
  stroke-width: 2.5 !important;
  stroke-dasharray: 6 4;
  animation: flow-edge-dash 0.8s linear infinite;
}

.flow-canvas :deep(.vue-flow__edge.is-debug-edge .vue-flow__edge-text) {
  fill: #1d4ed8;
}

.flow-canvas :deep(.vue-flow__edge.is-debug-edge .vue-flow__edge-textbg) {
  fill: #eff6ff;
}

@keyframes flow-edge-dash {
  to {
    stroke-dashoffset: -20;
  }
}
</style>
