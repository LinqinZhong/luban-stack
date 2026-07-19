<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Aim, Back, EditPen, Right, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type {
  MethodFlow,
  ProcessorMethod,
  ProcessorMethodParam,
  ProcessorTypeExpr,
  ServiceProcessor,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import type { DataTypeDef, InterfaceField, TypeExpr } from '../../types/data-types'
import {
  ambientTypeLabel,
  ambientVarsAtNode,
  findStartNode,
  formatAmbientValue,
  extractFlowReturnValue,
  runFlowNext,
  runFlowToEnd,
  runFlowToNode,
  type FlowAmbientVar,
  type FlowDebugSnapshot,
} from './method-flow/method-flow-debug'

export type MethodFlowDebugTarget = {
  projectPath: string
  serviceId: string
  processorId: string
  processorName: string
  method: ProcessorMethod
  flow: MethodFlow
  selectedNodeId: string | null
  dataProcessors: ServiceProcessor[]
  /** 业务层处理器（输入节点「业务」来源调试） */
  businessProcessors?: ServiceProcessor[]
  /** list=方法表选中；canvas=工作流画布逐步调试 */
  mode?: 'list' | 'canvas'
}

type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'array'

type ObjectFieldForm = {
  name: string
  remark: string
  kind: FieldKind
  enumOptions: string[]
}

type ParamFormModel = {
  param: ProcessorMethodParam
  mode: 'scalar' | 'object' | 'json'
  typeLabel: string
  kind: FieldKind
  enumOptions: string[]
  fields: ObjectFieldForm[]
}

const props = defineProps<{
  target: MethodFlowDebugTarget | null
  typeLibrary: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:debug-params': [params: Record<string, unknown>]
  'update:cursor': [
    state: {
      cursorNodeId: string | null
      visitedNodeIds: string[]
      printByNode?: Record<string, string>
    },
  ]
}>()

const draft = reactive<Record<string, unknown>>({})
/** 列表模式：入参是否启用（不勾选则传禁用值） */
const paramEnabled = reactive<Record<string, boolean>>({})
const paramStash = reactive<Record<string, unknown>>({})
/** 非入参变量的手动覆盖（未执行时也可改） */
const localScope = ref<Record<string, unknown>>({})
const dryRun = ref(true)
const running = ref(false)
const errorText = ref('')
const history = ref<FlowDebugSnapshot[]>([])
const snapshot = ref<FlowDebugSnapshot | null>(null)
/** 列表模式执行结果（方法返回值） */
const listResult = ref<unknown>(undefined)
const listResultReady = ref(false)
const listResultError = ref('')
const listResultFoldOpen = ref(false)
/** 过长 JSON 折叠展开状态（key = param:name / var:name） */
const foldOpen = reactive<Record<string, boolean>>({})

const isListMode = computed(() => (props.target?.mode ?? 'canvas') === 'list')

/** 与数据层调试面板一致的折叠阈值 */
const FOLD_MAX_LINES = 10
const FOLD_MAX_CHARS = 480

function isLongText(text: string): boolean {
  if (!text || text === '—') return false
  if (text.length > FOLD_MAX_CHARS) return true
  return text.split('\n').length > FOLD_MAX_LINES
}

function isFoldExpanded(key: string): boolean {
  return foldOpen[key] === true
}

function toggleFold(key: string) {
  foldOpen[key] = !foldOpen[key]
}

function valueTextOf(value: unknown): string {
  return previewValue(value)
}

function ambientTextOf(item: { hasValue: boolean; value?: unknown }): string {
  return item.hasValue ? formatAmbientValue(item.value) : '未赋值'
}

const paramDialogVisible = ref(false)
const editingParamForm = ref<ParamFormModel | null>(null)
const paramEditDraft = reactive<Record<string, unknown>>({})
const paramEditScalar = ref<unknown>('')
const paramEditJson = ref('')

const ambientDialogVisible = ref(false)
const editingAmbient = ref<FlowAmbientVar | null>(null)
const ambientEditJson = ref('')
const ambientEditScalar = ref('')
const ambientEditIsJson = ref(false)

const method = computed(() => props.target?.method ?? null)

function defaultForKind(kind: FieldKind): unknown {
  switch (kind) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    case 'json':
      return {}
    default:
      return ''
  }
}

function primaryAtom(expr: TypeExpr | undefined | null) {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
}

function fieldKindFromTypeExpr(
  expr: TypeExpr,
  library: DataTypeLibrary | null,
): { kind: FieldKind; enumOptions: string[] } {
  const mapped = typeExprToDataFieldType(expr, library)
  if (mapped.type === 'number') return { kind: 'number', enumOptions: [] }
  if (mapped.type === 'boolean') return { kind: 'boolean', enumOptions: [] }
  if (mapped.type === 'array') return { kind: 'array', enumOptions: [] }
  if (mapped.typeRef) {
    const def = findDataTypeDef(library, mapped.typeRef)
    if (def?.kind === 'enum') {
      return {
        kind: 'enum',
        enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
      }
    }
    if (def?.kind === 'interface') {
      return { kind: 'json', enumOptions: [] }
    }
  }
  const atom = primaryAtom(expr)
  if (atom.kind === 'number') return { kind: 'number', enumOptions: [] }
  if (atom.kind === 'boolean') return { kind: 'boolean', enumOptions: [] }
  return { kind: 'string', enumOptions: [] }
}

