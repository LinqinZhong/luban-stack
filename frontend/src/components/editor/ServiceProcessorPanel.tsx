import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  getMysqlLocalTableSchema,
  getServiceProcessors,
  saveServiceProcessors as saveServiceProcessorsApi,
} from '../../api/projects'
import {
  createEmptyProcessorMethod,
  createEmptyServiceProcessor,
  createDefaultMethodFlow,
  DATA_METHOD_OPERATION_OPTIONS,
  isValidProcessorName,
  type MethodFlow,
  type ProcessorLayerKind,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
  type ServiceProcessor,
} from '../../types/backend-services'
import type { DataTypeDef, DataTypeLibrary } from '../../types/data-types'
import type { MysqlColumnDef, MysqlIndexDef } from '../../types/mysql'
import { typeLabel, arrayTypeLabel, type DataFieldType } from '../../types/page-data'
import {
  buildPresetMethods,
  findMethodIncludingPresets,
  listPresetMethodNames,
  mergePresetAndCustomMethods,
  STATIC_PRESET_METHOD_NAMES,
} from '../../utils/data-preset-methods'
import { onMysqlSchemaChanged } from '../../utils/mysql-schema-events'
import EditBusinessMethodDialog, {
  type BusinessMethodEditPayload,
} from './EditBusinessMethodDialog'
import EditDataMethodDialog, {
  type DataMethodEditPayload,
} from './EditDataMethodDialog'
import type { DataMethodDebugTarget } from './DataMethodDebugPanel'
import type { MethodFlowDebugTarget } from './MethodFlowDebugPanel'
import MethodFlowEditor from './method-flow/MethodFlowEditor'
import DataMethodUsageDialog from './DataMethodUsageDialog'
import {
  countDataMethodUsages,
  type DataMethodUsageRef,
} from '../../utils/data-method-usage'
import './ServiceProcessorPanel.css'

export type ProcessorDebugTarget =
  | ({ kind: 'data' } & DataMethodDebugTarget)
  | ({ kind: 'flow' } & MethodFlowDebugTarget)

export function isSameProcessorDebugTarget(
  a: ProcessorDebugTarget | null | undefined,
  b: ProcessorDebugTarget | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (
    a.projectPath !== b.projectPath ||
    a.serviceId !== b.serviceId ||
    a.processorId !== b.processorId ||
    a.processorName !== b.processorName ||
    a.method.id !== b.method.id
  ) {
    return false
  }
  if (a.kind === 'flow' && b.kind === 'flow') {
    return a.selectedNodeId === b.selectedNodeId && a.mode === b.mode
  }
  return true
}

export type ProcessorSelectionState = {
  processorId: string
  methodId: string
  flowEditing: {
    processorId: string
    methodId: string
    focusNodeId?: string
  } | null
}

export type ServiceProcessorPanelHandle = {
  updateDebugParams: (params: Record<string, unknown>) => void
  applyFlowDebugCursor: (state: {
    cursorNodeId: string | null
    visitedNodeIds: string[]
    printByNode?: Record<string, string>
  }) => void
  openCreateDialog: () => void
  addMethod: () => void
  openFlowAt: (options: {
    processorId: string
    methodId: string
    focusNodeId?: string
  }) => boolean
}

type RestoredSelection = {
  processorId: string
  methodId: string
  flowEditing: {
    processorId: string
    methodId: string
    focusNodeId?: string
  } | null
} | null

export default forwardRef<
  ServiceProcessorPanelHandle,
  {
    projectPath: string
    serviceId: string
    layer: ProcessorLayerKind
    typeLibrary: DataTypeLibrary | null
    moduleOptions?: Array<{ id: string; name: string }>
    restored?: RestoredSelection
    onDebugTargetChange?: (target: ProcessorDebugTarget | null) => void
    onSelectionChange?: (state: ProcessorSelectionState) => void
    onNavigateUsage?: (ref: DataMethodUsageRef) => void
  }
