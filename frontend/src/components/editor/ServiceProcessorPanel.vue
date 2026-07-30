<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { Delete, EditPen, SetUp } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
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
  type MethodFlow,
  type ProcessorLayerKind,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
  type ServiceProcessor,
} from '../../types/backend-services'
import type { DataTypeDef, DataTypeLibrary } from '../../types/data-types'
import type { MysqlColumnDef, MysqlIndexDef } from '../../types/mysql'
import { typeLabel, type DataFieldType } from '../../types/page-data'
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
} from './EditBusinessMethodDialog.vue'
import EditDataMethodDialog, {
  type DataMethodEditPayload,
} from './EditDataMethodDialog.vue'
import type { DataMethodDebugTarget } from './DataMethodDebugPanel.vue'
import type { MethodFlowDebugTarget } from './MethodFlowDebugPanel.vue'
import MethodFlowEditor from './method-flow/MethodFlowEditor.vue'

const props = defineProps<{
  projectPath: string
  serviceId: string
  layer: ProcessorLayerKind
  typeLibrary: DataTypeLibrary | null
  /** 刷新 / 切层后恢复选中 */
  restored?: {
    processorId: string
    methodId: string
    flowEditing: { processorId: string; methodId: string } | null
  } | null
}>()

export type ProcessorDebugTarget =
  | ({ kind: 'data' } & DataMethodDebugTarget)
  | ({ kind: 'flow' } & MethodFlowDebugTarget)

export type ProcessorSelectionState = {
  processorId: string
  methodId: string
  flowEditing: { processorId: string; methodId: string } | null
}

const emit = defineEmits<{
  'update:debug-target': [target: ProcessorDebugTarget | null]
  'update:selection': [state: ProcessorSelectionState]
}>()

const processors = ref<ServiceProcessor[]>([])
const dataLayerProcessors = ref<ServiceProcessor[]>([])
const activeProcessorId = ref('')
const loading = ref(false)
const dialogVisible = ref(false)
const dialogName = ref('')
const dialogRemark = ref('')
const dialogEntityRef = ref('')
const dialogDataProcessorRef = ref('')
const editingProcessorId = ref<string | null>(null)

const dataMethodDialogVisible = ref(false)
const dataMethodEditIndex = ref(-1)
const selectedMethodId = ref('')

const businessMethodDialogVisible = ref(false)
const businessMethodEditIndex = ref(-1)
const businessMethodDraft = ref<ProcessorMethod | null>(null)

/** 业务层：工作流编辑中的方法 */
const flowEditing = ref<{ processorId: string; methodId: string } | null>(
  null,
)
const flowSelectedNodeId = ref<string | null>(null)
const flowDebugCursorId = ref<string | null>(null)
const flowDebugVisitedIds = ref<string[]>([])
const flowDebugPrintByNode = ref<Record<string, string>>({})

let saveTimer: ReturnType<typeof setTimeout> | null = null

const isDataLayer = computed(() => props.layer === 'data')
const isBusinessLayer = computed(() => props.layer === 'business')

const flowEditingMethod = computed(() => {
  const ctx = flowEditing.value
  if (!ctx || !isBusinessLayer.value) return null
  const proc = processors.value.find((p) => p.id === ctx.processorId)
  return proc?.methods.find((m) => m.id === ctx.methodId) ?? null
})

const flowEditingFlow = computed(
  () => flowEditingMethod.value?.flow ?? createDefaultMethodFlow(),
)

const layerLabel = computed(() =>
  props.layer === 'business' ? '业务层' : '数据层',
)

const activeProcessor = computed(
  () => processors.value.find((p) => p.id === activeProcessorId.value) ?? null,
)

/** 落盘的自定义方法 */
const storedMethods = computed(() => activeProcessor.value?.methods ?? [])

const tableSchemaCache = ref<
  Record<string, { columns: MysqlColumnDef[]; indexes: MysqlIndexDef[] }>
>({})

function findEntityDef(entityRef: string): DataTypeDef | null {
  if (!entityRef) return null
  for (const group of props.typeLibrary?.groups ?? []) {
    const hit = group.types.find((t) => t.id === entityRef)
    if (hit) return hit
  }
  return null
}