function objectFieldsOf(def: DataTypeDef | null): ObjectFieldForm[] {
  if (!def || def.kind !== 'interface') return []
  return def.fields
    .map((f: InterfaceField) => {
      const name = f.name.trim()
      if (!name) return null
      const info = fieldKindFromTypeExpr(f.type, props.typeLibrary)
      return {
        name,
        remark: f.remark?.trim() || '',
        kind: info.kind,
        enumOptions: info.enumOptions,
      }
    })
    .filter((x): x is ObjectFieldForm => Boolean(x))
}

function namedTypeLabel(typeRef: string): string {
  if (!typeRef) return ''
  return findDataTypeDef(props.typeLibrary, typeRef)?.name || typeRef
}

function resolveParamForm(param: ProcessorMethodParam): ParamFormModel {
  const expr: ProcessorTypeExpr = param.typeExpr
  if (expr.type === 'array') {
    return {
      param,
      mode: 'json',
      typeLabel: '数组',
      kind: 'array',
      enumOptions: [],
      fields: [],
    }
  }
  const typeLabel = expr.typeRef
    ? namedTypeLabel(expr.typeRef)
    : expr.type === 'json'
      ? '对象'
      : expr.type || 'string'

  if (expr.typeRef || expr.type === 'json') {
    const def = findDataTypeDef(props.typeLibrary, expr.typeRef)
    if (def?.kind === 'interface') {
      const fields = objectFieldsOf(def)
      if (fields.length) {
        return {
          param,
          mode: 'object',
          typeLabel: def.name || typeLabel,
          kind: 'json',
          enumOptions: [],
          fields,
        }
      }
    }
    if (def?.kind === 'enum') {
      return {
        param,
        mode: 'scalar',
        typeLabel: def.name || typeLabel,
        kind: 'enum',
        enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
        fields: [],
      }
    }
  }

  const t = expr.type || 'string'
  if (t === 'number') {
    return {
      param,
      mode: 'scalar',
      typeLabel,
      kind: 'number',
      enumOptions: [],
      fields: [],
    }
  }
  if (t === 'boolean') {
    return {
      param,
      mode: 'scalar',
      typeLabel,
      kind: 'boolean',
      enumOptions: [],
      fields: [],
    }
  }
  return {
    param,
    mode: 'scalar',
    typeLabel,
    kind: 'string',
    enumOptions: [],
    fields: [],
  }
}

const paramForms = computed(() =>
  (method.value?.params ?? [])
    .filter((p) => p.name.trim())
    .map((p) => resolveParamForm(p)),
)

const paramNameSet = computed(
  () => new Set(paramForms.value.map((f) => f.param.name)),
)

function buildObjectDefault(fields: ObjectFieldForm[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f.name] = defaultForKind(f.kind)
  return out
}

/** 不勾选时提交的值：数字 0、布尔 false、其余 null */
function disabledParamValue(form: ParamFormModel): unknown {
  if (form.kind === 'number') return 0
  if (form.kind === 'boolean') return false
  return null
}

function defaultEnabledParamValue(form: ParamFormModel): unknown {
  if (form.mode === 'object') return buildObjectDefault(form.fields)
  if (form.mode === 'json') return form.kind === 'array' ? [] : {}
  if (form.kind === 'number') return 0
  if (form.kind === 'boolean') return false
  if (form.kind === 'enum') return form.enumOptions[0] ?? ''
  return ''
}

function disabledParamHint(form: ParamFormModel): string {
  if (form.kind === 'number') return '0'
  if (form.kind === 'boolean') return 'false'
  return 'null'
}

function isParamEnabled(form: ParamFormModel): boolean {
  return paramEnabled[form.param.name.trim()] !== false
}

function setParamEnabled(form: ParamFormModel, enabled: boolean) {
  const name = form.param.name.trim()
  if (enabled) {
    const restored = paramStash[name]
    paramEnabled[name] = true
    draft[name] =
      restored !== undefined ? restored : defaultEnabledParamValue(form)
    delete paramStash[name]
  } else {
    if (paramEnabled[name] !== false) {
      paramStash[name] = draft[name]
    }
    paramEnabled[name] = false
    draft[name] = disabledParamValue(form)
  }
  emitParams()
}

function syncDraftFromMethod() {
  const m = method.value
  const keys = Object.keys(draft)
  for (const k of keys) delete draft[k]
  for (const key of Object.keys(paramEnabled)) delete paramEnabled[key]
  for (const key of Object.keys(paramStash)) delete paramStash[key]
  listResult.value = undefined
  listResultReady.value = false
  listResultError.value = ''
  if (!m) return
  const saved = m.debugParams ?? {}
  for (const form of paramForms.value) {
    const name = form.param.name.trim()
    const prev = saved[name]
    const canInferOff =
      form.kind !== 'number' && form.kind !== 'boolean' && prev === null
    if (canInferOff) {
      draft[name] = disabledParamValue(form)
      paramEnabled[name] = false
      continue
    }
    paramEnabled[name] = true
    if (Object.prototype.hasOwnProperty.call(saved, name)) {
      if (form.mode === 'object') {
        const base = buildObjectDefault(form.fields)
        draft[name] =
          prev && typeof prev === 'object' && !Array.isArray(prev)
            ? { ...base, ...(prev as Record<string, unknown>) }
            : base
      } else {
        draft[name] = prev
      }
      continue
    }
    draft[name] = defaultEnabledParamValue(form)
  }
}

