import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PlusOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
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
import { readConditionGroupsFromData } from '../../../utils/data-method-conditions'
import InputNodeDialog from './dialogs/InputNodeDialog'
import {
  createEmptyInputNodeForm,
  normalizeInputDataSource,
  readInputNetworkFromData,
  type InputModuleOption,
  type InputNodeForm,
} from './dialogs/input-node'
import {
  createEmptyOutputNodeForm,
  readOutputNetworkFromData,
  type OutputNodeForm,
} from './dialogs/output-node'
import { normalizeIoChannel } from './dialogs/network-request'
import BranchNodeDialog from './dialogs/BranchNodeDialog'
import ActionNodeDialog, {
  type ActionNodeForm,
} from './dialogs/ActionNodeDialog'
import OutputNodeDialog from './dialogs/OutputNodeDialog'
import DefineNodeDialog, {
  type DefineNodeForm,
} from './dialogs/DefineNodeDialog'
import PageMapNodeDialog, {
  type PageMapNodeForm,
} from './dialogs/PageMapNodeDialog'
import ObjectMapNodeDialog, {
  type ObjectMapNodeForm,
} from './dialogs/ObjectMapNodeDialog'
import EndNodeDialog, { type EndNodeForm } from './dialogs/EndNodeDialog'
import ThrowNodeDialog, {
  type ThrowNodeForm,
} from './dialogs/ThrowNodeDialog'
import AddFlowNodeDialog from './dialogs/AddFlowNodeDialog'
import StartNodeDialog from './dialogs/StartNodeDialog'
import { FlowDebugContext } from './flow-debug-inject'
import FlowHelperLines from './FlowHelperLines'
import { getHelperLines } from './helper-lines'
import BackLink from '../BackLink'
import { getServiceProcessors } from '../../../api/projects'
import StartNode from './nodes/StartNode'
import InputNode from './nodes/InputNode'
import BranchNode from './nodes/BranchNode'
import ActionNode from './nodes/ActionNode'
import OutputNode from './nodes/OutputNode'
import DefineNode from './nodes/DefineNode'
import PageMapNode from './nodes/PageMapNode'
import ObjectMapNode from './nodes/ObjectMapNode'
import ThrowNode from './nodes/ThrowNode'
import EndNode from './nodes/EndNode'
import './MethodFlowEditor.css'

const methodFlowNodeTypes: NodeTypes = {
  start: StartNode,
  input: InputNode,
  branch: BranchNode,
  action: ActionNode,
  output: OutputNode,
  define: DefineNode,
  pageMap: PageMapNode,
  objectMap: ObjectMapNode,
  throw: ThrowNode,
  end: EndNode,
}

const FLOW_ID = 'method-flow-editor'

type FlowGraphNode = Node<Record<string, unknown>>
type FlowGraphEdge = Edge

export default function MethodFlowEditor(props: MethodFlowEditorProps) {
  return (
    <ReactFlowProvider>
      <MethodFlowEditorInner {...props} />
    </ReactFlowProvider>
  )
}

type MethodFlowEditorProps = {
  methodName: string
  titleKind?: string
  flow: MethodFlow
  methodParams: ProcessorMethodParam[]
  methodOutput: ProcessorTypeExpr
  dataProcessors: ServiceProcessor[]
  businessProcessors?: ServiceProcessor[]
  currentProcessorId?: string
  currentMethodId?: string
  boundDataProcessorId?: string
  currentServiceId?: string
  moduleOptions?: InputModuleOption[]
  projectPath?: string
  inputSourceMode?: 'all' | 'business'
  typeLibrary?: DataTypeLibrary | null
  debugCursorId?: string | null
  debugVisitedIds?: string[]
  debugPrintByNode?: Record<string, string>
  focusNodeId?: string | null
  onBack?: () => void
  onFlowChange?: (flow: MethodFlow) => void
  onSelectedNodeChange?: (nodeId: string | null) => void
}