async function loadTableSchema(tableName: string, force = false) {
  const name = tableName.trim()
  if (!name || !props.projectPath) return
  if (!force && tableSchemaCache.value[name]) return
  try {
    const res = await getMysqlLocalTableSchema({
      projectPath: props.projectPath,
      tableName: name,
    })
    tableSchemaCache.value = {
      ...tableSchemaCache.value,
      [name]: {
        columns: res.columns ?? [],
        indexes: res.indexes ?? [],
      },
    }
  } catch {
    tableSchemaCache.value = {
      ...tableSchemaCache.value,
      [name]: { columns: [], indexes: [] },
    }
  }
}

function invalidateTableSchema(tableName: string) {
  const name = tableName.trim()
  if (!name) return
  const next = { ...tableSchemaCache.value }
  delete next[name]
  tableSchemaCache.value = next
  void loadTableSchema(name, true)
}

const stopMysqlSchemaWatch = onMysqlSchemaChanged((tableName) => {
  invalidateTableSchema(tableName)
})
onBeforeUnmount(() => {
  stopMysqlSchemaWatch()
})

function presetsForProcessor(proc: ServiceProcessor | null): ProcessorMethod[] {
  if (!proc?.entityRef) return []
  const entity = findEntityDef(proc.entityRef)
  const table = entity?.tableName?.trim() || ''
  const schema = table ? tableSchemaCache.value[table] : null
  return buildPresetMethods({
    entity,
    columns: schema?.columns ?? [],
    indexes: schema?.indexes ?? [],
  })
}

const presetMethods = computed(() =>
  isDataLayer.value ? presetsForProcessor(activeProcessor.value) : [],
)

/** 自定义方法禁止占用的预置名 */
const dataMethodReservedNames = computed(() => {
  const entity = findEntityDef(activeProcessor.value?.entityRef || '')
  const table = entity?.tableName?.trim() || ''
  const schema = table ? tableSchemaCache.value[table] : null
  const fromSchema = listPresetMethodNames(
    schema?.columns ?? [],
    schema?.indexes ?? [],
  )
  const fromVisible = presetMethods.value.map((m) => m.name.trim()).filter(Boolean)
  const editingId =
    dataMethodEditIndex.value >= 0
      ? storedMethods.value[dataMethodEditIndex.value]?.id
      : undefined
  const selfName = editingId
    ? storedMethods.value.find((m) => m.id === editingId)?.name.trim()
    : ''
  const customOthers = storedMethods.value
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
})

/** 展示用：预置 + 自定义（同名自定义覆盖预置） */
const methods = computed(() =>
  isDataLayer.value
    ? mergePresetAndCustomMethods(presetMethods.value, storedMethods.value)
    : storedMethods.value,
)

function enrichDataProcessors(
  list: ServiceProcessor[],
): ServiceProcessor[] {
  return list.map((proc) => {
    const presets = presetsForProcessor(proc).filter((m) => !m.disabled)
    return {
      ...proc,
      methods: mergePresetAndCustomMethods(presets, proc.methods),
    }
  })
}

/** 业务流选用：带预置方法的数据层处理器 */
const enrichedDataLayerProcessors = computed(() =>
  enrichDataProcessors(dataLayerProcessors.value),
)

watch(
  () => {
    if (!isDataLayer.value) {
      return dataLayerProcessors.value
        .map((p) => findEntityDef(p.entityRef)?.tableName?.trim() || '')
        .filter(Boolean)
        .join(',')
    }
    const entity = findEntityDef(activeProcessor.value?.entityRef || '')
    return entity?.tableName?.trim() || ''
  },
  (tables) => {
    const names = tables.split(',').filter(Boolean)
    for (const name of names) void loadTableSchema(name)
  },
  { immediate: true },
)

const entityOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
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
})

const dataProcessorOptions = computed(() =>
  dataLayerProcessors.value.map((p) => ({
    id: p.id,
    label: p.remark ? `${p.name} · ${p.remark}` : p.name,
  })),
)

const typeOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
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
                  ? '接口'
                  : t.kind
      opts.push({
        id: t.id,
        label: `${t.name}（${kind}）${t.remark ? ` · ${t.remark}` : ''}`,
      })
    }
  }
  return opts
})

function entityLabel(ref: string): string {
  if (!ref) return ''
  return entityOptions.value.find((o) => o.id === ref)?.label ?? ref
}

function dataProcessorLabel(ref: string): string {
  if (!ref) return ''
  return dataProcessorOptions.value.find((o) => o.id === ref)?.label ?? ref
}

function processorSub(proc: ServiceProcessor): string {
  if (isDataLayer.value && proc.entityRef) {
    return entityLabel(proc.entityRef)
  }
  if (isBusinessLayer.value && proc.dataProcessorRef) {
    return dataProcessorLabel(proc.dataProcessorRef)
  }
  return proc.remark
}