function emitParams() {
  emit('update:debug-params', { ...draft })
}

function methodSyncKey(target: MethodFlowDebugTarget | null): string {
  if (!target) return ''
  return `${target.processorId}:${target.method.id}:${target.mode ?? 'canvas'}:${target.method.params
    .map((p) => p.id)
    .join(',')}`
}

watch(
  () => methodSyncKey(props.target),
  () => {
    syncDraftFromMethod()
    resetSession()
  },
  { immediate: true },
)

function emitCursor(snap: FlowDebugSnapshot | null) {
  emit('update:cursor', {
    cursorNodeId: snap?.cursorNodeId ?? null,
    visitedNodeIds: snap?.visitedNodeIds ?? [],
    printByNode: snap?.printByNode ?? {},
  })
}

function resetSession() {
  history.value = []
  snapshot.value = null
  localScope.value = {}
  errorText.value = ''
  emitCursor(null)
}

const selectedNodeId = computed(() => props.target?.selectedNodeId ?? null)

const kindMap: Record<string, string> = {
  start: '开始',
  input: '输入',
  define: '定义数据',
  branch: '判断',
  action: '操作',
  output: '输出',
  end: '终止',
}

function nodeKindLabel(kind: string): string {
  return kindMap[kind] || kind
}

function nodeSummaryText(node: {
  kind: string
  data?: Record<string, unknown>
} | null): string {
  if (!node) return ''
  const data = (node.data ?? {}) as Record<string, unknown>
  const description =
    typeof data.description === 'string' ? data.description.trim() : ''
  if (description) return description
  if (node.kind === 'input') {
    const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
    const methodLabel =
      typeof data.methodLabel === 'string' ? data.methodLabel.trim() : ''
    if (varName && methodLabel) return `${varName} ← ${methodLabel}`
    return varName || methodLabel || ''
  }
  if (node.kind === 'define') {
    const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
    const initExpr = typeof data.initExpr === 'string' ? data.initExpr.trim() : ''
    if (varName && initExpr) return `${varName} = ${initExpr}`
    return varName
  }
  if (node.kind === 'branch') {
    return typeof data.expression === 'string' ? data.expression.trim() : ''
  }
  if (node.kind === 'action') {
    const outputVar =
      typeof data.outputVarName === 'string' ? data.outputVarName.trim() : ''
    return outputVar ? `→ ${outputVar}` : ''
  }
  if (node.kind === 'output') {
    const methodLabel =
      typeof data.methodLabel === 'string' ? data.methodLabel.trim() : ''
    return methodLabel.replace(/（[^）]*）$/, '')
  }
  if (node.kind === 'end') {
    return typeof data.returnExpr === 'string' ? data.returnExpr.trim() : ''
  }
  return ''
}

const selectedNode = computed(() => {
  const flow = props.target?.flow
  const id = selectedNodeId.value
  if (!flow || !id) return null
  return flow.nodes.find((n) => n.id === id) ?? null
})

/** 有执行快照时优先看游标节点，否则看画布选中 */
const viewNodeId = computed(() => {
  const cursor = snapshot.value?.cursorNodeId
  if (cursor) return cursor
  return selectedNodeId.value
})

const viewNode = computed(() => {
  const flow = props.target?.flow
  const id = viewNodeId.value
  if (!flow || !id) return null
  return flow.nodes.find((n) => n.id === id) ?? null
})

/** 仅开始节点展示并可编辑入参（执行停在开始 / 未执行且选中开始） */
const isStartSelected = computed(() => {
  const n = viewNode.value
  if (!n) return false
  return n.kind === 'start' || n.id === 'start'
})

const selectedNodeLabel = computed(() => {
  const node = selectedNode.value
  if (!node) return '未选中节点'
  return nodeKindLabel(node.kind)
})

const cursorLabel = computed(() => {
  const node = viewNode.value
  if (!snapshot.value?.cursorNodeId || !node) return '—'
  return nodeKindLabel(node.kind)
})

const cursorNodeTitle = computed(() => {
  const node = viewNode.value
  if (!snapshot.value?.cursorNodeId || !node) return ''
  const kind = nodeKindLabel(node.kind)
  const summary = nodeSummaryText(node)
  return summary ? `${kind} · ${summary}` : kind
})

const effectiveScope = computed(() => ({
  ...draft,
  ...localScope.value,
  ...(snapshot.value?.scope ?? {}),
}))

const ambientList = computed(() => {
  const t = props.target
  if (!t) return []
  return ambientVarsAtNode({
    flow: t.flow,
    nodeId: viewNodeId.value,
    methodParams: t.method.params,
    dataProcessors: t.dataProcessors,
    businessProcessors: t.businessProcessors,
    typeLibrary: props.typeLibrary,
    scope: effectiveScope.value,
  })
})

/** 选中开始时入参单独展示，可访问数据里去掉入参避免重复 */
const ambientListView = computed(() => {
  if (!isStartSelected.value) return ambientList.value
  return ambientList.value.filter((a) => !paramNameSet.value.has(a.name))
})

function stepContext() {
  const t = props.target
  if (!t) throw new Error('无调试目标')
  return {
    projectPath: t.projectPath,
    serviceId: t.serviceId,
    flow: t.flow,
    dataProcessors: t.dataProcessors,
    businessProcessors: t.businessProcessors ?? [],
    dryRun: dryRun.value,
  }
}