>(function ServiceProcessorPanel(
  {
    projectPath,
    serviceId,
    layer,
    typeLibrary,
    moduleOptions,
    restored,
    onDebugTargetChange,
    onSelectionChange,
    onNavigateUsage,
  },
  ref,
) {
  const [processors, setProcessors] = useState<ServiceProcessor[]>([])
  const [dataLayerProcessors, setDataLayerProcessors] = useState<
    ServiceProcessor[]
  >([])
  const [activeProcessorId, setActiveProcessorId] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogVisible, setDialogVisible] = useState(false)
  const [dialogName, setDialogName] = useState('')
  const [dialogRemark, setDialogRemark] = useState('')
  const [dialogEntityRef, setDialogEntityRef] = useState('')
  const [dialogDataProcessorRef, setDialogDataProcessorRef] = useState('')
  const [editingProcessorId, setEditingProcessorId] = useState<string | null>(
    null,
  )

  const [dataMethodDialogVisible, setDataMethodDialogVisible] = useState(false)
  const [dataMethodEditIndex, setDataMethodEditIndex] = useState(-1)
  const [selectedMethodId, setSelectedMethodId] = useState('')

  const [usageDialogVisible, setUsageDialogVisible] = useState(false)
  const [usageTarget, setUsageTarget] = useState<{
    processorId: string
    methodId: string
    methodName: string
  } | null>(null)
  const [usageCountByMethodId, setUsageCountByMethodId] = useState<
    Record<string, number>
  >({})
  const usageCountSeq = useRef(0)

  const [businessMethodDialogVisible, setBusinessMethodDialogVisible] =
    useState(false)
  const [businessMethodEditIndex, setBusinessMethodEditIndex] = useState(-1)
  const [businessMethodDraft, setBusinessMethodDraft] =
    useState<ProcessorMethod | null>(null)

  const [flowEditing, setFlowEditing] = useState<{
    processorId: string
    methodId: string
    focusNodeId?: string
  } | null>(null)
  const [flowSelectedNodeId, setFlowSelectedNodeId] = useState<string | null>(
    null,
  )
  const [flowDebugCursorId, setFlowDebugCursorId] = useState<string | null>(null)
  const [flowDebugVisitedIds, setFlowDebugVisitedIds] = useState<string[]>([])
  const [flowDebugPrintByNode, setFlowDebugPrintByNode] = useState<
    Record<string, string>
  >({})

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydrating = useRef(false)
  const pendingRestore = useRef<RestoredSelection>(null)
  const processorsRef = useRef(processors)
  processorsRef.current = processors

  const isDataLayer = layer === 'data'
  const isBusinessLayer = layer === 'business'

  const activeProcessor =
    processors.find((p) => p.id === activeProcessorId) ?? null
  const storedMethods = activeProcessor?.methods ?? []

  const [tableSchemaCache, setTableSchemaCache] = useState<
    Record<string, { columns: MysqlColumnDef[]; indexes: MysqlIndexDef[] }>
  >({})

  function findEntityDef(entityRef: string): DataTypeDef | null {
    if (!entityRef) return null
    for (const group of typeLibrary?.groups ?? []) {
      const hit = group.types.find((t) => t.id === entityRef)
      if (hit) return hit
    }
    return null
  }

  async function loadTableSchema(tableName: string, force = false) {
    const name = tableName.trim()
    if (!name || !projectPath) return
    if (!force && tableSchemaCache[name]) return
    try {
      const res = await getMysqlLocalTableSchema({
        projectPath,
        tableName: name,
      })
      setTableSchemaCache((prev) => ({
        ...prev,
        [name]: {
          columns: res.columns ?? [],
          indexes: res.indexes ?? [],
        },
      }))
    } catch {
      setTableSchemaCache((prev) => ({
        ...prev,
        [name]: { columns: [], indexes: [] },
      }))
    }
  }

  function invalidateTableSchema(tableName: string) {
    const name = tableName.trim()
    if (!name) return
    setTableSchemaCache((prev) => {
      const next = { ...prev }
      delete next[name]
      return next
    })
    void loadTableSchema(name, true)
  }

  useEffect(() => {
    return onMysqlSchemaChanged((tableName) => {
      invalidateTableSchema(tableName)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function presetsForProcessor(proc: ServiceProcessor | null): ProcessorMethod[] {
    if (!proc?.entityRef) return []
    const entity = findEntityDef(proc.entityRef)
    const table = entity?.tableName?.trim() || ''
    if (!table) return []
    const schema = tableSchemaCache[table] ?? null
    return buildPresetMethods({
      entity,
      columns: schema?.columns ?? [],
      indexes: schema?.indexes ?? [],
    })
  }

  const presetMethods = isDataLayer ? presetsForProcessor(activeProcessor) : []

  const dataMethodReservedNames = useMemo(() => {
    const entity = findEntityDef(activeProcessor?.entityRef || '')
    const table = entity?.tableName?.trim() || ''
    const schema = table ? tableSchemaCache[table] : null
    const fromSchema = listPresetMethodNames(
      schema?.columns ?? [],
      schema?.indexes ?? [],
    )
    const fromVisible = presetMethods.map((m) => m.name.trim()).filter(Boolean)
    const editingId =
      dataMethodEditIndex >= 0 ? storedMethods[dataMethodEditIndex]?.id : undefined
    const selfName = editingId
      ? storedMethods.find((m) => m.id === editingId)?.name.trim()
      : ''
    const customOthers = storedMethods
      .filter((m) => m.id !== editingId)
      .map((m) => m.name.trim())
      .filter(Boolean)
    return [
      ...new Set([
        ...STATIC_PRESET_METHOD_NAMES,
        ...fromSchema,
        ...fromVisible,
        ...customOthers,
      ]),
    ].filter((n) => !selfName || n.toLowerCase() !== selfName.toLowerCase())
  }, [
    activeProcessor,
    tableSchemaCache,
    presetMethods,
    dataMethodEditIndex,
    storedMethods,
    typeLibrary,
  ])

  const activeEntitySchema = useMemo(() => {
    const entity = findEntityDef(activeProcessor?.entityRef || '')
    const table = entity?.tableName?.trim() || ''
    if (!table) return null
    return tableSchemaCache[table] ?? null
  }, [activeProcessor, tableSchemaCache, typeLibrary])

  const activeEntityTableName = useMemo(() => {
    const entity = findEntityDef(activeProcessor?.entityRef || '')
    return entity?.tableName?.trim() || ''
  }, [activeProcessor, typeLibrary])

  const methods = isDataLayer
    ? mergePresetAndCustomMethods(presetMethods, storedMethods)
    : storedMethods

  function enrichDataProcessors(list: ServiceProcessor[]): ServiceProcessor[] {
    return list.map((proc) => {
      const presets = presetsForProcessor(proc).filter((m) => !m.disabled)
      return {
        ...proc,
        methods: mergePresetAndCustomMethods(presets, proc.methods),
      }
    })
  }

  const enrichedDataLayerProcessors = enrichDataProcessors(dataLayerProcessors)

  useEffect(() => {
    const names = isDataLayer
      ? [findEntityDef(activeProcessor?.entityRef || '')?.tableName?.trim() || '']
      : dataLayerProcessors
          .map((p) => findEntityDef(p.entityRef)?.tableName?.trim() || '')
          .filter(Boolean)
    for (const name of names.filter(Boolean)) void loadTableSchema(name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLayer, activeProcessor?.entityRef, dataLayerProcessors, typeLibrary])

  const entityOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        if (t.kind !== 'interface' || t.category !== 'entity') continue
        if (!t.name.trim()) continue
        opts.push({
          id: t.id,
          label: t.remark ? `${t.name} · ${t.remark}` : t.name,
        })
      }
    }
    return opts
  }, [typeLibrary])

  const dataProcessorOptions = dataLayerProcessors.map((p) => ({
    id: p.id,
    label: p.remark ? `${p.name} · ${p.remark}` : p.name,
  }))

  const typeOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        if (!t.name.trim()) continue
        const kind =
          t.kind === 'enum'
            ? '枚举'
            : t.category === 'dto'
              ? 'DTO'
              : t.category === 'vo'
                ? 'VO'
                : t.category === 'entity'
                  ? '实体'
                  : t.kind === 'interface'
                    ? '对象'
                    : t.kind
        opts.push({
          id: t.id,
          label: `${t.name}（${kind}）${t.remark ? ` · ${t.remark}` : ''}`,
        })
      }
    }
    return opts
  }, [typeLibrary])

  function entityNameOnly(entityRef: string): string {
    if (!entityRef) return ''
    const def = findEntityDef(entityRef)
    if (def?.name?.trim()) return def.name.trim()
    return entityOptions.find((o) => o.id === entityRef)?.label ?? entityRef
  }

  function dataProcessorNameOnly(dataRef: string): string {
    if (!dataRef) return ''
    const hit = dataProcessorOptions.find((o) => o.id === dataRef)
    if (hit) {
      const name = processors.find((p) => p.id === dataRef)?.name?.trim()
      if (name) return name
      const raw = hit.label.trim()
      const cut = raw.indexOf(' · ')
      return cut >= 0 ? raw.slice(0, cut) : raw
    }
    return dataRef
  }

  function processorMethodCount(proc: ServiceProcessor): number {
    if (isDataLayer) {
      return mergePresetAndCustomMethods(
        presetsForProcessor(proc),
        proc.methods,
      ).length
    }
    return proc.methods.length
  }

  function processorBindValue(proc: ServiceProcessor): string {
    if (isDataLayer && proc.entityRef) {
      return entityNameOnly(proc.entityRef)
    }
    if (isBusinessLayer && proc.dataProcessorRef) {
      return dataProcessorNameOnly(proc.dataProcessorRef)
    }
    if (isDataLayer) {
      return findEntityDef(proc.entityRef)?.tableName?.trim() || ''
    }
    return ''
  }

  function typeDefById(id: string) {
    if (!id) return null
    for (const group of typeLibrary?.groups ?? []) {
      const hit = group.types.find((t) => t.id === id)
      if (hit) return hit
    }
    return null
  }

  function formatTypeWithGenerics(
    typeRef: string,
    args: Record<string, string>,
  ): string {
    const def = typeDefById(typeRef)
    if (!def?.name) return typeRef || '—'
    const names = (def.generics ?? []).map((g) => g.name.trim()).filter(Boolean)
    if (!names.length) return def.name
    const inner = names
      .map((n) => {
        const nextRef = args[n] ?? ''
        if (!nextRef) return 'any'
        return typeDefById(nextRef)?.name || nextRef
      })
      .join(', ')
    return `${def.name}<${inner}>`
  }

  function leafNamedRef(expr: ProcessorTypeExpr): string {
    if (expr.type === 'array' || expr.type === 'map') {
      if (expr.itemType === 'array') return expr.itemItemTypeRef || ''
      return expr.itemTypeRef || ''
    }
    return expr.typeRef || ''
  }

  function formatTypeExpr(expr: ProcessorTypeExpr): string {
    const named = leafNamedRef(expr)
    const namedLabel = named
      ? formatTypeWithGenerics(named, expr.genericArgs ?? {})
      : ''
    if (expr.type === 'map') {
      const keyLabel = expr.keyType === 'number' ? '数值' : '字符串'
      if (expr.itemType === 'array') {
        const leaf =
          namedLabel || typeLabel((expr.itemItemType || 'string') as DataFieldType)
        return `映射 / ${keyLabel} → ${arrayTypeLabel(leaf)}`
      }
      const leaf =
        namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
      return `映射 / ${keyLabel} → ${leaf}`
    }
    if (expr.type === 'array') {
      if (expr.itemType === 'array') {
        const leaf =
          namedLabel || typeLabel((expr.itemItemType || 'string') as DataFieldType)
        return arrayTypeLabel(leaf, 2)
      }
      const leaf =
        namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
      return arrayTypeLabel(leaf)
    }
    if (named) return namedLabel
    return typeLabel((expr.type || 'string') as DataFieldType)
  }

  function operationLabel(method: ProcessorMethod): string {
    if (method.dataConfig?.source === 'http') return '外部接口'
    const op = method.dataConfig?.operation
    return DATA_METHOD_OPERATION_OPTIONS.find((o) => o.value === op)?.label || '—'
  }

  function operationTagClass(method: ProcessorMethod): string {
    if (method.dataConfig?.source === 'http') return 'op-tag--http'
    const op = method.dataConfig?.operation || ''
    switch (op) {
      case 'query':
        return 'op-tag--query'
      case 'insert':
        return 'op-tag--insert'
      case 'batchInsert':
        return 'op-tag--batch'
      case 'update':
        return 'op-tag--update'
      case 'delete':
        return 'op-tag--delete'
      case 'custom':
        return 'op-tag--custom'
      default:
        return ''
    }
  }

  function paramsSummary(params: ProcessorMethodParam[]): string {
    if (!params.length) return '无'
    return params
      .map((p) => {
        const label = formatTypeExpr(p.typeExpr)
        return p.name ? `${p.name}: ${label}` : label
      })
      .join(', ')
  }

  function persistProcessors(nextProcessors = processors) {
    if (!projectPath || !serviceId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await saveServiceProcessorsApi({
          projectPath,
          serviceId,
          layer,
          processors: nextProcessors,
        })
        setProcessors(res.processors)
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存处理器失败')
      }
    }, 400)
  }

  function applyRestoredSelection(r: RestoredSelection, list: ServiceProcessor[]) {
    if (!r) return
    let nextActive = activeProcessorId
    if (r.processorId && list.some((p) => p.id === r.processorId)) {
      nextActive = r.processorId
      setActiveProcessorId(r.processorId)
    }
    const proc = list.find((p) => p.id === nextActive) ?? list[0] ?? null
    const presets = isDataLayer ? presetsForProcessor(proc) : []
    const visible = isDataLayer
      ? mergePresetAndCustomMethods(presets, proc?.methods ?? [])
      : (proc?.methods ?? [])
    if (r.methodId && visible.some((m) => m.id === r.methodId)) {
      setSelectedMethodId(r.methodId)
    }
    if (isBusinessLayer && r.flowEditing) {
      const fe = r.flowEditing
      const flowProc = list.find((p) => p.id === fe.processorId)
      if (flowProc?.methods.some((m) => m.id === fe.methodId)) {
        setFlowEditing({
          processorId: fe.processorId,
          methodId: fe.methodId,
          focusNodeId: fe.focusNodeId,
        })
        setFlowSelectedNodeId(fe.focusNodeId || 'start')
      }
    }
  }

  async function loadProcessors() {
    if (!projectPath || !serviceId) return
    pendingRestore.current = restored
      ? {
          processorId: restored.processorId,
          methodId: restored.methodId,
          flowEditing: restored.flowEditing ? { ...restored.flowEditing } : null,
        }
      : null
    hydrating.current = true
    setLoading(true)
    try {
      const res = await getServiceProcessors(projectPath, serviceId, layer)
      setProcessors(res.processors)
      if (layer === 'business') {
        const dataRes = await getServiceProcessors(projectPath, serviceId, 'data')
        setDataLayerProcessors(dataRes.processors)
      } else {
        setDataLayerProcessors([])
      }
      applyRestoredSelection(pendingRestore.current, res.processors)
      if (res.processors.length && pendingRestore.current?.processorId) {
        const prefer = pendingRestore.current.processorId
        if (res.processors.some((p) => p.id === prefer)) {
          setActiveProcessorId(prefer)
        }
      } else if (
        res.processors.length &&
        !res.processors.some((p) => p.id === activeProcessorId)
      ) {
        setActiveProcessorId(res.processors[0]!.id)
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载处理器失败')
      setProcessors([])
      setDataLayerProcessors([])
    } finally {
      setLoading(false)
      hydrating.current = false
      pendingRestore.current = null
    }
  }

  useEffect(() => {
    setFlowEditing(null)
    setSelectedMethodId('')
    if (projectPath && serviceId) void loadProcessors()
    else {
      setProcessors([])
      setDataLayerProcessors([])
      setActiveProcessorId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, serviceId, layer])

  useEffect(() => {
    if (!processors.length) {
      setActiveProcessorId('')
      return
    }
    const prefer = pendingRestore.current?.processorId
    if (prefer && processors.some((p) => p.id === prefer)) {
      setActiveProcessorId(prefer)
      return
    }
    if (!processors.some((p) => p.id === activeProcessorId)) {
      setActiveProcessorId(processors[0]!.id)
    }
  }, [processors, activeProcessorId])

  useEffect(() => {
    if (hydrating.current || !activeProcessorId) return
    onSelectionChange?.({
      processorId: activeProcessorId,
      methodId: selectedMethodId,
      flowEditing,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProcessorId, selectedMethodId, flowEditing])

  function openCreateDialog() {
    setEditingProcessorId(null)
    setDialogName('')
    setDialogRemark('')
    setDialogEntityRef('')
    setDialogDataProcessorRef('')
    setDialogVisible(true)
  }

  function openEditDialog(proc: ServiceProcessor) {
    setEditingProcessorId(proc.id)
    setDialogName(proc.name)
    setDialogRemark(proc.remark)
    setDialogEntityRef(proc.entityRef)
    setDialogDataProcessorRef(proc.dataProcessorRef)
    setDialogVisible(true)
  }

  function submitDialog() {
    const name = dialogName.trim()
    if (!name) {
      ElMessage.warning('请输入处理器名称')
      return
    }
    if (!isValidProcessorName(name)) {
      ElMessage.warning('名称须为英文大驼峰，如 GoodsProcessor')
      return
    }
    if (isDataLayer && !dialogEntityRef) {
      ElMessage.warning('数据层处理器必须绑定实体')
      return
    }
    const remark = dialogRemark.trim()
    const entityRef = isDataLayer ? dialogEntityRef : ''
    const dataProcessorRef = isBusinessLayer ? dialogDataProcessorRef : ''
    const nameTaken = processors.some(
      (p) =>
        p.name.trim().toLowerCase() === name.toLowerCase() &&
        p.id !== editingProcessorId,
    )
    if (nameTaken) {
      ElMessage.warning(`处理器名称「${name}」已存在`)
      return
    }

    let next = processors
    if (editingProcessorId) {
      next = processors.map((p) =>
        p.id === editingProcessorId
          ? { ...p, name, remark, entityRef, dataProcessorRef }
          : p,
      )
    } else {
      const created = {
        ...createEmptyServiceProcessor(name),
        remark,
        entityRef,
        dataProcessorRef,
      }
      next = [...processors, created]
      setActiveProcessorId(created.id)
    }
    setProcessors(next)
    setDialogVisible(false)
    persistProcessors(next)
  }

  async function removeProcessor(proc: ServiceProcessor) {
    try {
      await ElMessageBox.confirm(
        `确定删除处理器「${proc.name}」？其下方法将一并删除。`,
        '删除处理器',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    const next = processors.filter((p) => p.id !== proc.id)
    setProcessors(next)
    persistProcessors(next)
  }

  type ProcMenuCommand = 'edit' | 'delete'

  function handleProcMenu(command: ProcMenuCommand, proc: ServiceProcessor) {
    if (command === 'edit') openEditDialog(proc)
    else void removeProcessor(proc)
  }

  function patchActiveMethods(nextMethods: ProcessorMethod[]) {
    const id = activeProcessorId
    if (!id) return
    const next = processors.map((p) =>
      p.id === id ? { ...p, methods: nextMethods } : p,
    )
    setProcessors(next)
    persistProcessors(next)
  }

  function addMethod() {
    if (!activeProcessor) {
      ElMessage.warning('请先选择或创建处理器')
      return
    }
    if (isBusinessLayer) {
      openBusinessMethodDesign(-1)
      return
    }
    patchActiveMethods([
      ...storedMethods,
      createEmptyProcessorMethod(`method${storedMethods.length + 1}`),
    ])
  }

  function updateMethod(index: number, patch: Partial<ProcessorMethod>) {
    patchActiveMethods(
      storedMethods.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    )
  }

  function openBusinessMethodDesign(index: number) {
    if (!isBusinessLayer || !activeProcessor) return
    setBusinessMethodEditIndex(index)
    if (index < 0) {
      setBusinessMethodDraft(
        createEmptyProcessorMethod(`method${storedMethods.length + 1}`),
      )
    } else {
      const method = storedMethods[index]
      if (!method) return
      setSelectedMethodId(method.id)
      setFlowSelectedNodeId('start')
      setBusinessMethodDraft({
        ...method,
        params: method.params.map((p) => ({
          ...p,
          typeExpr: {
            ...p.typeExpr,
            genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
          },
        })),
        output: {
          ...method.output,
          genericArgs: { ...(method.output.genericArgs ?? {}) },
        },
      })
    }
    setBusinessMethodDialogVisible(true)
  }

  function saveBusinessMethodEdit(payload: BusinessMethodEditPayload) {
    if (businessMethodEditIndex < 0) {
      const base =
        businessMethodDraft ?? createEmptyProcessorMethod(payload.name)
      patchActiveMethods([
        ...storedMethods,
        {
          ...base,
          name: payload.name,
          remark: payload.remark,
          scope: payload.scope,
          params: payload.params,
          output: payload.output,
        },
      ])
    } else {
      updateMethod(businessMethodEditIndex, {
        name: payload.name,
        remark: payload.remark,
        scope: payload.scope,
        params: payload.params,
        output: payload.output,
      })
    }
    setBusinessMethodEditIndex(-1)
    setBusinessMethodDraft(null)
  }

  function openFlowEditor(index: number) {
    if (!isBusinessLayer || !activeProcessor) return
    const method = storedMethods[index]
    if (!method) return
    if (!method.flow?.nodes?.length) {
      updateMethod(index, { flow: createDefaultMethodFlow() })
    }
    setSelectedMethodId(method.id)
    setFlowSelectedNodeId('start')
    setFlowDebugCursorId(null)
    setFlowDebugVisitedIds([])
    setFlowDebugPrintByNode({})
    setFlowEditing({
      processorId: activeProcessor.id,
      methodId: method.id,
    })
  }

  function openFlowAt(options: {
    processorId: string
    methodId: string
    focusNodeId?: string
  }) {
    if (!isBusinessLayer) return false
    const list = processorsRef.current
    const proc = list.find((p) => p.id === options.processorId)
    if (!proc) return false
    const method = proc.methods.find((m) => m.id === options.methodId)
    if (!method) return false
    setActiveProcessorId(options.processorId)
    setSelectedMethodId(options.methodId)
    if (!method.flow?.nodes?.length) {
      const idx = proc.methods.findIndex((m) => m.id === options.methodId)
      if (idx >= 0) {
        const nextMethods = proc.methods.map((m, i) =>
          i === idx ? { ...m, flow: createDefaultMethodFlow() } : m,
        )
        const next = list.map((p) =>
          p.id === options.processorId ? { ...p, methods: nextMethods } : p,
        )
        setProcessors(next)
        persistProcessors(next)
      }
    }
    setFlowSelectedNodeId(options.focusNodeId || 'start')
    setFlowDebugCursorId(null)
    setFlowDebugVisitedIds([])
    setFlowDebugPrintByNode({})
    setFlowEditing({
      processorId: options.processorId,
      methodId: options.methodId,
      focusNodeId: options.focusNodeId,
    })
    return true
  }

  function closeFlowEditor() {
    setFlowEditing(null)
    setFlowSelectedNodeId(selectedMethodId ? 'start' : null)
    setFlowDebugCursorId(null)
    setFlowDebugVisitedIds([])
    setFlowDebugPrintByNode({})
  }

  function updateFlowMethod(flow: MethodFlow) {
    const ctx = flowEditing
    if (!ctx) return
    const next = processors.map((p) => {
      if (p.id !== ctx.processorId) return p
      return {
        ...p,
        methods: p.methods.map((m) =>
          m.id === ctx.methodId ? { ...m, flow } : m,
        ),
      }
    })
    setProcessors(next)
    persistProcessors(next)
  }

  async function removeMethod(index: number) {
    const target = methods[index]
    if (!target || target.preset) return
    try {
      await ElMessageBox.confirm(
        `确定删除方法「${target.name || target.id}」？`,
        '删除方法',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    patchActiveMethods(storedMethods.filter((m) => m.id !== target.id))
  }

  const editingDataMethod =
    dataMethodEditIndex < 0 ? null : (storedMethods[dataMethodEditIndex] ?? null)

  const selectedMethod = selectedMethodId
    ? findMethodIncludingPresets(
        storedMethods,
        selectedMethodId,
        presetMethods,
      ) ??
      methods.find((m) => m.id === selectedMethodId) ??
      null
    : null

  const flowEditingMethod = useMemo(() => {
    if (!flowEditing || !isBusinessLayer) return null
    const proc = processors.find((p) => p.id === flowEditing.processorId)
    return proc?.methods.find((m) => m.id === flowEditing.methodId) ?? null
  }, [flowEditing, isBusinessLayer, processors])

  const flowEditingFlow = flowEditingMethod?.flow ?? createDefaultMethodFlow()

  const dataDebugTarget: ProcessorDebugTarget | null =
    isDataLayer && activeProcessor && selectedMethod
      ? {
          kind: 'data',
          projectPath,
          serviceId,
          processorId: activeProcessor.id,
          processorName: activeProcessor.name,
          method: selectedMethod,
        }
      : null

  const flowDebugTarget: ProcessorDebugTarget | null = (() => {
    if (!isBusinessLayer) return null
    if (flowEditing && flowEditingMethod) {
      const proc = processors.find((p) => p.id === flowEditing.processorId)
      if (!proc) return null
      return {
        kind: 'flow',
        projectPath,
        serviceId,
        processorId: proc.id,
        processorName: proc.name,
        method: flowEditingMethod,
        flow: flowEditingFlow,
        selectedNodeId: flowSelectedNodeId,
        dataProcessors: enrichedDataLayerProcessors,
        businessProcessors: processors,
        mode: 'canvas',
      }
    }
    if (!activeProcessor || !selectedMethod) return null
    return {
      kind: 'flow',
      projectPath,
      serviceId,
      processorId: activeProcessor.id,
      processorName: activeProcessor.name,
      method: selectedMethod,
      flow: selectedMethod.flow ?? createDefaultMethodFlow(),
      selectedNodeId: flowSelectedNodeId || 'start',
      dataProcessors: enrichedDataLayerProcessors,
      businessProcessors: processors,
      mode: 'list',
    }
  })()

  const debugTarget = flowDebugTarget ?? dataDebugTarget
  const lastDebugTargetRef = useRef<ProcessorDebugTarget | null>(null)

  useEffect(() => {
    if (isSameProcessorDebugTarget(lastDebugTargetRef.current, debugTarget)) return
    lastDebugTargetRef.current = debugTarget
    onDebugTargetChange?.(debugTarget)
    // 父组件每次渲染都会换新回调，不能放进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugTarget])

  useEffect(() => {
    return () => {
      onDebugTargetChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onFlowDebugCursor(state: {
    cursorNodeId: string | null
    visitedNodeIds: string[]
    printByNode?: Record<string, string>
  }) {
    setFlowDebugCursorId(state.cursorNodeId)
    setFlowDebugVisitedIds(state.visitedNodeIds)
    setFlowDebugPrintByNode(state.printByNode ?? {})
  }

  async function refreshUsageCounts() {
    if (!isDataLayer || !projectPath || !serviceId) {
      setUsageCountByMethodId({})
      return
    }
    const processorId = activeProcessorId.trim()
    if (!processorId) {
      setUsageCountByMethodId({})
      return
    }
    const seq = ++usageCountSeq.current
    try {
      const counts = await countDataMethodUsages({
        projectPath,
        serviceId,
        dataProcessorId: processorId,
      })
      if (seq !== usageCountSeq.current) return
      setUsageCountByMethodId(counts)
    } catch {
      if (seq !== usageCountSeq.current) return
      setUsageCountByMethodId({})
    }
  }

  useEffect(() => {
    if (!isDataLayer) {
      setUsageCountByMethodId({})
      return
    }
    void refreshUsageCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isDataLayer,
    projectPath,
    serviceId,
    activeProcessorId,
    methods.map((m) => m.id).join(','),
  ])

  useEffect(() => {
    const prefer = pendingRestore.current?.methodId ?? restored?.methodId
    if (selectedMethodId && !methods.some((m) => m.id === selectedMethodId)) {
      setSelectedMethodId(
        prefer && methods.some((m) => m.id === prefer)
          ? prefer
          : (methods[0]?.id ?? ''),
      )
    } else if (!selectedMethodId && methods.length) {
      setSelectedMethodId(
        prefer && methods.some((m) => m.id === prefer) ? prefer : methods[0]!.id,
      )
    }
    if (isBusinessLayer && selectedMethodId && !flowEditing) {
      setFlowSelectedNodeId('start')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProcessorId, methods.map((m) => m.id).join(',')])

  function selectMethodRow(method: ProcessorMethod) {
    setSelectedMethodId(method.id)
    if (isBusinessLayer && !flowEditing) {
      setFlowSelectedNodeId('start')
      setFlowDebugCursorId(null)
      setFlowDebugVisitedIds([])
      setFlowDebugPrintByNode({})
    }
  }

  function openDataMethodUsage(row: ProcessorMethod) {
    if (!isDataLayer || !activeProcessor) return
    setUsageTarget({
      processorId: activeProcessor.id,
      methodId: row.id,
      methodName: row.name || row.id,
    })
    setUsageDialogVisible(true)
  }

  function onUsageJump(usageRef: DataMethodUsageRef) {
    onNavigateUsage?.(usageRef)
    void refreshUsageCounts()
  }

  function openDataMethodDialog(row: ProcessorMethod) {
    if (!isDataLayer || row.preset) return
    const index = storedMethods.findIndex((m) => m.id === row.id)
    if (index < 0) return
    setDataMethodEditIndex(index)
    setSelectedMethodId(row.id)
    const table = activeEntityTableName
    if (table) void loadTableSchema(table)
    setDataMethodDialogVisible(true)
  }

  function saveDataMethodEdit(payload: DataMethodEditPayload) {
    if (dataMethodEditIndex < 0) return
    updateMethod(dataMethodEditIndex, {
      name: payload.name,
      params: payload.params,
      output: payload.output,
      dataConfig: payload.dataConfig,
    })
    setDataMethodEditIndex(-1)
  }

  function updateDebugParams(params: Record<string, unknown>) {
    if (isBusinessLayer && flowEditing) {
      const ctx = flowEditing
      const next = processors.map((p) => {
        if (p.id !== ctx.processorId) return p
        return {
          ...p,
          methods: p.methods.map((m) =>
            m.id === ctx.methodId ? { ...m, debugParams: { ...params } } : m,
          ),
        }
      })
      setProcessors(next)
      persistProcessors(next)
      return
    }
    const id = selectedMethodId
    if (!id) return
    if (presetMethods.some((m) => m.id === id)) return
    const index = storedMethods.findIndex((m) => m.id === id)
    if (index < 0) return
    updateMethod(index, { debugParams: { ...params } })
  }

  useImperativeHandle(ref, () => ({
    updateDebugParams,
    applyFlowDebugCursor: onFlowDebugCursor,
    openCreateDialog,
    addMethod,
    openFlowAt,
  }))

  const layerLabel = layer === 'business' ? '业务层' : '数据层'
  const businessMethodReservedNames = storedMethods
    .filter((_, i) => i !== businessMethodEditIndex)
    .map((m) => m.name.trim())
    .filter(Boolean)

  const methodColumns = [
    {
      title: '名称',
      key: 'name',
      minWidth: 140,
      render: (_: unknown, row: ProcessorMethod) => (
        <span className={`cell-text${row.preset ? ' preset-name' : ''}`}>
          {row.name || '—'}
        </span>
      ),
    },
    {
      title: '说明',
      key: 'remark',
      minWidth: 120,
      render: (_: unknown, row: ProcessorMethod) => (
        <span className="cell-text muted">{row.remark || '—'}</span>
      ),
    },
    ...(isBusinessLayer
      ? [
          {
            title: '作用域',
            key: 'scope',
            width: 80,
            align: 'center' as const,
            render: (_: unknown, row: ProcessorMethod) => (
              <span className="cell-text">
                {row.scope === 'private' ? '私有' : '公共'}
              </span>
            ),
          },
        ]
      : []),
    ...(isDataLayer
      ? [
          {
            title: '操作',
            key: 'operation',
            width: 96,
            align: 'center' as const,
            render: (_: unknown, row: ProcessorMethod) => (
              <span className={`op-tag ${operationTagClass(row)}`}>
                {operationLabel(row)}
              </span>
            ),
          },
        ]
      : []),
    {
      title: '入参',
      key: 'params',
      minWidth: 160,
      render: (_: unknown, row: ProcessorMethod) => (
        <span className="cell-text muted">{paramsSummary(row.params)}</span>
      ),
    },
    {
      title: '出参',
      key: 'output',
      minWidth: 160,
      render: (_: unknown, row: ProcessorMethod) => (
        <span className="cell-text">{formatTypeExpr(row.output)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: unknown, row: ProcessorMethod, index: number) => (
        <>
          {isDataLayer && (usageCountByMethodId[row.id] ?? 0) > 0 ? (
            <Button type="link" onClick={(e) => {
              e.stopPropagation()
              openDataMethodUsage(row)
            }}>
              {`查看使用(${usageCountByMethodId[row.id] ?? 0})`}
            </Button>
          ) : null}
          {isDataLayer && !row.preset ? (
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                openDataMethodDialog(row)
              }}
            >
              编辑
            </Button>
          ) : null}
          {isBusinessLayer ? (
            <>
              <Button
                type="link"
                icon={<SettingOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  openBusinessMethodDesign(index)
                }}
              >
                设计
              </Button>
              <Button
                type="link"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  openFlowEditor(index)
                }}
              >
                编辑
              </Button>
            </>
          ) : null}
          {!row.preset ? (
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={(e) => {
                e.stopPropagation()
                void removeMethod(index)
              }}
            >
              删除
            </Button>
          ) : null}
        </>
      ),
    },
  ]

  if (isBusinessLayer && flowEditing && flowEditingMethod) {
    return (
      <MethodFlowEditor
        key={`${flowEditing.processorId}:${flowEditing.methodId}:${flowEditing.focusNodeId || ''}`}
        methodName={flowEditingMethod.name}
        flow={flowEditingFlow}
        methodParams={flowEditingMethod.params}
        methodOutput={flowEditingMethod.output}
        dataProcessors={enrichedDataLayerProcessors}
        businessProcessors={processors}
        currentProcessorId={flowEditing.processorId}
        currentMethodId={flowEditing.methodId}
        boundDataProcessorId={
          processors.find((p) => p.id === flowEditing.processorId)
            ?.dataProcessorRef ?? ''
        }
        currentServiceId={serviceId}
        moduleOptions={moduleOptions ?? []}
        projectPath={projectPath}
        typeLibrary={typeLibrary}
        debugCursorId={flowDebugCursorId}
        debugVisitedIds={flowDebugVisitedIds}
        debugPrintByNode={flowDebugPrintByNode}
        focusNodeId={flowEditing.focusNodeId || null}
        onBack={closeFlowEditor}
        onFlowChange={updateFlowMethod}
        onSelectedNodeChange={setFlowSelectedNodeId}
      />
    )
  }

  return (
    <div className="proc-workspace">
      <aside className="proc-pane">
        {loading ? (
          <div style={{ padding: 12 }}>
            <Skeleton active paragraph={{ rows: 4 }} />
          </div>
        ) : !processors.length ? (
          <Empty description="暂无处理器，点击顶部创建" styles={{ image: { height: 56 } }} />
        ) : (
          <ul className="proc-list">
            {processors.map((proc) => (
              <Dropdown
                key={proc.id}
                trigger={['contextMenu']}
                menu={{
                  items: [
                    { key: 'edit', label: '编辑' },
                    { type: 'divider' },
                    { key: 'delete', label: '删除', danger: true },
                  ],
                  onClick: ({ key }) =>
                    handleProcMenu(key as ProcMenuCommand, proc),
                }}
              >
                <li
                  className={`proc-item${proc.id === activeProcessorId ? ' active' : ''}`}
                  onClick={() => setActiveProcessorId(proc.id)}
                  onDoubleClick={() => openEditDialog(proc)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <div className="proc-name" title={proc.name}>
                    {proc.name}
                  </div>
                  <div className="proc-meta">
                    <span
                      className={`proc-bind${!processorBindValue(proc) ? ' proc-bind--empty' : ''}`}
                      title={processorBindValue(proc) || undefined}
                    >
                      {processorBindValue(proc) || '—'}
                    </span>
                    <span className="proc-count">
                      {processorMethodCount(proc)}个方法
                    </span>
                  </div>
                  <div className="proc-desc" title={proc.remark || undefined}>
                    {proc.remark || '—'}
                  </div>
                </li>
              </Dropdown>
            ))}
          </ul>
        )}
      </aside>

      <section className="method-pane">
        {!activeProcessor ? (
          <Empty description="请选择或创建左侧处理器" styles={{ image: { height: 64 } }} />
        ) : (
          <div className={`method-table${isDataLayer ? ' data-layer' : ''}`}>
            <Table
              dataSource={methods}
              columns={methodColumns}
              bordered
              size="small"
              pagination={false}
              rowKey="id"
              locale={{ emptyText: '暂无方法，点击顶部创建' }}
              rowClassName={(row) =>
                row.id === selectedMethodId ? 'is-selected-row' : ''
              }
              onRow={(row) => ({
                onClick: () => selectMethodRow(row),
              })}
            />
          </div>
        )}
      </section>

      <Modal
        open={dialogVisible}
        title={`${layerLabel} · 处理器`}
        width={440}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setDialogVisible(false)}
        footer={
          <Button type="primary" onClick={submitDialog}>
            确定
          </Button>
        }
      >
        <Form
          labelCol={{ style: { width: 100 } }}
          onSubmitCapture={(e) => {
            e.preventDefault()
            submitDialog()
          }}
        >
          <Form.Item label="名称" required>
            <Input
              value={dialogName}
              placeholder="英文大驼峰，如 GoodsProcessor"
              maxLength={64}
              autoFocus
              onChange={(e) => setDialogName(e.target.value)}
            />
            <p className="field-hint">仅英文，须大驼峰（PascalCase）</p>
          </Form.Item>
          {isDataLayer ? (
            <Form.Item label="绑定实体" required>
              <Select
                showSearch
                placeholder="选择实体类型"
                style={{ width: '100%' }}
                value={dialogEntityRef || undefined}
                options={entityOptions.map((opt) => ({
                  label: opt.label,
                  value: opt.id,
                }))}
                onChange={setDialogEntityRef}
              />
              {!entityOptions.length ? (
                <p className="field-hint">
                  暂无实体，请先在「数据类型」中添加对象 / 实体
                </p>
              ) : null}
            </Form.Item>
          ) : null}
          {isBusinessLayer ? (
            <Form.Item label="绑定数据层">
              <Select
                allowClear
                showSearch
                placeholder="可选，绑定数据层处理器"
                style={{ width: '100%' }}
                value={dialogDataProcessorRef || undefined}
                options={dataProcessorOptions.map((opt) => ({
                  label: opt.label,
                  value: opt.id,
                }))}
                onChange={(value) => setDialogDataProcessorRef(value ?? '')}
              />
              {!dataProcessorOptions.length ? (
                <p className="field-hint">暂无数据层处理器，可先创建数据层</p>
              ) : null}
            </Form.Item>
          ) : null}
          <Form.Item label="说明">
            <Input.TextArea
              value={dialogRemark}
              rows={2}
              placeholder="可选说明"
              maxLength={256}
              onChange={(e) => setDialogRemark(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>

      {isBusinessLayer ? (
        <EditBusinessMethodDialog
          open={businessMethodDialogVisible}
          onOpenChange={setBusinessMethodDialogVisible}
          method={businessMethodDraft}
          typeLibrary={typeLibrary}
          typeOptions={typeOptions}
          reservedNames={businessMethodReservedNames}
          onSave={saveBusinessMethodEdit}
        />
      ) : null}
      {isDataLayer ? (
        <EditDataMethodDialog
          open={dataMethodDialogVisible}
          onOpenChange={setDataMethodDialogVisible}
          method={editingDataMethod}
          typeLibrary={typeLibrary}
          typeOptions={typeOptions}
          entityRef={activeProcessor?.entityRef}
          entityTableName={activeEntityTableName}
          entityColumns={activeEntitySchema?.columns}
          entityIndexes={activeEntitySchema?.indexes}
          reservedNames={dataMethodReservedNames}
          onSave={saveDataMethodEdit}
        />
      ) : null}
      {isDataLayer && usageTarget ? (
        <DataMethodUsageDialog
          open={usageDialogVisible}
          onOpenChange={setUsageDialogVisible}
          projectPath={projectPath}
          serviceId={serviceId}
          dataProcessorId={usageTarget.processorId}
          dataMethodId={usageTarget.methodId}
          dataMethodName={usageTarget.methodName}
          onJump={onUsageJump}
        />
      ) : null}
    </div>
  )
})