function typeDefById(id: string) {
  if (!id) return null
  for (const group of props.typeLibrary?.groups ?? []) {
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
  const names = (def.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
  if (!names.length) return def.name
  const inner = names
    .map((n) => {
      const ref = args[n] ?? ''
      if (!ref) return 'any'
      return typeDefById(ref)?.name || ref
    })
    .join(', ')
  return `${def.name}<${inner}>`
}

function leafNamedRef(expr: ProcessorTypeExpr): string {
  if (expr.type === 'array') {
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
  if (expr.type === 'array') {
    if (expr.itemType === 'array') {
      const leaf =
        namedLabel ||
        typeLabel((expr.itemItemType || 'string') as DataFieldType)
      return `数组 / 数组 / ${leaf}`
    }
    const leaf =
      namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
    return `数组 / ${leaf}`
  }
  if (named) return namedLabel
  return typeLabel((expr.type || 'string') as DataFieldType)
}

function operationLabel(method: ProcessorMethod): string {
  const op = method.dataConfig?.operation
  return (
    DATA_METHOD_OPERATION_OPTIONS.find((o) => o.value === op)?.label || '—'
  )
}

function operationTagClass(method: ProcessorMethod): string {
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

/** 加载中：避免把 flowEditing=null 写回父级，冲掉 localStorage 恢复值 */
const hydrating = ref(false)
const pendingRestore = ref<{
  processorId: string
  methodId: string
  flowEditing: { processorId: string; methodId: string } | null
} | null>(null)

watch(
  () => [props.projectPath, props.serviceId, props.layer] as const,
  ([path, id]) => {
    flowEditing.value = null
    selectedMethodId.value = ''
    if (path && id) void loadProcessors()
    else {
      processors.value = []
      dataLayerProcessors.value = []
      activeProcessorId.value = ''
    }
  },
  { immediate: true },
)

watch(
  processors,
  (list) => {
    if (!list.length) {
      activeProcessorId.value = ''
      return
    }
    const prefer = pendingRestore.value?.processorId
    if (prefer && list.some((p) => p.id === prefer)) {
      activeProcessorId.value = prefer
      return
    }
    if (!list.some((p) => p.id === activeProcessorId.value)) {
      activeProcessorId.value = list[0]!.id
    }
  },
  { deep: true },
)

watch(
  () =>
    ({
      processorId: activeProcessorId.value,
      methodId: selectedMethodId.value,
      flowEditing: flowEditing.value,
    }) satisfies ProcessorSelectionState,
  (state) => {
    if (hydrating.value || !state.processorId) return
    emit('update:selection', {
      processorId: state.processorId,
      methodId: state.methodId,
      flowEditing: state.flowEditing,
    })
  },
  { deep: true },
)

function applyRestoredSelection(
  r: {
    processorId: string
    methodId: string
    flowEditing: { processorId: string; methodId: string } | null
  } | null,
) {
  if (!r) return
  if (r.processorId && processors.value.some((p) => p.id === r.processorId)) {
    activeProcessorId.value = r.processorId
  }
  const preferMethod = r.methodId
  if (preferMethod && methods.value.some((m) => m.id === preferMethod)) {
    selectedMethodId.value = preferMethod
  }
  if (isBusinessLayer.value && r.flowEditing) {
    const fe = r.flowEditing
    const proc = processors.value.find((p) => p.id === fe.processorId)
    if (proc?.methods.some((m) => m.id === fe.methodId)) {
      flowEditing.value = { processorId: fe.processorId, methodId: fe.methodId }
      flowSelectedNodeId.value = 'start'
    }
  }
}

async function loadProcessors() {
  if (!props.projectPath || !props.serviceId) return
  // 快照：后续 await 期间父级 props.restored 可能被中间态 emit 冲掉
  pendingRestore.value = props.restored
    ? {
        processorId: props.restored.processorId,
        methodId: props.restored.methodId,
        flowEditing: props.restored.flowEditing
          ? { ...props.restored.flowEditing }
          : null,
      }
    : null
  hydrating.value = true
  loading.value = true
  try {
    const res = await getServiceProcessors(
      props.projectPath,
      props.serviceId,
      props.layer,
    )
    processors.value = res.processors
    if (props.layer === 'business') {
      const dataRes = await getServiceProcessors(
        props.projectPath,
        props.serviceId,
        'data',
      )
      dataLayerProcessors.value = dataRes.processors
    } else {
      dataLayerProcessors.value = []
    }
    applyRestoredSelection(pendingRestore.value)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载处理器失败')
    processors.value = []
    dataLayerProcessors.value = []
  } finally {
    loading.value = false
    hydrating.value = false
    if (activeProcessorId.value) {
      emit('update:selection', {
        processorId: activeProcessorId.value,
        methodId: selectedMethodId.value,
        flowEditing: flowEditing.value,
      })
    }
    pendingRestore.value = null
  }
}

function persistProcessors() {
  if (!props.projectPath || !props.serviceId) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      const res = await saveServiceProcessorsApi({
        projectPath: props.projectPath,
        serviceId: props.serviceId,
        layer: props.layer,
        processors: processors.value,
      })
      processors.value = res.processors
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存处理器失败')
    }
  }, 400)
}

function openCreateDialog() {
  editingProcessorId.value = null
  dialogName.value = ''
  dialogRemark.value = ''
  dialogEntityRef.value = ''
  dialogDataProcessorRef.value = ''
  dialogVisible.value = true
}

function openEditDialog(proc: ServiceProcessor) {
  editingProcessorId.value = proc.id
  dialogName.value = proc.name
  dialogRemark.value = proc.remark
  dialogEntityRef.value = proc.entityRef
  dialogDataProcessorRef.value = proc.dataProcessorRef
  dialogVisible.value = true
}

function submitDialog() {
  const name = dialogName.value.trim()
  if (!name) {
    ElMessage.warning('请输入处理器名称')
    return
  }
  if (isDataLayer.value && !dialogEntityRef.value) {
    ElMessage.warning('数据层处理器必须绑定实体')
    return
  }
  const remark = dialogRemark.value.trim()
  const entityRef = isDataLayer.value ? dialogEntityRef.value : ''
  const dataProcessorRef = isBusinessLayer.value
    ? dialogDataProcessorRef.value
    : ''
  const nameTaken = processors.value.some(
    (p) =>
      p.name.trim().toLowerCase() === name.toLowerCase() &&
      p.id !== editingProcessorId.value,
  )
  if (nameTaken) {
    ElMessage.warning(`处理器名称「${name}」已存在`)
    return
  }

  if (editingProcessorId.value) {
    processors.value = processors.value.map((p) =>
      p.id === editingProcessorId.value
        ? { ...p, name, remark, entityRef, dataProcessorRef }
        : p,
    )
  } else {
    const next = {
      ...createEmptyServiceProcessor(name),
      remark,
      entityRef,
      dataProcessorRef,
    }
    processors.value = [...processors.value, next]
    activeProcessorId.value = next.id
  }
  dialogVisible.value = false
  persistProcessors()
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
  processors.value = processors.value.filter((p) => p.id !== proc.id)
  persistProcessors()
}

type ProcMenuCommand = 'edit' | 'delete'

function handleProcMenu(command: ProcMenuCommand, proc: ServiceProcessor) {
  if (command === 'edit') openEditDialog(proc)
  else void removeProcessor(proc)
}

function patchActiveMethods(nextMethods: ProcessorMethod[]) {
  const id = activeProcessorId.value
  if (!id) return
  processors.value = processors.value.map((p) =>
    p.id === id ? { ...p, methods: nextMethods } : p,
  )
  persistProcessors()
}

function addMethod() {
  if (!activeProcessor.value) {
    ElMessage.warning('请先选择或创建处理器')
    return
  }
  if (isBusinessLayer.value) {
    openBusinessMethodDesign(-1)
    return
  }
  patchActiveMethods([
    ...storedMethods.value,
    createEmptyProcessorMethod(`method${storedMethods.value.length + 1}`),
  ])
}

function updateMethod(index: number, patch: Partial<ProcessorMethod>) {
  patchActiveMethods(
    storedMethods.value.map((m, i) => (i === index ? { ...m, ...patch } : m)),
  )
}

const editingBusinessMethod = computed(() => businessMethodDraft.value)

const businessMethodReservedNames = computed(() =>
  storedMethods.value
    .filter((_, i) => i !== businessMethodEditIndex.value)
    .map((m) => m.name.trim())
    .filter(Boolean),
)

function openBusinessMethodDesign(index: number) {
  if (!isBusinessLayer.value || !activeProcessor.value) return
  businessMethodEditIndex.value = index
  if (index < 0) {
    businessMethodDraft.value = createEmptyProcessorMethod(
      `method${storedMethods.value.length + 1}`,
    )
  } else {
    const method = storedMethods.value[index]
    if (!method) return
    selectedMethodId.value = method.id
    flowSelectedNodeId.value = 'start'
    businessMethodDraft.value = {
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
    }
  }
  businessMethodDialogVisible.value = true
}

function saveBusinessMethodEdit(payload: BusinessMethodEditPayload) {
  if (businessMethodEditIndex.value < 0) {
    const base = businessMethodDraft.value ?? createEmptyProcessorMethod(payload.name)
    patchActiveMethods([
      ...storedMethods.value,
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
    updateMethod(businessMethodEditIndex.value, {
      name: payload.name,
      remark: payload.remark,
      scope: payload.scope,
      params: payload.params,
      output: payload.output,
    })
  }
  businessMethodEditIndex.value = -1
  businessMethodDraft.value = null
}

function openFlowEditor(index: number) {
  if (!isBusinessLayer.value || !activeProcessor.value) return
  const method = storedMethods.value[index]
  if (!method) return
  if (!method.flow?.nodes?.length) {
    updateMethod(index, { flow: createDefaultMethodFlow() })
  }
  selectedMethodId.value = method.id
  flowSelectedNodeId.value = 'start'
  flowDebugCursorId.value = null
  flowDebugVisitedIds.value = []
  flowDebugPrintByNode.value = {}
  flowEditing.value = {
    processorId: activeProcessor.value.id,
    methodId: method.id,
  }
}

function closeFlowEditor() {
  flowEditing.value = null
  flowSelectedNodeId.value = selectedMethodId.value ? 'start' : null
  flowDebugCursorId.value = null
  flowDebugVisitedIds.value = []
  flowDebugPrintByNode.value = {}
}

function updateFlowMethod(flow: MethodFlow) {
  const ctx = flowEditing.value
  if (!ctx) return
  const procIndex = processors.value.findIndex((p) => p.id === ctx.processorId)
  if (procIndex < 0) return
  const proc = processors.value[procIndex]!
  const nextMethods = proc.methods.map((m) =>
    m.id === ctx.methodId ? { ...m, flow } : m,
  )
  processors.value = processors.value.map((p, i) =>
    i === procIndex ? { ...p, methods: nextMethods } : p,
  )
  persistProcessors()
}

async function removeMethod(index: number) {
  const target = methods.value[index]
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
  patchActiveMethods(storedMethods.value.filter((m) => m.id !== target.id))
}

const editingDataMethod = computed(() => {
  if (dataMethodEditIndex.value < 0) return null
  return storedMethods.value[dataMethodEditIndex.value] ?? null
})

const selectedMethod = computed(() => {
  if (!selectedMethodId.value) return null
  return (
    findMethodIncludingPresets(
      storedMethods.value,
      selectedMethodId.value,
      presetMethods.value,
    ) ??
    methods.value.find((m) => m.id === selectedMethodId.value) ??
    null
  )
})

const dataDebugTarget = computed<ProcessorDebugTarget | null>(() => {
  if (!isDataLayer.value || !activeProcessor.value || !selectedMethod.value) {
    return null
  }
  return {
    kind: 'data',
    projectPath: props.projectPath,
    serviceId: props.serviceId,
    processorId: activeProcessor.value.id,
    processorName: activeProcessor.value.name,
    method: selectedMethod.value,
  }
})

const flowDebugTarget = computed<ProcessorDebugTarget | null>(() => {
  if (!isBusinessLayer.value) return null

  if (flowEditing.value && flowEditingMethod.value) {
    const proc = processors.value.find(
      (p) => p.id === flowEditing.value!.processorId,
    )
    if (!proc) return null
    return {
      kind: 'flow',
      projectPath: props.projectPath,
      serviceId: props.serviceId,
      processorId: proc.id,
      processorName: proc.name,
      method: flowEditingMethod.value,
      flow: flowEditingFlow.value,
      selectedNodeId: flowSelectedNodeId.value,
      dataProcessors: enrichedDataLayerProcessors.value,
      businessProcessors: processors.value,
      mode: 'canvas',
    }
  }

  if (!activeProcessor.value || !selectedMethod.value) return null
  return {
    kind: 'flow',
    projectPath: props.projectPath,
    serviceId: props.serviceId,
    processorId: activeProcessor.value.id,
    processorName: activeProcessor.value.name,
    method: selectedMethod.value,
    flow: selectedMethod.value.flow ?? createDefaultMethodFlow(),
    selectedNodeId: flowSelectedNodeId.value || 'start',
    dataProcessors: enrichedDataLayerProcessors.value,
    businessProcessors: processors.value,
    mode: 'list',
  }
})

const debugTarget = computed(
  () => flowDebugTarget.value ?? dataDebugTarget.value,
)

watch(
  debugTarget,
  (target) => emit('update:debug-target', target),
  { immediate: true },
)

onBeforeUnmount(() => {
  emit('update:debug-target', null)
})

function onFlowSelectedNode(nodeId: string | null) {
  flowSelectedNodeId.value = nodeId
}

function onFlowDebugCursor(state: {
  cursorNodeId: string | null
  visitedNodeIds: string[]
  printByNode?: Record<string, string>
}) {
  flowDebugCursorId.value = state.cursorNodeId
  flowDebugVisitedIds.value = state.visitedNodeIds
  flowDebugPrintByNode.value = state.printByNode ?? {}
}

watch(
  () => [activeProcessorId.value, methods.value.map((m) => m.id).join(',')] as const,
  () => {
    const prefer =
      pendingRestore.value?.methodId ?? props.restored?.methodId
    if (
      selectedMethodId.value &&
      !methods.value.some((m) => m.id === selectedMethodId.value)
    ) {
      selectedMethodId.value =
        (prefer && methods.value.some((m) => m.id === prefer)
          ? prefer
          : methods.value[0]?.id) ?? ''
    } else if (!selectedMethodId.value && methods.value.length) {
      selectedMethodId.value =
        (prefer && methods.value.some((m) => m.id === prefer)
          ? prefer
          : methods.value[0]!.id)
    }
    if (isBusinessLayer.value && selectedMethodId.value && !flowEditing.value) {
      flowSelectedNodeId.value = 'start'
    }
  },
)

function selectMethodRow(method: ProcessorMethod) {
  selectedMethodId.value = method.id
  if (isBusinessLayer.value && !flowEditing.value) {
    flowSelectedNodeId.value = 'start'
    flowDebugCursorId.value = null
    flowDebugVisitedIds.value = []
    flowDebugPrintByNode.value = {}
  }
}

function openDataMethodDialog(row: ProcessorMethod) {
  if (!isDataLayer.value || row.preset) return
  const index = storedMethods.value.findIndex((m) => m.id === row.id)
  if (index < 0) return
  dataMethodEditIndex.value = index
  selectedMethodId.value = row.id
  dataMethodDialogVisible.value = true
}

function saveDataMethodEdit(payload: DataMethodEditPayload) {
  if (dataMethodEditIndex.value < 0) return
  updateMethod(dataMethodEditIndex.value, {
    name: payload.name,
    params: payload.params,
    output: payload.output,
    dataConfig: payload.dataConfig,
  })
  dataMethodEditIndex.value = -1
}

function updateDebugParams(params: Record<string, unknown>) {
  if (isBusinessLayer.value && flowEditing.value) {
    const ctx = flowEditing.value
    const procIndex = processors.value.findIndex((p) => p.id === ctx.processorId)
    if (procIndex < 0) return
    const proc = processors.value[procIndex]!
    const nextMethods = proc.methods.map((m) =>
      m.id === ctx.methodId ? { ...m, debugParams: { ...params } } : m,
    )
    processors.value = processors.value.map((p, i) =>
      i === procIndex ? { ...p, methods: nextMethods } : p,
    )
    persistProcessors()
    return
  }
  const id = selectedMethodId.value
  if (!id) return
  // 预置方法不落盘，仅更新内存展示用 debugParams（不 persist）
  if (presetMethods.value.some((m) => m.id === id)) {
    return
  }
  const index = storedMethods.value.findIndex((m) => m.id === id)
  if (index < 0) return
  updateMethod(index, { debugParams: { ...params } })
}

defineExpose({
  updateDebugParams,
  applyFlowDebugCursor: onFlowDebugCursor,
  openCreateDialog,
  addMethod,
})
</script>

<template>
  <MethodFlowEditor
    v-if="isBusinessLayer && flowEditing && flowEditingMethod"
    :method-name="flowEditingMethod.name"
    :flow="flowEditingFlow"
    :method-params="flowEditingMethod.params"
    :method-output="flowEditingMethod.output"
    :data-processors="enrichedDataLayerProcessors"
    :business-processors="processors"
    :current-processor-id="flowEditing.processorId"
    :current-method-id="flowEditing.methodId"
    :bound-data-processor-id="
      processors.find((p) => p.id === flowEditing!.processorId)
        ?.dataProcessorRef ?? ''
    "
    :type-library="typeLibrary"
    :debug-cursor-id="flowDebugCursorId"
    :debug-visited-ids="flowDebugVisitedIds"
    :debug-print-by-node="flowDebugPrintByNode"
    @back="closeFlowEditor"
    @update:flow="updateFlowMethod"
    @update:selected-node="onFlowSelectedNode"
  />
  <div v-else class="proc-workspace">
    <aside class="proc-pane">
      <el-skeleton v-if="loading" :rows="4" animated style="padding: 12px" />
      <el-empty
        v-else-if="!processors.length"
        description="暂无处理器，点击顶部创建"
        :image-size="56"
      />
      <ul v-else class="proc-list">
        <el-dropdown
          v-for="proc in processors"
          :key="proc.id"
          trigger="contextmenu"
          class="proc-dropdown"
          @command="(cmd: string) => handleProcMenu(cmd as ProcMenuCommand, proc)"
        >
          <li
            class="proc-item"
            :class="{ active: proc.id === activeProcessorId }"
            @click="activeProcessorId = proc.id"
            @dblclick="openEditDialog(proc)"
            @contextmenu.prevent
          >
            <span class="proc-name" :title="processorSub(proc) || proc.name">
              {{ proc.name }}
            </span>
            <span v-if="processorSub(proc)" class="proc-bind">
              {{ processorSub(proc) }}
            </span>
            <span class="proc-count">{{
              isDataLayer
                ? mergePresetAndCustomMethods(
                    presetsForProcessor(proc),
                    proc.methods,
                  ).length
                : proc.methods.length
            }}</span>
          </li>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="edit">编辑</el-dropdown-item>
              <el-dropdown-item command="delete" divided>
                删除
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </ul>
    </aside>

    <section class="method-pane">
      <el-empty
        v-if="!activeProcessor"
        description="请选择或创建左侧处理器"
        :image-size="64"
      />
      <div v-else class="method-table" :class="{ 'data-layer': isDataLayer }">
        <el-table
          :data="methods"
          border
          stripe
          empty-text="暂无方法，点击顶部创建"
          highlight-current-row
          :row-class-name="
            ({ row }: { row: ProcessorMethod }) => {
              const classes: string[] = []
              if (row.id === selectedMethodId) classes.push('is-selected-row')
              return classes.join(' ')
            }
          "
          @row-click="(row: ProcessorMethod) => selectMethodRow(row)"
        >
          <el-table-column label="名称" min-width="140">
            <template #default="{ row }">
              <span
                class="cell-text"
                :class="{ 'preset-name': row.preset }"
              >
                {{ row.name || '—' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column
            label="说明"
            min-width="120"
          >
            <template #default="{ row }">
              <span class="cell-text muted">{{ row.remark || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-if="isBusinessLayer"
            label="作用域"
            width="80"
            align="center"
          >
            <template #default="{ row }">
              <span class="cell-text">{{
                row.scope === 'private' ? '私有' : '公共'
              }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-if="isDataLayer"
            label="操作"
            width="96"
            align="center"
          >
            <template #default="{ row }">
              <span class="op-tag" :class="operationTagClass(row)">{{
                operationLabel(row)
              }}</span>
            </template>
          </el-table-column>
          <el-table-column label="入参" min-width="160">
            <template #default="{ row }">
              <span class="cell-text muted">{{ paramsSummary(row.params) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="出参" min-width="160">
            <template #default="{ row }">
              <span class="cell-text">{{ formatTypeExpr(row.output) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220" align="center" fixed="right">
            <template #default="{ row, $index }">
              <el-button
                v-if="isDataLayer && !row.preset"
                type="primary"
                link
                :icon="EditPen"
                @click.stop="openDataMethodDialog(row)"
              >
                编辑
              </el-button>
              <template v-if="isBusinessLayer">
                <el-button
                  type="primary"
                  link
                  :icon="SetUp"
                  @click.stop="openBusinessMethodDesign($index)"
                >
                  设计
                </el-button>
                <el-button
                  type="primary"
                  link
                  :icon="EditPen"
                  @click.stop="openFlowEditor($index)"
                >
                  编辑
                </el-button>
              </template>
              <el-button
                v-if="!row.preset"
                type="danger"
                link
                :icon="Delete"
                @click.stop="removeMethod($index)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog
      v-model="dialogVisible"
      :title="`${layerLabel} · 处理器`"
      width="440px"
      destroy-on-close
      append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
      <el-form label-width="100px" @submit.prevent="submitDialog">
        <el-form-item label="名称" required>
          <el-input
            v-model="dialogName"
            placeholder="如 GoodsProcessor"
            maxlength="64"
            autofocus
          />
        </el-form-item>
        <el-form-item
          v-if="isDataLayer"
          label="绑定实体"
          required
        >
          <el-select
            v-model="dialogEntityRef"
            filterable
            placeholder="选择实体类型"
            style="width: 100%"
          >
            <el-option
              v-for="opt in entityOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
            />
          </el-select>
          <p v-if="!entityOptions.length" class="field-hint">
            暂无实体，请先在「数据类型」中添加接口 / 实体
          </p>
        </el-form-item>
        <el-form-item v-if="isBusinessLayer" label="绑定数据层">
          <el-select
            v-model="dialogDataProcessorRef"
            clearable
            filterable
            placeholder="可选，绑定数据层处理器"
            style="width: 100%"
          >
            <el-option
              v-for="opt in dataProcessorOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
            />
          </el-select>
          <p v-if="!dataProcessorOptions.length" class="field-hint">
            暂无数据层处理器，可先创建数据层
          </p>
        </el-form-item>
        <el-form-item label="说明">
          <el-input
            v-model="dialogRemark"
            type="textarea"
            :rows="2"
            placeholder="可选说明"
            maxlength="256"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="submitDialog">确定</el-button>
      </template>
    </el-dialog>

    <EditBusinessMethodDialog
      v-if="isBusinessLayer"
      v-model="businessMethodDialogVisible"
      :method="editingBusinessMethod"
      :type-library="typeLibrary"
      :type-options="typeOptions"
      :reserved-names="businessMethodReservedNames"
      @save="saveBusinessMethodEdit"
    />
    <EditDataMethodDialog
      v-if="isDataLayer"
      v-model="dataMethodDialogVisible"
      :method="editingDataMethod"
      :type-library="typeLibrary"
      :type-options="typeOptions"
      :entity-ref="activeProcessor?.entityRef"
      :reserved-names="dataMethodReservedNames"
      @save="saveDataMethodEdit"
    />
  </div>
</template>

<style scoped>
:deep(.method-flow-editor) {
  flex: 1;
  min-height: 0;
  height: 100%;
}

.proc-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
  overflow: hidden;
}

.proc-pane,
.method-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.proc-pane {
  border-right: 1px solid #ebeef5;
  background: #fafafa;
}

.proc-list {
  margin: 0;
  padding: 8px;
  list-style: none;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.proc-dropdown {
  display: block;
  width: 100%;
  margin-bottom: 4px;
}

.proc-dropdown :deep(.el-tooltip__trigger),
.proc-dropdown :deep(.el-dropdown__trigger) {
  display: block !important;
  width: 100%;
}

.proc-item {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  list-style: none;
}

.proc-item:hover {
  background: #f0f2f5;
}

.proc-item.active {
  background: #ecf5ff;
}

.proc-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc-bind {
  flex: 0 1 auto;
  max-width: 88px;
  margin-left: 4px;
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.proc-count {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 8px;
  font-size: 11px;
  color: #94a3b8;
  min-width: 1.25em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.method-table {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.method-table :deep(.el-table .cell) {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding-top: 6px;
  padding-bottom: 6px;
}

.method-table :deep(.el-input),
.method-table :deep(.el-select),
.method-table :deep(.el-cascader) {
  width: 100%;
}

.method-table :deep(.el-input__wrapper),
.method-table :deep(.el-select__wrapper),
.method-table :deep(.el-cascader .el-input__wrapper) {
  height: 24px;
  min-height: 24px;
}

.cell-text {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #303133;
  line-height: 24px;
}

.op-tag {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  background: #f0f2f5;
  color: #606266;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.op-tag--query {
  background: #ecf5ff;
  color: #409eff;
}

.op-tag--insert {
  background: #f0f9eb;
  color: #67c23a;
}

.op-tag--batch {
  background: #e8f8f0;
  color: #18a058;
}

.op-tag--update {
  background: #fdf6ec;
  color: #e6a23c;
}

.op-tag--delete {
  background: #fef0f0;
  color: #f56c6c;
}

.op-tag--custom {
  background: #f4f4f5;
  color: #909399;
}

.cell-text.muted {
  color: #606266;
}

.method-table :deep(.is-selected-row > td.el-table__cell) {
  background: #ecf5ff !important;
}

.preset-name {
  color: #67c23a;
}

.method-table :deep(.el-table__body tr) {
  cursor: pointer;
}
</style>