function initialScope(): Record<string, unknown> {
  return { ...draft, ...localScope.value }
}

function previewValue(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'string') return value === '' ? '""' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const text = JSON.stringify(value)
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return String(value)
  }
}

function formatJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function setScalar(name: string, value: unknown) {
  draft[name] = value
  emitParams()
}

function setObjectField(paramName: string, fieldName: string, value: unknown) {
  const prev = draft[paramName]
  const obj =
    prev && typeof prev === 'object' && !Array.isArray(prev)
      ? { ...(prev as Record<string, unknown>) }
      : {}
  obj[fieldName] = value
  draft[paramName] = obj
  emitParams()
}

function objectFieldValue(paramName: string, fieldName: string): unknown {
  const prev = draft[paramName]
  if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
    return (prev as Record<string, unknown>)[fieldName]
  }
  return undefined
}

function onJsonBlur(paramName: string, text: string, asArray: boolean) {
  try {
    const parsed = JSON.parse(text || (asArray ? '[]' : '{}'))
    draft[paramName] = parsed
    emitParams()
  } catch {
    ElMessage.warning('JSON 格式不正确')
  }
}

function onNestedJsonBlur(
  paramName: string,
  fieldName: string,
  text: string,
  asArray: boolean,
) {
  try {
    const parsed = JSON.parse(text || (asArray ? '[]' : '{}'))
    setObjectField(paramName, fieldName, parsed)
  } catch {
    ElMessage.warning('JSON 格式不正确')
  }
}

const listResultText = computed(() => formatJson(listResult.value) || '—')

async function handleRunAll() {
  const t = props.target
  if (!t) return
  running.value = true
  listResultError.value = ''
  listResult.value = undefined
  listResultReady.value = false
  errorText.value = ''
  try {
    const snap = await runFlowToEnd(stepContext(), initialScope())
    snapshot.value = snap
    history.value = []
    localScope.value = {}
    listResult.value = extractFlowReturnValue(t.flow, snap)
    listResultReady.value = true
    listResultFoldOpen.value = false
    emitCursor(snap)
  } catch (err) {
    listResultError.value = err instanceof Error ? err.message : String(err)
    ElMessage.error(listResultError.value)
    emitCursor(null)
  } finally {
    running.value = false
  }
}

function openParamEdit(form: ParamFormModel) {
  editingParamForm.value = form
  const name = form.param.name
  const cur = draft[name]
  if (form.mode === 'object') {
    const base = buildObjectDefault(form.fields)
    const obj =
      cur && typeof cur === 'object' && !Array.isArray(cur)
        ? { ...base, ...(cur as Record<string, unknown>) }
        : base
    for (const k of Object.keys(paramEditDraft)) delete paramEditDraft[k]
    for (const [k, v] of Object.entries(obj)) paramEditDraft[k] = v
  } else if (form.mode === 'json') {
    paramEditJson.value =
      typeof cur === 'string'
        ? cur
        : JSON.stringify(cur ?? (form.kind === 'array' ? [] : {}), null, 2)
  } else {
    paramEditScalar.value = cur ?? defaultForKind(form.kind)
  }
  paramDialogVisible.value = true
}

function saveParamEdit() {
  const form = editingParamForm.value
  if (!form) return
  const name = form.param.name
  if (form.mode === 'object') {
    draft[name] = { ...paramEditDraft }
  } else if (form.mode === 'json') {
    try {
      draft[name] = JSON.parse(paramEditJson.value || 'null')
    } catch {
      ElMessage.warning('JSON 格式不正确')
      return
    }
  } else if (form.kind === 'number') {
    draft[name] = Number(paramEditScalar.value ?? 0)
  } else if (form.kind === 'boolean') {
    draft[name] = paramEditScalar.value === true
  } else {
    draft[name] = paramEditScalar.value ?? ''
  }
  emitParams()
  // 同步到当前作用域
  if (snapshot.value) {
    snapshot.value = {
      ...snapshot.value,
      scope: { ...snapshot.value.scope, [name]: draft[name] },
    }
  }
  paramDialogVisible.value = false
}

function openAmbientEdit(item: FlowAmbientVar) {
  editingAmbient.value = item
  const value = item.hasValue
    ? item.value
    : paramNameSet.value.has(item.name)
      ? draft[item.name]
      : undefined
  const isComplex =
    value !== null &&
    value !== undefined &&
    (typeof value === 'object' ||
      item.type === 'object' ||
      item.type === 'array' ||
      item.type === 'any' ||
      Boolean(item.tsType))
  ambientEditIsJson.value = isComplex
  if (isComplex) {
    ambientEditJson.value = formatAmbientValue(
      value === undefined ? (item.type === 'array' ? [] : {}) : value,
    )
    if (ambientEditJson.value === '—') {
      ambientEditJson.value = item.type === 'array' ? '[]' : '{}'
    }
  } else if (typeof value === 'boolean') {
    ambientEditScalar.value = value ? 'true' : 'false'
  } else if (value === undefined || value === null) {
    ambientEditScalar.value = ''
  } else {
    ambientEditScalar.value = String(value)
  }
  ambientDialogVisible.value = true
}