function MethodFlowEditorInner({
  methodName,
  titleKind,
  flow,
  methodParams,
  methodOutput,
  dataProcessors,
  businessProcessors,
  currentProcessorId,
  currentMethodId,
  currentServiceId,
  moduleOptions,
  projectPath,
  inputSourceMode,
  typeLibrary,
  debugCursorId,
  debugVisitedIds,
  debugPrintByNode,
  focusNodeId,
  onBack,
  onFlowChange,
  onSelectedNodeChange,
}: MethodFlowEditorProps) {
  const { getNodes, fitView } = useReactFlow()

  const [helperLineHorizontal, setHelperLineHorizontal] = useState<
    number | undefined
  >(undefined)
  const [helperLineVertical, setHelperLineVertical] = useState<
    number | undefined
  >(undefined)

  const [remoteProcessorsByService, setRemoteProcessorsByService] = useState(
    () => new Map<string, { data: ServiceProcessor[]; business: ServiceProcessor[] }>(),
  )

  const methodHasReturn = useMemo(() => {
    const t = (methodOutput?.type || '').trim()
    if (!t || t === 'void') return false
    return true
  }, [methodOutput])

  const methodOutputLabel = useMemo(() => {
    if (!methodOutput || !methodHasReturn) return 'void'
    return processorTypeExprToTs(methodOutput, typeLibrary) || '—'
  }, [methodOutput, methodHasReturn, typeLibrary])

  function enrichNodeData(
    kind: string,
    data: Record<string, unknown>,
    needsReturn = methodHasReturn,
  ): Record<string, unknown> {
    if (kind === 'end') {
      return { ...data, needsReturn }
    }
    return data
  }

  function stripUiOnlyData(data: Record<string, unknown>): Record<string, unknown> {
    const next = { ...data }
    delete next.needsReturn
    return next
  }

  function flowToNodes(src: MethodFlow): FlowGraphNode[] {
    return src.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { ...n.position },
      data: enrichNodeData(n.kind, { ...n.data }),
      deletable: n.kind !== 'start',
    }))
  }

  function flowToEdges(src: MethodFlow): FlowGraphEdge[] {
    return src.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle || 'default',
      label: e.label,
    }))
  }

  function ensureFlow(src: MethodFlow | undefined | null): MethodFlow {
    return src?.nodes?.length ? src : createDefaultMethodFlow()
  }

  function sameJson(a: unknown, b: unknown): boolean {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }

  const [nodes, setNodes] = useState<FlowGraphNode[]>(() => {
    const focusId = (focusNodeId ?? '').trim()
    return flowToNodes(ensureFlow(flow)).map((n) => {
      if (focusId) return { ...n, selected: n.id === focusId }
      return { ...n, selected: n.type === 'start' }
    })
  })
  const [edges, setEdges] = useState<FlowGraphEdge[]>(() =>
    flowToEdges(ensureFlow(flow)),
  )

  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges

  const debugVisitedIdsRef = useRef(debugVisitedIds)
  debugVisitedIdsRef.current = debugVisitedIds

  const hasInitialFocus = Boolean((focusNodeId ?? '').trim())

  const selectedKey = nodes
    .filter((n) => n.selected)
    .map((n) => n.id)
    .join(',')

  useEffect(() => {
    const selected = nodesRef.current.find((n) => n.selected)
    onSelectedNodeChange?.(selected?.id ?? null)
  }, [selectedKey, onSelectedNodeChange])

  function debugActiveEdgeIds(list: FlowGraphEdge[]): Set<string> {
    const visited = debugVisitedIdsRef.current ?? []
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

  function withDebugEdgeStyles(list: FlowGraphEdge[]): FlowGraphEdge[] {
    const active = debugActiveEdgeIds(list)
    let needsReplace = false
    for (const e of list) {
      const on = active.has(e.id)
      const cls = on ? 'is-debug-edge' : undefined
      if (e.animated !== on || e.className !== cls) {
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
        className: on ? 'is-debug-edge' : undefined,
        style: on
          ? { stroke: '#1d4ed8', strokeWidth: 2.5 }
          : { stroke: '#b1b3b8', strokeWidth: 1.5 },
      }
    })
  }

  function patchDebugEdgeStyles() {
    setEdges((prev) => {
      const next = withDebugEdgeStyles(prev)
      return next === prev ? prev : next
    })
  }

  useEffect(() => {
    patchDebugEdgeStyles()
  }, [(debugVisitedIds ?? []).join('\0')])

  useEffect(() => {
    if (!debugCursorId) return
    setNodes((prev) => {
      let changed = false
      const next = prev.map((n) => {
        const sel = n.id === debugCursorId
        if (n.selected !== sel) {
          changed = true
          return { ...n, selected: sel }
        }
        return n
      })
      if (changed) onSelectedNodeChange?.(debugCursorId)
      return changed ? next : prev
    })
  }, [debugCursorId, onSelectedNodeChange])

  function onNodesChange(changes: NodeChange[]) {
    setHelperLineHorizontal(undefined)
    setHelperLineVertical(undefined)

    if (
      changes.length === 1 &&
      changes[0]!.type === 'position' &&
      changes[0]!.dragging &&
      changes[0]!.position
    ) {
      const helper = getHelperLines(changes[0], getNodes())
      changes[0]!.position.x = helper.snapPosition.x ?? changes[0]!.position.x
      changes[0]!.position.y = helper.snapPosition.y ?? changes[0]!.position.y
      setHelperLineHorizontal(helper.horizontal)
      setHelperLineVertical(helper.vertical)
    }

    setNodes((nds) => applyNodeChanges(changes, nds) as FlowGraphNode[])
  }

  function onEdgesChange(changes: EdgeChange[]) {
    setEdges(
      (eds) =>
        withDebugEdgeStyles(
          applyEdgeChanges(changes, eds) as FlowGraphEdge[],
        ),
    )
  }

  const syncingFromPropsRef = useRef(false)
  const lastEmittedRef = useRef(serializeFlowSnapshot(ensureFlow(flow)))

  function serializeFlowSnapshot(src: MethodFlow): string {
    return JSON.stringify({
      nodes: src.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        position: {
          x: Number(n.position.x) || 0,
          y: Number(n.position.y) || 0,
        },
        data: stripUiOnlyData({ ...(n.data as Record<string, unknown>) }),
      })),
      edges: src.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle:
          e.sourceHandle && e.sourceHandle !== 'default'
            ? e.sourceHandle
            : undefined,
        label: e.label || undefined,
      })),
    })
  }

  function serializeFlow(src: MethodFlow): string {
    return serializeFlowSnapshot(src)
  }

  function currentFlow(): MethodFlow {
    return {
      nodes: nodesRef.current.map((n) => ({
        id: n.id,
        kind: (n.type || 'action') as FlowNodeKind,
        position: { x: n.position.x, y: n.position.y },
        data: stripUiOnlyData({ ...(n.data as Record<string, unknown>) }),
      })),
      edges: edgesRef.current.map((e) => {
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
    if (syncingFromPropsRef.current) return
    const next = currentFlow()
    const serialized = serializeFlow(next)
    if (serialized === lastEmittedRef.current) return
    lastEmittedRef.current = serialized
    onFlowChange?.(next)
  }

  function syncNodesFromFlow(src: MethodFlow) {
    setNodes((prevNodes) => {
      const incoming = flowToNodes(src)
      const prevById = new Map<string, FlowGraphNode>()
      for (const n of prevNodes) prevById.set(n.id, n)
      const incomingIds = new Set(incoming.map((n) => n.id))
      const structureChanged =
        incoming.length !== prevNodes.length ||
        incoming.some((n, i) => prevNodes[i]?.id !== n.id) ||
        prevNodes.some((n) => !incomingIds.has(n.id))

      const merged = incoming.map((n) => {
        const prev = prevById.get(n.id)
        if (!prev) return n
        let next: FlowGraphNode = prev
        if (prev.type !== n.type) next = { ...next, type: n.type }
        if (prev.deletable !== n.deletable) next = { ...next, deletable: n.deletable }
        if (
          prev.position.x !== n.position.x ||
          prev.position.y !== n.position.y
        ) {
          next = { ...next, position: { x: n.position.x, y: n.position.y } }
        }
        if (!sameJson(prev.data, n.data)) {
          next = { ...next, data: n.data }
        }
        return next
      })

      if (structureChanged) return merged
      const changed = merged.some((n, i) => n !== prevNodes[i])
      return changed ? merged : prevNodes
    })
  }

  function syncEdgesFromFlow(src: MethodFlow) {
    setEdges((prevEdges) => {
      const incoming = flowToEdges(src)
      const prevById = new Map(prevEdges.map((e) => [e.id, e]))
      const incomingIds = new Set(incoming.map((e) => e.id))
      const structureChanged =
        incoming.length !== prevEdges.length ||
        incoming.some((e, i) => prevEdges[i]?.id !== e.id) ||
        prevEdges.some((e) => !incomingIds.has(e.id))

      const merged = incoming.map((e) => {
        const prev = prevById.get(e.id)
        if (!prev) return e
        return {
          ...prev,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          label: e.label,
        }
      })
      const next = structureChanged
        ? merged
        : merged.some((e, i) => e !== prevEdges[i])
          ? merged
          : prevEdges
      return withDebugEdgeStyles(next)
    })
  }

  const incomingSnapshot = serializeFlowSnapshot(ensureFlow(flow))

  useEffect(() => {
    if (incomingSnapshot === lastEmittedRef.current) return
    if (incomingSnapshot === serializeFlowSnapshot(currentFlow())) {
      lastEmittedRef.current = incomingSnapshot
      return
    }
    syncingFromPropsRef.current = true
    lastEmittedRef.current = incomingSnapshot
    syncNodesFromFlow(ensureFlow(flow))
    syncEdgesFromFlow(ensureFlow(flow))
    queueMicrotask(() => {
      syncingFromPropsRef.current = false
    })
  }, [incomingSnapshot])

  useEffect(() => {
    emitFlow()
  }, [nodes, edges])

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) return
    if (connection.source === connection.target) return
    const sourceNode = nodesRef.current.find((n) => n.id === connection.source)
    if (sourceNode?.type === 'end') return
    const sourceHandle = connection.sourceHandle || 'default'
    setEdges((prev) => [
      ...prev,
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
    ])
  }

  function uid(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  }

  function pickInsertPosition(): { x: number; y: number } {
    const selected = nodesRef.current.find((n) => n.selected)
    if (selected) {
      return { x: selected.position.x, y: selected.position.y + 120 }
    }
    const start = nodesRef.current.find((n) => n.type === 'start')
    if (start) {
      return { x: start.position.x, y: start.position.y + 120 }
    }
    return { x: 280, y: 160 }
  }

  function defaultDataForKind(
    kind: Exclude<FlowNodeKind, 'start'>,
  ): Record<string, unknown> {
    switch (kind) {
      case 'input':
        return {
          serviceId: currentServiceId ?? '',
          dataSource: inputSourceMode === 'business' ? 'business' : 'data',
          dataProcessorId: '',
          dataMethodId: '',
          headerField: '',
          varName: '',
          methodLabel: '',
          paramBindings: {},
          conditionGroups: [],
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
          needsReturn: methodHasReturn,
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
      nodesRef.current.find((n) => n.selected) ??
      nodesRef.current.find((n) => n.type === 'start')
    const fromId = from?.id
    const fromType = from?.type

    const skipAutoEdge = fromType === 'end' || fromType === 'throw'

    setNodes((prev) => [
      ...prev,
      {
        id,
        type: kind,
        position,
        data,
        deletable: true,
      },
    ])

    if (fromId && fromId !== id && !skipAutoEdge) {
      const sourceHandle = fromType === 'branch' ? 'true' : 'default'
      setEdges((prev) => [
        ...prev,
        {
          id: uid('edge'),
          source: fromId,
          target: id,
          sourceHandle,
          label: sourceHandle === 'true' ? '是' : undefined,
        },
      ])
    }
  }

  const [addNodeDialogVisible, setAddNodeDialogVisible] = useState(false)
  const [inputDialogVisible, setInputDialogVisible] = useState(false)
  const [branchDialogVisible, setBranchDialogVisible] = useState(false)
  const [actionDialogVisible, setActionDialogVisible] = useState(false)
  const [outputDialogVisible, setOutputDialogVisible] = useState(false)
  const [defineDialogVisible, setDefineDialogVisible] = useState(false)
  const [pageMapDialogVisible, setPageMapDialogVisible] = useState(false)
  const [objectMapDialogVisible, setObjectMapDialogVisible] = useState(false)
  const [throwDialogVisible, setThrowDialogVisible] = useState(false)
  const [endDialogVisible, setEndDialogVisible] = useState(false)
  const [startDialogVisible, setStartDialogVisible] = useState(false)
  const [editingNodeId, setEditingNodeId] = useState('')

  const [editingInputForm, setEditingInputForm] = useState<InputNodeForm>(() =>
    createEmptyInputNodeForm({
      serviceId: '',
      dataSource: 'data',
    }),
  )
  const [editingExpression, setEditingExpression] = useState('')
  const [editingBranchPrintExpr, setEditingBranchPrintExpr] = useState('')
  const [editingStartPrintExpr, setEditingStartPrintExpr] = useState('')
  const [editingActionForm, setEditingActionForm] = useState<ActionNodeForm>({
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
  const [editingOutputForm, setEditingOutputForm] = useState<OutputNodeForm>(
    createEmptyOutputNodeForm(),
  )
  const [editingDefineForm, setEditingDefineForm] = useState<DefineNodeForm>({
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
  const [editingPageMapForm, setEditingPageMapForm] = useState<PageMapNodeForm>({
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
  const [editingObjectMapForm, setEditingObjectMapForm] =
    useState<ObjectMapNodeForm>({
      sourcePath: '',
      targetTypeRef: '',
      targetGenericArgs: {},
      targetVarName: '',
      fieldMappings: [],
      description: '',
      printExpr: '',
    })
  const [editingEndForm, setEditingEndForm] = useState<EndNodeForm>({
    returnExpr: '',
    printExpr: '',
  })
  const [editingThrowForm, setEditingThrowForm] = useState<ThrowNodeForm>({
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
    const tsType = processorTypeExprToTs(typeExpr, typeLibrary)
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
    const tsType = processorTypeExprToTs(typeExpr, typeLibrary)
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
    const tsType = processorTypeExprToTs(typeExpr, typeLibrary)
    return {
      name: varName,
      type: 'object',
      typeExpr,
      ...(tsType ? { tsType } : {}),
    }
  }

  function objectMapToParam(data: Record<string, unknown>): MethodParam | null {
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
    const tsType = processorTypeExprToTs(typeExpr, typeLibrary)
    return {
      name: varName,
      type: 'object',
      typeExpr,
      ...(tsType ? { tsType } : {}),
    }
  }

  const reservedNames = useMemo(() => {
    const names = methodParams.map((p) => p.name.trim()).filter(Boolean)
    for (const n of nodes) {
      if (n.id === editingNodeId) continue
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
  }, [methodParams, nodes, editingNodeId])

  function findDataMethod(processorId: string, methodId: string) {
    if (!processorId || !methodId) return null
    const proc = dataProcessors.find((p) => p.id === processorId)
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
    if (!sid || sid === (currentServiceId ?? '')) {
      return {
        data: dataProcessors,
        business: businessProcessors ?? [],
      }
    }
    return (
      remoteProcessorsByService.get(sid) ?? { data: [], business: [] }
    )
  }

  const remoteServiceKey = useMemo(() => {
    const ids: string[] = []
    for (const n of nodes) {
      if (n.type !== 'input') continue
      const d = (n.data ?? {}) as Record<string, unknown>
      const sid = typeof d.serviceId === 'string' ? d.serviceId.trim() : ''
      if (sid && sid !== currentServiceId) ids.push(sid)
    }
    return ids.sort().join('|')
  }, [nodes, currentServiceId])

  useEffect(() => {
    const path = typeof projectPath === 'string' ? projectPath.trim() : ''
    if (!path) return
    const needed = new Set<string>()
    for (const n of nodesRef.current) {
      if (n.type !== 'input') continue
      const d = (n.data ?? {}) as Record<string, unknown>
      const sid = typeof d.serviceId === 'string' ? d.serviceId.trim() : ''
      if (sid && sid !== currentServiceId) needed.add(sid)
    }
    let cancelled = false
    void (async () => {
      let changed = false
      const next = new Map(remoteProcessorsByService)
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
      if (changed && !cancelled) setRemoteProcessorsByService(next)
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath, currentServiceId, remoteServiceKey])

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
        tsType: processorTypeExprToTs(saved, typeLibrary),
        typeExpr: saved,
      }
    }
    const processorId =
      typeof data.dataProcessorId === 'string' ? data.dataProcessorId : ''
    const methodId = typeof data.dataMethodId === 'string' ? data.dataMethodId : ''
    const serviceId =
      (typeof data.serviceId === 'string' ? data.serviceId.trim() : '') ||
      currentServiceId ||
      ''
    void remoteProcessorsByService
    const { data: dataList, business: bizList } = processorsForService(serviceId)
    const method =
      findProcessorMethodIn(dataList, processorId, methodId) ??
      findProcessorMethodIn(bizList, processorId, methodId)
    if (method?.output) {
      return {
        name: varName,
        type: processorTypeExprToMethodParamType(method.output),
        tsType: processorTypeExprToTs(method.output, typeLibrary),
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
        tsType: processorTypeExprToTs(method.output, typeLibrary),
        typeExpr: method.output,
      }
    }
    return {
      name: varName,
      type: 'any',
      typeExpr: coarseToProcessorTypeExpr('any'),
    }
  }

  const ambientVars = useMemo((): MethodParam[] => {
    const vars: MethodParam[] = methodParams
      .filter((p) => p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        type: processorTypeExprToMethodParamType(p.typeExpr),
        tsType: processorTypeExprToTs(p.typeExpr, typeLibrary),
        typeExpr: p.typeExpr,
      }))
    for (const n of nodes) {
      const data = (n.data ?? {}) as Record<string, unknown>
      if (n.type === 'input') {
        if (n.id === editingNodeId && inputDialogVisible) continue
        const param = inputNodeToParam(data)
        if (!param) continue
        if (vars.some((v) => v.name === param.name)) continue
        vars.push(param)
        continue
      }
      if (n.type === 'output') {
        if (n.id === editingNodeId && outputDialogVisible) continue
        const param = outputNodeToParam(data)
        if (!param) continue
        if (vars.some((v) => v.name === param.name)) continue
        vars.push(param)
        continue
      }
      if (n.type === 'define') {
        if (n.id === editingNodeId && defineDialogVisible) continue
        const param = defineToParam(data)
        if (!param) continue
        if (vars.some((v) => v.name === param.name)) continue
        vars.push(param)
        continue
      }
      if (n.type === 'action') {
        if (n.id === editingNodeId && actionDialogVisible) continue
        const param = actionOutputToParam(data)
        if (!param) continue
        if (vars.some((v) => v.name === param.name)) continue
        vars.push(param)
        continue
      }
      if (n.type === 'pageMap') {
        if (n.id === editingNodeId && pageMapDialogVisible) continue
        const param = pageMapToParam(data)
        if (!param) continue
        if (vars.some((v) => v.name === param.name)) continue
        vars.push(param)
        continue
      }
      if (n.type === 'objectMap') {
        if (n.id === editingNodeId && objectMapDialogVisible) continue
        const param = objectMapToParam(data)
        if (!param) continue
        if (vars.some((v) => v.name === param.name)) continue
        vars.push(param)
      }
    }
    return vars
  }, [
    methodParams,
    nodes,
    editingNodeId,
    inputDialogVisible,
    outputDialogVisible,
    defineDialogVisible,
    actionDialogVisible,
    pageMapDialogVisible,
    objectMapDialogVisible,
    typeLibrary,
    remoteProcessorsByService,
    dataProcessors,
    businessProcessors,
    currentServiceId,
  ])

  const ambientExtra = useMemo(
    () => buildTypeLibraryAmbientDeclarations(typeLibrary),
    [typeLibrary],
  )

  const ambientHint = useMemo(
    () => ambientVars.map((v) => v.name).join(', ') || '（暂无）',
    [ambientVars],
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
    const businessOnly = inputSourceMode === 'business'
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
    return currentServiceId ?? ''
  }

  function openNodeEditor(node: Node) {
    if (node.type === 'start') {
      setEditingNodeId(node.id)
      const data = (node.data ?? {}) as Record<string, unknown>
      setEditingStartPrintExpr(
        typeof data.printExpr === 'string' ? data.printExpr : '',
      )
      setStartDialogVisible(true)
      return
    }
    if (node.type === 'end') {
      setEditingNodeId(node.id)
      const data = (node.data ?? {}) as Record<string, unknown>
      setEditingEndForm({
        returnExpr: typeof data.returnExpr === 'string' ? data.returnExpr : '',
        printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
      })
      setEndDialogVisible(true)
      return
    }
    if (node.type === 'throw') {
      setEditingNodeId(node.id)
      const data = (node.data ?? {}) as Record<string, unknown>
      setEditingThrowForm({
        messageExpr:
          typeof data.messageExpr === 'string' ? data.messageExpr : '',
        printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
      })
      setThrowDialogVisible(true)
      return
    }
    setEditingNodeId(node.id)
    const data = (node.data ?? {}) as Record<string, unknown>
    if (node.type === 'input') {
      setEditingInputForm(
        createEmptyInputNodeForm({
          channel: normalizeIoChannel(data.channel),
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
          conditionGroups: readConditionGroupsFromData(data),
          printExpr: typeof data.printExpr === 'string' ? data.printExpr : '',
          network: readInputNetworkFromData(data),
        }),
      )
      setInputDialogVisible(true)
    } else if (node.type === 'branch') {
      setEditingExpression(
        typeof data.expression === 'string' ? data.expression : '',
      )
      setEditingBranchPrintExpr(
        typeof data.printExpr === 'string' ? data.printExpr : '',
      )
      setBranchDialogVisible(true)
    } else if (node.type === 'action') {
      const outputTypeRaw =
        typeof data.outputType === 'string' ? data.outputType : 'void'
      setEditingActionForm({
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
      })
      setActionDialogVisible(true)
    } else if (node.type === 'output') {
      setEditingOutputForm(
        createEmptyOutputNodeForm({
          channel: normalizeIoChannel(data.channel),
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
          network: readOutputNetworkFromData(data),
        }),
      )
      setOutputDialogVisible(true)
    } else if (node.type === 'define') {
      const valueTypeRaw =
        typeof data.valueType === 'string' ? data.valueType : 'any'
      setEditingDefineForm({
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
      })
      setDefineDialogVisible(true)
    } else if (node.type === 'pageMap') {
      setEditingPageMapForm({
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
      })
      setPageMapDialogVisible(true)
    } else if (node.type === 'objectMap') {
      setEditingObjectMapForm({
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
      })
      setObjectMapDialogVisible(true)
    }
  }

  function onNodeDoubleClick(_event: React.MouseEvent, node: Node) {
    openNodeEditor(node)
  }

  function patchNodeData(id: string, patch: Record<string, unknown>) {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? {
              ...n,
              data: { ...(n.data as Record<string, unknown>), ...patch },
            }
          : n,
      ),
    )
  }

  function saveInputNode(formValue: InputNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, { ...formValue })
  }

  function saveBranchNode(payload: { expression: string; printExpr: string }) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, {
      expression: payload.expression,
      printExpr: payload.printExpr,
    })
  }

  function saveStartNode(payload: { printExpr: string }) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, { printExpr: payload.printExpr })
  }

  function saveActionNode(formValue: ActionNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, { ...formValue })
  }

  function saveOutputNode(formValue: OutputNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, {
      ...formValue,
      dtoTypeRef: '',
      dtoLabel: '',
    })
  }

  function saveDefineNode(formValue: DefineNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, { ...formValue })
  }

  function savePageMapNode(formValue: PageMapNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, { ...formValue })
  }

  function saveObjectMapNode(formValue: ObjectMapNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, { ...formValue })
  }

  function saveEndNode(formValue: EndNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, {
      returnExpr: formValue.returnExpr,
      printExpr: formValue.printExpr,
      needsReturn: methodHasReturn,
    })
  }

  function saveThrowNode(formValue: ThrowNodeForm) {
    if (!editingNodeId) return
    patchNodeData(editingNodeId, {
      messageExpr: formValue.messageExpr,
      printExpr: formValue.printExpr,
    })
  }

  useEffect(() => {
    setNodes((prev) => {
      let changed = false
      const next = prev.map((n) => {
        if (n.type !== 'end') return n
        const data: Record<string, unknown> = {
          ...(n.data as Record<string, unknown>),
          needsReturn: methodHasReturn,
        }
        if (!methodHasReturn) data.returnExpr = ''
        if (sameJson(n.data, data)) return n
        changed = true
        return { ...n, data }
      })
      return changed ? next : prev
    })
  }, [methodHasReturn])

  const onKeyDown = useCallback((event: KeyboardEvent) => {
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
    const selectedNodeIds = nodesRef.current
      .filter((n) => n.selected && n.type !== 'start')
      .map((n) => n.id)
    const selectedEdgeIds = edgesRef.current
      .filter((e) => e.selected)
      .map((e) => e.id)
    if (!selectedNodeIds.length && !selectedEdgeIds.length) return
    event.preventDefault()
    if (selectedNodeIds.length) {
      const remove = new Set(selectedNodeIds)
      setNodes((prev) => prev.filter((n) => !remove.has(n.id)))
      setEdges((prev) =>
        prev.filter((e) => !remove.has(e.source) && !remove.has(e.target)),
      )
    }
    if (selectedEdgeIds.length) {
      const remove = new Set(selectedEdgeIds)
      setEdges((prev) => prev.filter((e) => !remove.has(e.id)))
    }
  }, [])

  const applyFocusNode = useCallback(
    (nodeId: string | null | undefined) => {
      const id = (nodeId ?? '').trim()
      if (!id) return false
      if (!nodesRef.current.some((n) => n.id === id)) return false
      setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })))
      onSelectedNodeChange?.(id)
      queueMicrotask(() => {
        try {
          const targets = getNodes().filter((n) => n.id === id)
          if (targets.length) {
            fitView({
              nodes: targets,
              padding: 0.4,
              duration: 280,
              maxZoom: 1.15,
            })
          } else {
            fitView({
              nodes: [{ id } as Node],
              padding: 0.4,
              duration: 280,
              maxZoom: 1.15,
            })
          }
        } catch {
          /* ignore */
        }
      })
      return true
    },
    [fitView, getNodes, onSelectedNodeChange],
  )

  function onInit() {
    const focusId = (focusNodeId ?? '').trim()
    if (!focusId) return
    window.setTimeout(() => {
      applyFocusNode(focusId)
    }, 80)
  }

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    const focusId = (focusNodeId ?? '').trim()
    if (focusId) {
      applyFocusNode(focusId)
    } else if (!nodesRef.current.some((n) => n.selected)) {
      const start = nodesRef.current.find((n) => n.type === 'start')
      if (start) {
        setNodes((prev) =>
          prev.map((n) => ({
            ...n,
            selected: n.id === start.id,
          })),
        )
      }
    }
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (focusNodeId) {
      window.setTimeout(() => applyFocusNode(focusNodeId), 0)
    }
  }, [focusNodeId, applyFocusNode])

  const debugValue = useMemo(
    () => ({
      cursorId: debugCursorId,
      visitedIds: debugVisitedIds,
      printByNode: debugPrintByNode,
    }),
    [debugCursorId, debugVisitedIds, debugPrintByNode],
  )

  return (
    <FlowDebugContext.Provider value={debugValue}>
      <div className="method-flow-editor">
        <header className="flow-toolbar">
          <div className="toolbar-left">
            <BackLink onClick={() => onBack?.()} />
            <span className="method-title">
              {titleKind || '方法'} {methodName || '未命名'}
            </span>
          </div>
        </header>

        <div className="flow-canvas">
          <div className="flow-stage-toolbar">
            <Tooltip title="添加节点" placement="left">
              <Button
                type="primary"
                shape="circle"
                icon={<PlusOutlined />}
                onClick={() => setAddNodeDialogVisible(true)}
              />
            </Tooltip>
          </div>
          <ReactFlow
            id={FLOW_ID}
            nodes={nodes}
            edges={edges}
            nodeTypes={methodFlowNodeTypes}
            fitView={!hasInitialFocus}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            disableKeyboardA11y
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={onNodeDoubleClick}
            onInit={onInit}
          >
            <Background color="#e4e7ed" gap={18} />
            <Controls />
            <FlowHelperLines
              horizontal={helperLineHorizontal}
              vertical={helperLineVertical}
            />
          </ReactFlow>
        </div>

        <AddFlowNodeDialog
          open={addNodeDialogVisible}
          onOpenChange={setAddNodeDialogVisible}
          onSelect={addFlowNode}
        />
        <InputNodeDialog
          open={inputDialogVisible}
          onOpenChange={setInputDialogVisible}
          form={editingInputForm}
          projectPath={projectPath ?? ''}
          currentServiceId={currentServiceId ?? ''}
          moduleOptions={moduleOptions ?? []}
          businessProcessors={businessProcessors ?? []}
          dataProcessors={dataProcessors}
          currentProcessorId={currentProcessorId ?? ''}
          currentMethodId={currentMethodId ?? ''}
          sourceMode={inputSourceMode ?? 'all'}
          reservedNames={reservedNames}
          ambientVars={ambientVars}
          typeLibrary={typeLibrary}
          onSave={saveInputNode}
        />
        <BranchNodeDialog
          open={branchDialogVisible}
          onOpenChange={setBranchDialogVisible}
          expression={editingExpression}
          printExpr={editingBranchPrintExpr}
          ambientHint={ambientHint}
          onSave={saveBranchNode}
        />
        <StartNodeDialog
          open={startDialogVisible}
          onOpenChange={setStartDialogVisible}
          printExpr={editingStartPrintExpr}
          onSave={saveStartNode}
        />
        <ActionNodeDialog
          open={actionDialogVisible}
          onOpenChange={setActionDialogVisible}
          form={editingActionForm}
          ambientVars={ambientVars}
          ambientExtra={ambientExtra}
          ambientHint={ambientHint}
          typeLibrary={typeLibrary}
          reservedNames={reservedNames}
          onSave={saveActionNode}
        />
        <OutputNodeDialog
          open={outputDialogVisible}
          onOpenChange={setOutputDialogVisible}
          form={editingOutputForm}
          dataProcessors={dataProcessors}
          reservedNames={reservedNames}
          ambientVars={ambientVars}
          typeLibrary={typeLibrary}
          onSave={saveOutputNode}
        />
        <DefineNodeDialog
          open={defineDialogVisible}
          onOpenChange={setDefineDialogVisible}
          form={editingDefineForm}
          typeLibrary={typeLibrary}
          reservedNames={reservedNames}
          onSave={saveDefineNode}
        />
        <PageMapNodeDialog
          open={pageMapDialogVisible}
          onOpenChange={setPageMapDialogVisible}
          form={editingPageMapForm}
          ambientVars={ambientVars}
          typeLibrary={typeLibrary}
          onSave={savePageMapNode}
        />
        <ObjectMapNodeDialog
          open={objectMapDialogVisible}
          onOpenChange={setObjectMapDialogVisible}
          form={editingObjectMapForm}
          ambientVars={ambientVars}
          typeLibrary={typeLibrary}
          onSave={saveObjectMapNode}
        />
        <ThrowNodeDialog
          open={throwDialogVisible}
          onOpenChange={setThrowDialogVisible}
          form={editingThrowForm}
          ambientHint={ambientHint}
          onSave={saveThrowNode}
        />
        <EndNodeDialog
          open={endDialogVisible}
          onOpenChange={setEndDialogVisible}
          form={editingEndForm}
          requireReturn={methodHasReturn}
          outputTypeLabel={methodOutputLabel}
          outputType={methodOutput}
          ambientVars={ambientVars}
          typeLibrary={typeLibrary}
          onSave={saveEndNode}
        />
      </div>
    </FlowDebugContext.Provider>
  )
}