function applyScopeValue(name: string, value: unknown) {
  if (paramNameSet.value.has(name)) {
    draft[name] = value
    emitParams()
  }
  if (snapshot.value) {
    snapshot.value = {
      ...snapshot.value,
      scope: { ...snapshot.value.scope, [name]: value },
    }
  } else {
    localScope.value = { ...localScope.value, [name]: value }
  }
}

function saveAmbientEdit() {
  const item = editingAmbient.value
  if (!item) return
  let value: unknown
  if (ambientEditIsJson.value) {
    try {
      value = JSON.parse(ambientEditJson.value || 'null')
    } catch {
      ElMessage.warning('JSON 格式不正确')
      return
    }
  } else if (item.type === 'number') {
    value = Number(ambientEditScalar.value || 0)
  } else if (item.type === 'boolean') {
    value =
      ambientEditScalar.value === true ||
      ambientEditScalar.value === 'true' ||
      ambientEditScalar.value === '1'
  } else {
    value = ambientEditScalar.value
  }
  applyScopeValue(item.name, value)
  ambientDialogVisible.value = false
}

async function handleRunToCurrent() {
  const t = props.target
  if (!t) return
  const targetId = selectedNodeId.value
  if (!targetId) {
    ElMessage.warning('请先选中一个节点')
    return
  }
  running.value = true
  errorText.value = ''
  try {
    const snap = await runFlowToNode(stepContext(), targetId, initialScope())
    if (snapshot.value) history.value = [...history.value, snapshot.value]
    snapshot.value = snap
    localScope.value = {}
    emitCursor(snap)
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err)
    ElMessage.error(errorText.value)
  } finally {
    running.value = false
  }
}

async function handleRunNext() {
  const t = props.target
  if (!t) return
  running.value = true
  errorText.value = ''
  try {
    const start = findStartNode(t.flow)
    if (!start) throw new Error('工作流缺少开始节点')
    const base: FlowDebugSnapshot =
      snapshot.value ??
      ({
        cursorNodeId: start.id,
        scope: initialScope(),
        visitedNodeIds: [],
        printByNode: {},
      } satisfies FlowDebugSnapshot)
    const snap = await runFlowNext(stepContext(), base)
    if (snapshot.value) history.value = [...history.value, snapshot.value]
    snapshot.value = snap
    localScope.value = {}
    emitCursor(snap)
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err)
    ElMessage.error(errorText.value)
  } finally {
    running.value = false
  }
}

function handleStepBack() {
  const prev = history.value[history.value.length - 1]
  if (!prev) {
    resetSession()
    ElMessage.info('已回到初始状态')
    return
  }
  history.value = history.value.slice(0, -1)
  snapshot.value = prev
  localScope.value = {}
  emitCursor(prev)
  errorText.value = ''
}

const canStepBack = computed(
  () => history.value.length > 0 || snapshot.value != null,
)

const stickyTitle = computed(() => {
  const parts: string[] = []
  if (cursorNodeTitle.value) parts.push(`执行到 ${cursorNodeTitle.value}`)
  else parts.push(`选中 ${selectedNodeLabel.value}`)
  if (errorText.value) parts.push(errorText.value)
  return parts.join(' · ')
})

watch(isStartSelected, (ok) => {
  if (!ok && paramDialogVisible.value) {
    paramDialogVisible.value = false
  }
})
</script>

<template>
  <aside class="debug-panel">
    <div class="panel-header">
      <span>调试</span>
      <div v-if="target && !isListMode" class="action-icons">
        <el-tooltip content="执行到当前节点" placement="bottom">
          <el-button
            type="primary"
            size="small"
            circle
            :icon="Aim"
            :loading="running"
            @click="handleRunToCurrent"
          />
        </el-tooltip>
        <el-tooltip content="返回上个节点" placement="bottom">
          <el-button
            size="small"
            circle
            :icon="Back"
            :disabled="!canStepBack || running"
            @click="handleStepBack"
          />
        </el-tooltip>
        <el-tooltip content="执行到下一个节点" placement="bottom">
          <el-button
            size="small"
            circle
            :icon="Right"
            :loading="running"
            @click="handleRunNext"
          />
        </el-tooltip>
      </div>
    </div>
    <div v-if="!target" class="panel-empty">
      <el-empty description="选中业务方法或 API 后可调试" :image-size="48" />
    </div>

    <!-- 方法列表选中：与数据层调试一致 -->
    <div v-else-if="isListMode" class="panel-body">
      <div class="section">
        <div class="section-title row">
          <div class="method-title method-title--list">
            <span class="proc">{{ target.processorName }}</span>
            <span class="sep">/</span>
            <span class="name">{{ method?.name || method?.id }}</span>
          </div>
          <el-button
            type="primary"
            size="small"
            :icon="VideoPlay"
            :loading="running"
            @click="handleRunAll"
          >
            执行
          </el-button>
        </div>
        <div class="dry-run-row dry-run-row--list">
          <div class="dry-run-label">
            <span>试运行</span>
            <span class="dry-run-hint">开启后写入会回滚，不落库</span>
          </div>
          <el-switch v-model="dryRun" size="small" />
        </div>
      </div>

      <div class="section">
        <div class="section-title">入参</div>
        <el-empty
          v-if="!paramForms.length"
          description="该方法无入参"
          :image-size="48"
        />
        <div v-else class="param-list">
          <div
            v-for="form in paramForms"
            :key="form.param.id"
            class="param-block"
          >
            <div class="prop-label">
              <el-checkbox
                :model-value="isParamEnabled(form)"
                @update:model-value="setParamEnabled(form, $event === true)"
              />
              <span class="prop-name">{{ form.param.name }}</span>
              <span class="prop-type">{{ form.typeLabel }}</span>
            </div>

            <div v-if="!isParamEnabled(form)" class="null-hint">
              {{ disabledParamHint(form) }}
            </div>

            <template v-else-if="form.mode === 'scalar'">
              <el-switch
                v-if="form.kind === 'boolean'"
                :model-value="draft[form.param.name] === true"
                @update:model-value="
                  setScalar(form.param.name, $event === true)
                "
              />
              <el-input-number
                v-else-if="form.kind === 'number'"
                :model-value="Number(draft[form.param.name] ?? 0)"
                controls-position="right"
                style="width: 100%"
                @update:model-value="
                  setScalar(form.param.name, $event ?? 0)
                "
              />
              <el-select
                v-else-if="form.kind === 'enum'"
                :model-value="String(draft[form.param.name] ?? '')"
                clearable
                placeholder="选择"
                style="width: 100%"
                @update:model-value="
                  setScalar(form.param.name, $event ?? '')
                "
              >
                <el-option
                  v-for="opt in form.enumOptions"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
              <el-input
                v-else
                :model-value="String(draft[form.param.name] ?? '')"
                @update:model-value="
                  setScalar(form.param.name, String($event ?? ''))
                "
              />
            </template>

            <div v-else-if="form.mode === 'object'" class="object-fields">
              <div
                v-for="field in form.fields"
                :key="field.name"
                class="prop-row"
              >
                <div class="prop-label nested">
                  <span class="prop-name">{{ field.name }}</span>
                  <span v-if="field.remark" class="prop-type">{{
                    field.remark
                  }}</span>
                </div>
                <el-switch
                  v-if="field.kind === 'boolean'"
                  :model-value="
                    objectFieldValue(form.param.name, field.name) === true
                  "
                  @update:model-value="
                    setObjectField(
                      form.param.name,
                      field.name,
                      $event === true,
                    )
                  "
                />
                <el-input-number
                  v-else-if="field.kind === 'number'"
                  :model-value="
                    Number(
                      objectFieldValue(form.param.name, field.name) ?? 0,
                    )
                  "
                  controls-position="right"
                  style="width: 100%"
                  @update:model-value="
                    setObjectField(form.param.name, field.name, $event ?? 0)
                  "
                />
                <el-select
                  v-else-if="field.kind === 'enum'"
                  :model-value="
                    String(
                      objectFieldValue(form.param.name, field.name) ?? '',
                    )
                  "
                  clearable
                  placeholder="选择"
                  style="width: 100%"
                  @update:model-value="
                    setObjectField(form.param.name, field.name, $event ?? '')
                  "
                >
                  <el-option
                    v-for="opt in field.enumOptions"
                    :key="opt"
                    :label="opt"
                    :value="opt"
                  />
                </el-select>
                <el-input
                  v-else-if="field.kind === 'json' || field.kind === 'array'"
                  type="textarea"
                  :rows="2"
                  :model-value="
                    formatJson(
                      objectFieldValue(form.param.name, field.name),
                    )
                  "
                  @blur="
                    onNestedJsonBlur(
                      form.param.name,
                      field.name,
                      ($event.target as HTMLTextAreaElement).value,
                      field.kind === 'array',
                    )
                  "
                />
                <el-input
                  v-else
                  :model-value="
                    String(
                      objectFieldValue(form.param.name, field.name) ?? '',
                    )
                  "
                  @update:model-value="
                    setObjectField(
                      form.param.name,
                      field.name,
                      String($event ?? ''),
                    )
                  "
                />
              </div>
            </div>

            <el-input
              v-else
              type="textarea"
              :rows="3"
              :model-value="formatJson(draft[form.param.name])"
              @blur="
                onJsonBlur(
                  form.param.name,
                  ($event.target as HTMLTextAreaElement).value,
                  form.kind === 'array',
                )
              "
            />
          </div>
        </div>
      </div>

      <p v-if="listResultError" class="error-box">{{ listResultError }}</p>
      <p
        v-else-if="dryRun && listResultReady"
        class="dry-run-box"
      >
        试运行已回滚，数据未写入数据库
      </p>

      <div v-if="listResultReady" class="section">
        <div class="section-title">执行结果</div>
        <div class="fold-code">
          <div class="fold-body">
            <pre
              class="code-box"
              :class="{
                'is-collapsed':
                  isLongText(listResultText) && !listResultFoldOpen,
              }"
            >{{ listResultText }}</pre>
            <div
              v-if="isLongText(listResultText) && !listResultFoldOpen"
              class="fold-fade"
            />
          </div>
          <button
            v-if="isLongText(listResultText)"
            type="button"
            class="fold-toggle"
            @click="listResultFoldOpen = !listResultFoldOpen"
          >
            {{ listResultFoldOpen ? '收起' : '展开全部' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 工作流画布：逐步调试 -->
    <template v-else>
      <div class="panel-sticky">
        <div class="sticky-row" :title="stickyTitle">
          <div class="method-title">
            <span class="proc">{{ target.processorName }}</span>
            <span class="sep">/</span>
            <span class="name">{{ method?.name || method?.id }}</span>
          </div>
          <div class="summary-scroll">
            <span v-if="cursorNodeTitle" class="summary-item summary-cursor">
              执行到 {{ cursorNodeTitle }}
            </span>
            <template v-else>
              <span class="summary-item">选中 {{ selectedNodeLabel }}</span>
            </template>
            <template v-if="errorText">
              <span class="summary-sep">·</span>
              <span class="summary-error">{{ errorText }}</span>
            </template>
          </div>
        </div>
        <div class="dry-run-row">
          <div class="dry-run-label">
            <span>试运行</span>
            <span class="dry-run-hint">开启后写入会回滚，不落库</span>
          </div>
          <el-switch v-model="dryRun" size="small" />
        </div>
      </div>

      <div class="panel-scroll">
        <!-- 仅开始节点时展示入参 -->
        <div v-if="isStartSelected" class="section">
          <div class="section-title">
            入参
            <span class="section-hint">点击编辑可修改调试入参</span>
          </div>
          <el-empty
            v-if="!paramForms.length"
            description="该方法无入参"
            :image-size="40"
          />
          <div v-else class="data-list">
            <div
              v-for="form in paramForms"
              :key="form.param.id"
              class="data-row"
            >
              <div class="data-head">
                <div class="prop-label">
                  <span class="prop-name">{{ form.param.name }}</span>
                  <span class="prop-type">{{ form.typeLabel }}</span>
                </div>
                <el-button
                  type="primary"
                  link
                  :icon="EditPen"
                  @click="openParamEdit(form)"
                >
                  编辑
                </el-button>
              </div>
              <div class="fold-code">
                <div class="fold-body">
                  <pre
                    class="code-box"
                    :class="{
                      'is-collapsed':
                        isLongText(valueTextOf(draft[form.param.name])) &&
                        !isFoldExpanded(`param:${form.param.name}`),
                    }"
                  >{{ valueTextOf(draft[form.param.name]) }}</pre>
                  <div
                    v-if="
                      isLongText(valueTextOf(draft[form.param.name])) &&
                      !isFoldExpanded(`param:${form.param.name}`)
                    "
                    class="fold-fade"
                  />
                </div>
                <button
                  v-if="isLongText(valueTextOf(draft[form.param.name]))"
                  type="button"
                  class="fold-toggle"
                  @click="toggleFold(`param:${form.param.name}`)"
                >
                  {{
                    isFoldExpanded(`param:${form.param.name}`)
                      ? '收起'
                      : '展开全部'
                  }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="!isStartSelected" class="section">
          <div class="section-title">
            当前可访问数据
            <span class="section-hint">执行到节点处的工作流变量</span>
          </div>
          <el-empty
            v-if="!ambientListView.length"
            description="暂无变量"
            :image-size="40"
          />
          <div v-else class="data-list">
            <div
              v-for="item in ambientListView"
              :key="item.name"
              class="data-row"
            >
              <div class="data-head">
                <div class="prop-label">
                  <span class="prop-name">{{ item.name }}</span>
                  <span class="prop-type">{{ ambientTypeLabel(item) }}</span>
                </div>
                <el-button
                  type="primary"
                  link
                  :icon="EditPen"
                  @click="openAmbientEdit(item)"
                >
                  编辑
                </el-button>
              </div>
              <div class="fold-code">
                <div class="fold-body">
                  <pre
                    class="code-box"
                    :class="{
                      'is-collapsed':
                        isLongText(ambientTextOf(item)) &&
                        !isFoldExpanded(`var:${item.name}`),
                      'is-unset': !item.hasValue,
                    }"
                  >{{ ambientTextOf(item) }}</pre>
                  <div
                    v-if="
                      isLongText(ambientTextOf(item)) &&
                      !isFoldExpanded(`var:${item.name}`)
                    "
                    class="fold-fade"
                  />
                </div>
                <button
                  v-if="isLongText(ambientTextOf(item))"
                  type="button"
                  class="fold-toggle"
                  @click="toggleFold(`var:${item.name}`)"
                >
                  {{
                    isFoldExpanded(`var:${item.name}`) ? '收起' : '展开全部'
                  }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 入参编辑弹窗 -->
    <el-dialog
      v-model="paramDialogVisible"
      :title="`编辑入参 · ${editingParamForm?.param.name || ''}`"
      width="440px"
      append-to-body
      destroy-on-close
      @closed="editingParamForm = null"
    >
      <template v-if="editingParamForm">
        <div
          v-if="editingParamForm.mode === 'object'"
          class="object-fields"
        >
          <div
            v-for="f in editingParamForm.fields"
            :key="f.name"
            class="prop-row"
          >
            <div class="prop-label nested">
              <span class="prop-name">{{ f.name }}</span>
              <span v-if="f.remark" class="prop-type">{{ f.remark }}</span>
            </div>
            <el-switch
              v-if="f.kind === 'boolean'"
              v-model="paramEditDraft[f.name]"
              :active-value="true"
              :inactive-value="false"
            />
            <el-input-number
              v-else-if="f.kind === 'number'"
              v-model="paramEditDraft[f.name]"
              controls-position="right"
              style="width: 100%"
            />
            <el-input
              v-else
              v-model="paramEditDraft[f.name]"
            />
          </div>
        </div>
        <el-input
          v-else-if="editingParamForm.mode === 'json'"
          v-model="paramEditJson"
          type="textarea"
          :rows="10"
        />
        <template v-else>
          <el-switch
            v-if="editingParamForm.kind === 'boolean'"
            :model-value="paramEditScalar === true"
            @update:model-value="paramEditScalar = $event === true"
          />
          <el-input-number
            v-else-if="editingParamForm.kind === 'number'"
            :model-value="Number(paramEditScalar ?? 0)"
            controls-position="right"
            style="width: 100%"
            @update:model-value="paramEditScalar = $event ?? 0"
          />
          <el-select
            v-else-if="editingParamForm.kind === 'enum'"
            :model-value="String(paramEditScalar ?? '')"
            clearable
            style="width: 100%"
            @update:model-value="paramEditScalar = $event ?? ''"
          >
            <el-option
              v-for="opt in editingParamForm.enumOptions"
              :key="opt"
              :label="opt"
              :value="opt"
            />
          </el-select>
          <el-input
            v-else
            :model-value="String(paramEditScalar ?? '')"
            @update:model-value="paramEditScalar = String($event ?? '')"
          />
        </template>
      </template>
      <template #footer>
        <el-button @click="paramDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveParamEdit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 可访问数据编辑弹窗 -->
    <el-dialog
      v-model="ambientDialogVisible"
      :title="`编辑变量 · ${editingAmbient?.name || ''}`"
      width="440px"
      append-to-body
      destroy-on-close
      @closed="editingAmbient = null"
    >
      <div v-if="editingAmbient" class="ambient-edit">
        <div class="prop-label">
          <span class="prop-name">{{ editingAmbient.name }}</span>
          <span class="prop-type">{{ ambientTypeLabel(editingAmbient) }}</span>
        </div>
        <el-input
          v-if="ambientEditIsJson"
          v-model="ambientEditJson"
          type="textarea"
          :rows="12"
        />
        <el-switch
          v-else-if="editingAmbient.type === 'boolean'"
          :model-value="
            ambientEditScalar === true || ambientEditScalar === 'true'
          "
          @update:model-value="
            ambientEditScalar = $event === true ? 'true' : 'false'
          "
        />
        <el-input-number
          v-else-if="editingAmbient.type === 'number'"
          :model-value="Number(ambientEditScalar || 0)"
          controls-position="right"
          style="width: 100%"
          @update:model-value="ambientEditScalar = String($event ?? 0)"
        />
        <el-input
          v-else
          v-model="ambientEditScalar"
        />
      </div>
      <template #footer>
        <el-button @click="ambientDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAmbientEdit">确定</el-button>
      </template>
    </el-dialog>
  </aside>
</template>

<style scoped>
.debug-panel {
  width: var(--workspace-right-width, 300px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #fff;
  border-left: 1px solid #ebeef5;
}

.panel-header {
  flex-shrink: 0;
  height: 48px;
  padding: 0 12px 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.panel-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.panel-sticky {
  flex-shrink: 0;
  padding: 8px 12px 10px;
  border-bottom: 1px solid #ebeef5;
  background: #fff;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.panel-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.section-hint {
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
}

.sticky-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 32px;
}

.method-title {
  flex-shrink: 0;
  max-width: 88px;
  display: flex;
  align-items: baseline;
  gap: 2px;
  font-size: 12px;
  overflow: hidden;
}

.summary-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  font-size: 12px;
  color: #64748b;
  scrollbar-width: none;
}

.summary-scroll::-webkit-scrollbar {
  display: none;
}

.action-icons {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}

.action-icons .el-button {
  margin: 0;
}

.dry-run-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f8fafc;
  border: 1px solid #ebeef5;
}

.dry-run-label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dry-run-label > span:first-child {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
}

.dry-run-hint {
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.3;
}

.proc {
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sep {
  color: #cbd5e1;
  flex-shrink: 0;
}

.name {
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-item {
  flex-shrink: 0;
}

.summary-item.muted {
  color: #94a3b8;
}

.summary-cursor {
  color: #409eff;
  font-weight: 500;
}

.summary-sep {
  flex-shrink: 0;
  margin: 0 5px;
  color: #cbd5e1;
}

.summary-error {
  flex-shrink: 0;
  color: #f56c6c;
}

.data-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.data-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.data-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.prop-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.prop-label.nested {
  margin-bottom: 0;
}

.prop-name {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
}

.prop-type {
  font-size: 12px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fold-code {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.fold-body {
  position: relative;
}

.code-box {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  background: #fafafa;
  color: #606266;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
}

.code-box.is-unset {
  color: #e6a23c;
}

.code-box.is-collapsed {
  max-height: 156px;
}

.fold-fade {
  position: absolute;
  left: 1px;
  right: 1px;
  bottom: 1px;
  height: 40px;
  border-radius: 0 0 7px 7px;
  background: linear-gradient(
    to bottom,
    rgba(250, 250, 250, 0),
    #fafafa 85%
  );
  pointer-events: none;
}

.fold-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: 2px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: #409eff;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.4;
}

.fold-toggle:hover {
  color: #79bbff;
}

.object-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.prop-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ambient-edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scrollbar-width: none;
}

.panel-body::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.section-title.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.method-title--list {
  max-width: none;
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.dry-run-row--list {
  margin-top: 0;
}

.param-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.param-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.null-hint {
  font-size: 12px;
  color: #909399;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 32px;
}

.error-box {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.4;
}

.dry-run-box {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fdf6ec;
  color: #e6a23c;
  font-size: 12px;
  line-height: 1.4;
}
</style>
