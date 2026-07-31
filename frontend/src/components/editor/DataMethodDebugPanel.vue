<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, EditPen, Plus, VideoPlay } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { debugDataLayerMethod } from '../../api/projects'
import type {
  ProcessorMethod,
  ProcessorMethodParam,
  ProcessorTypeExpr,
} from '../../types/backend-services'
import type {
  DataTypeDef,
  DataTypeLibrary,
  InterfaceField,
  TypeExpr,
} from '../../types/data-types'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import { arrayTypeLabel } from '../../types/page-data'

export type DataMethodDebugTarget = {
  projectPath: string
  serviceId: string
  processorId: string
  processorName: string
  method: ProcessorMethod
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
  mode: 'scalar' | 'object' | 'json' | 'array'
  typeLabel: string
  kind: FieldKind
  enumOptions: string[]
  fields: ObjectFieldForm[]
  /** 标量数组元素类型（fields 为空时） */
  itemKind?: FieldKind
  itemEnumOptions?: string[]
}

const props = defineProps<{
  target: DataMethodDebugTarget | null
  typeLibrary: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:debug-params': [params: Record<string, unknown>]
}>()

/** 顶层入参值 */
const draft = reactive<Record<string, unknown>>({})
/** 对象类入参是否启用（不勾选则为禁用值） */
const paramEnabled = reactive<Record<string, boolean>>({})
/** 取消勾选时暂存上次启用值，便于恢复 */
const paramStash = reactive<Record<string, unknown>>({})
const running = ref(false)
/** 试运行：写入走事务并回滚，默认开启 */
const dryRun = ref(true)
const resultSql = ref('')
const resultRaw = ref<unknown>(null)
const resultOutput = ref<unknown>(null)
const resultError = ref('')
const resultDryRun = ref(false)
/** 结果区折叠展开 */
const foldOpen = reactive({
  sql: false,
  raw: false,
  output: false,
})

const FOLD_MAX_LINES = 10
const FOLD_MAX_CHARS = 480

function isLongText(text: string): boolean {
  if (!text) return false
  if (text.length > FOLD_MAX_CHARS) return true
  return text.split('\n').length > FOLD_MAX_LINES
}

function resetFoldOpen() {
  foldOpen.sql = false
  foldOpen.raw = false
  foldOpen.output = false
}

const resultRawText = computed(() => formatJson(resultRaw.value))
const resultOutputText = computed(() => formatJson(resultOutput.value))
const resultSqlText = computed(() => resultSql.value || '—')

const itemDialogVisible = ref(false)
const itemDialogTitle = ref('')
const itemEditParam = ref('')
const itemEditIndex = ref(-1)
const itemEditFields = ref<ObjectFieldForm[]>([])
const itemEditIsObject = ref(true)
const itemEditKind = ref<FieldKind>('string')
const itemEditEnumOptions = ref<string[]>([])
const itemEditDraft = reactive<Record<string, unknown>>({})
const itemEditScalar = ref<unknown>('')

const method = computed(() => props.target?.method ?? null)
const methodUnavailable = computed(() => Boolean(method.value?.disabled))
const unavailableHint = computed(() => {
  if (!methodUnavailable.value) return ''
  if (method.value?.name === 'deleteById' || method.value?.id === 'preset_deleteById') {
    return '请先在数据表设计中勾选逻辑删除字段，才能使用 deleteById'
  }
  return '该方法当前不可用'
})

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

/** 勾选后的默认可编辑值 */
function defaultEnabledParamValue(form: ParamFormModel): unknown {
  if (form.mode === 'object') return buildObjectDefault(form.fields)
  if (form.mode === 'json') return {}
  if (form.mode === 'array' || form.kind === 'array') return []
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
  persistDebugParams()
}

function primaryAtom(expr: TypeExpr | undefined | null) {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
}

function fieldKindFromTypeExpr(
  expr: TypeExpr,
  library: DataTypeLibrary | null,
): { kind: FieldKind; enumOptions: string[]; typeRef?: string } {
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
        typeRef: mapped.typeRef,
      }
    }
    if (def?.kind === 'interface') {
      return { kind: 'json', enumOptions: [], typeRef: mapped.typeRef }
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

function atomTypeLabel(type: string, typeRef: string): string {
  if (typeRef) return namedTypeLabel(typeRef)
  if (type === 'json') return 'object'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'string' || !type) return 'string'
  return type
}

function resolveParamForm(param: ProcessorMethodParam): ParamFormModel {
  const expr: ProcessorTypeExpr = param.typeExpr

  if (expr.type === 'array') {
    // 嵌套数组仍用 JSON
    if (expr.itemType === 'array') {
      const leaf = atomTypeLabel(expr.itemItemType, expr.itemItemTypeRef)
      return {
        param,
        mode: 'json',
        typeLabel: arrayTypeLabel(leaf, 2),
        kind: 'array',
        enumOptions: [],
        fields: [],
      }
    }

    const ref = expr.itemTypeRef
    if (ref) {
      const def = findDataTypeDef(props.typeLibrary, ref)
      if (def?.kind === 'interface') {
        const fields = objectFieldsOf(def)
        if (fields.length) {
          return {
            param,
            mode: 'array',
            typeLabel: arrayTypeLabel(def.name || ref),
            kind: 'array',
            enumOptions: [],
            fields,
          }
        }
      }
      if (def?.kind === 'enum') {
        return {
          param,
          mode: 'array',
          typeLabel: arrayTypeLabel(def.name || ref),
          kind: 'array',
          enumOptions: [],
          fields: [],
          itemKind: 'enum',
          itemEnumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
        }
      }
    }

    const itemType = expr.itemType || 'string'
    const itemKind: FieldKind =
      itemType === 'number'
        ? 'number'
        : itemType === 'boolean'
          ? 'boolean'
          : itemType === 'json'
            ? 'json'
            : 'string'
    return {
      param,
      mode: 'array',
      typeLabel: arrayTypeLabel(atomTypeLabel(itemType, ref)),
      kind: 'array',
      enumOptions: [],
      fields: [],
      itemKind,
      itemEnumOptions: [],
    }
  }

  const typeLabel = (() => {
    if (expr.typeRef) return namedTypeLabel(expr.typeRef)
    if (expr.type === 'json') return 'object'
    if (expr.type === 'number') return 'number'
    if (expr.type === 'boolean') return 'boolean'
    return expr.type || 'string'
  })()

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
    if (def?.kind === 'number') {
      return {
        param,
        mode: 'scalar',
        typeLabel,
        kind: 'number',
        enumOptions: [],
        fields: [],
      }
    }
    if (def?.kind === 'boolean') {
      return {
        param,
        mode: 'scalar',
        typeLabel,
        kind: 'boolean',
        enumOptions: [],
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
  if (t === 'json') {
    return {
      param,
      mode: 'json',
      typeLabel,
      kind: 'json',
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
    .map(resolveParamForm),
)

function coerceArrayValue(prev: unknown): unknown[] {
  if (Array.isArray(prev)) return prev
  if (prev && typeof prev === 'object') return [prev]
  if (prev !== undefined && prev !== null) return [prev]
  return []
}

function syncDraftFromMethod(options?: { clearResults?: boolean }) {
  for (const key of Object.keys(draft)) delete draft[key]
  for (const key of Object.keys(paramEnabled)) delete paramEnabled[key]
  for (const key of Object.keys(paramStash)) delete paramStash[key]
  const saved = method.value?.debugParams ?? {}
  let shouldPersist = false
  for (const form of paramForms.value) {
    const name = form.param.name.trim()
    const prev = saved[name]
    // 数字/布尔无法从 0/false 区分「未勾选」，默认勾选；其余 null 视为未勾选
    const canInferOff =
      form.kind !== 'number' &&
      form.kind !== 'boolean' &&
      prev === null
    if (canInferOff) {
      draft[name] = disabledParamValue(form)
      paramEnabled[name] = false
      continue
    }
    paramEnabled[name] = true
    if (form.mode === 'object') {
      const base = buildObjectDefault(form.fields)
      if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
        draft[name] = { ...base, ...(prev as Record<string, unknown>) }
      } else {
        draft[name] = base
      }
    } else if (form.kind === 'number') {
      draft[name] =
        typeof prev === 'number' ? prev : Number(prev ?? 0) || 0
    } else if (form.kind === 'boolean') {
      draft[name] = prev === true || prev === 'true'
    } else if (form.mode === 'array' || form.kind === 'array') {
      const next = coerceArrayValue(prev)
      draft[name] = next
      if (prev !== undefined && !Array.isArray(prev)) shouldPersist = true
      if (prev === undefined) shouldPersist = true
    } else if (form.mode === 'json') {
      draft[name] = prev !== undefined && prev !== null ? prev : {}
    } else {
      draft[name] = prev !== undefined && prev !== null ? String(prev) : ''
    }
  }
  if (shouldPersist) persistDebugParams()
  if (options?.clearResults !== false) {
    resultSql.value = ''
    resultRaw.value = null
    resultOutput.value = null
    resultError.value = ''
    resultDryRun.value = false
    resetFoldOpen()
  }
}

function methodSyncKey(target: DataMethodDebugTarget | null): string {
  if (!target) return ''
  const paramsKey = target.method.params
    .map((p) => {
      const e = p.typeExpr
      return [
        p.id,
        p.name,
        e?.type,
        e?.typeRef,
        e?.itemType,
        e?.itemTypeRef,
        e?.itemItemType,
        e?.itemItemTypeRef,
      ].join(':')
    })
    .join('|')
  return `${target.processorId}::${target.method.id}::${paramsKey}`
}

watch(
  () => methodSyncKey(props.target),
  (key, prev) => {
    if (!props.target || !key) return
    if (key === prev) return
    syncDraftFromMethod({ clearResults: true })
  },
  { immediate: true },
)

let saveTimer: ReturnType<typeof setTimeout> | null = null

function persistDebugParams() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    emit('update:debug-params', collectParams())
  }, 400)
}

function collectParams(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const form of paramForms.value) {
    const name = form.param.name.trim()
    out[name] = draft[name]
  }
  return out
}

function setScalar(name: string, value: unknown) {
  draft[name] = value
  persistDebugParams()
}

function setObjectField(paramName: string, fieldName: string, value: unknown) {
  const cur =
    draft[paramName] &&
    typeof draft[paramName] === 'object' &&
    !Array.isArray(draft[paramName])
      ? { ...(draft[paramName] as Record<string, unknown>) }
      : {}
  cur[fieldName] = value
  draft[paramName] = cur
  persistDebugParams()
}

function objectFieldValue(paramName: string, fieldName: string): unknown {
  const obj = draft[paramName]
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return (obj as Record<string, unknown>)[fieldName]
  }
  return undefined
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}

function onJsonBlur(paramName: string, text: string, asArray: boolean) {
  const raw = text.trim()
  if (!raw) {
    draft[paramName] = asArray ? [] : {}
    persistDebugParams()
    return
  }
  try {
    const parsed = JSON.parse(raw)
    if (asArray) {
      draft[paramName] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
          ? [parsed]
          : [parsed]
    } else {
      draft[paramName] = parsed
    }
    persistDebugParams()
  } catch {
    // keep previous
  }
}

function onNestedJsonBlur(
  paramName: string,
  fieldName: string,
  text: string,
  asArray: boolean,
) {
  const raw = text.trim()
  if (!raw) {
    setObjectField(paramName, fieldName, asArray ? [] : {})
    return
  }
  try {
    setObjectField(paramName, fieldName, JSON.parse(raw))
  } catch {
    // keep previous
  }
}

function getArrayItems(paramName: string): unknown[] {
  const v = draft[paramName]
  return Array.isArray(v) ? v : []
}

function summarizeItem(item: unknown, fields: ObjectFieldForm[]): string {
  if (item == null) return '空'
  if (!fields.length) {
    if (typeof item === 'object') return formatJson(item)
    return String(item)
  }
  if (typeof item !== 'object' || Array.isArray(item)) {
    return String(item)
  }
  const obj = item as Record<string, unknown>
  const parts: string[] = []
  for (const f of fields.slice(0, 3)) {
    const v = obj[f.name]
    if (v === undefined || v === '') continue
    const text =
      typeof v === 'object' ? formatJson(v) : String(v)
    parts.push(`${f.name}: ${text}`)
  }
  return parts.length ? parts.join(' · ') : '（空）'
}

function clearItemEditDraft() {
  for (const key of Object.keys(itemEditDraft)) delete itemEditDraft[key]
}

function openAddArrayItem(form: ParamFormModel) {
  itemEditParam.value = form.param.name.trim()
  itemEditIndex.value = -1
  itemEditFields.value = form.fields
  itemEditIsObject.value = form.fields.length > 0
  itemEditKind.value = form.itemKind || 'string'
  itemEditEnumOptions.value = form.itemEnumOptions || []
  itemDialogTitle.value = `添加 · ${form.param.name}`
  clearItemEditDraft()
  if (itemEditIsObject.value) {
    Object.assign(itemEditDraft, buildObjectDefault(form.fields))
  } else {
    itemEditScalar.value = defaultForKind(itemEditKind.value)
  }
  itemDialogVisible.value = true
}

function openEditArrayItem(form: ParamFormModel, index: number) {
  const items = getArrayItems(form.param.name.trim())
  const current = items[index]
  itemEditParam.value = form.param.name.trim()
  itemEditIndex.value = index
  itemEditFields.value = form.fields
  itemEditIsObject.value = form.fields.length > 0
  itemEditKind.value = form.itemKind || 'string'
  itemEditEnumOptions.value = form.itemEnumOptions || []
  itemDialogTitle.value = `编辑 · ${form.param.name}[${index}]`
  clearItemEditDraft()
  if (itemEditIsObject.value) {
    const base = buildObjectDefault(form.fields)
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      Object.assign(itemEditDraft, base, current as Record<string, unknown>)
    } else {
      Object.assign(itemEditDraft, base)
    }
  } else {
    itemEditScalar.value =
      current !== undefined ? current : defaultForKind(itemEditKind.value)
  }
  itemDialogVisible.value = true
}

function removeArrayItem(paramName: string, index: number) {
  const next = [...getArrayItems(paramName)]
  next.splice(index, 1)
  draft[paramName] = next
  persistDebugParams()
}

function saveItemDialog() {
  const name = itemEditParam.value
  if (!name) return
  const next = [...getArrayItems(name)]
  const value = itemEditIsObject.value
    ? { ...itemEditDraft }
    : itemEditScalar.value
  if (itemEditIndex.value < 0) {
    next.push(value)
  } else {
    next[itemEditIndex.value] = value
  }
  draft[name] = next
  persistDebugParams()
  itemDialogVisible.value = false
}

function setItemField(fieldName: string, value: unknown) {
  itemEditDraft[fieldName] = value
}

function onItemNestedJsonBlur(
  fieldName: string,
  text: string,
  asArray: boolean,
) {
  const raw = text.trim()
  if (!raw) {
    setItemField(fieldName, asArray ? [] : {})
    return
  }
  try {
    setItemField(fieldName, JSON.parse(raw))
  } catch {
    // keep
  }
}

function onItemScalarJsonBlur(text: string) {
  const raw = text.trim()
  if (!raw) {
    itemEditScalar.value = itemEditKind.value === 'array' ? [] : {}
    return
  }
  try {
    itemEditScalar.value = JSON.parse(raw)
  } catch {
    // keep
  }
}

async function handleRun() {
  if (!props.target) return
  if (methodUnavailable.value) {
    ElMessage.warning(unavailableHint.value || '该方法不可用')
    return
  }
  const params = collectParams()
  emit('update:debug-params', params)
  running.value = true
  resultError.value = ''
  try {
    const res = await debugDataLayerMethod({
      projectPath: props.target.projectPath,
      serviceId: props.target.serviceId,
      processorId: props.target.processorId,
      methodId: props.target.method.id,
      params,
      dryRun: dryRun.value,
    })
    resultSql.value = res.sql
    resultRaw.value = res.raw
    resultOutput.value = res.output
    resultDryRun.value = res.dryRun === true
    resetFoldOpen()
  } catch (err) {
    resultError.value = err instanceof Error ? err.message : '执行失败'
    resultSql.value = ''
    resultRaw.value = null
    resultOutput.value = null
    resultDryRun.value = false
    resetFoldOpen()
    ElMessage.error(resultError.value)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <aside class="debug-panel">
    <div class="panel-header">调试</div>
    <div v-if="!target" class="panel-empty">
      <el-empty description="选中数据层方法后可调试" :image-size="48" />
    </div>
    <div v-else class="panel-body">
      <div class="section">
        <div class="section-title row">
          <div class="method-title">
            <span class="proc">{{ target.processorName }}</span>
            <span class="sep">/</span>
            <span class="name">{{ method?.name || method?.id }}</span>
          </div>
          <el-button
            type="primary"
            size="small"
            :icon="VideoPlay"
            :loading="running"
            :disabled="methodUnavailable"
            @click="handleRun"
          >
            执行
          </el-button>
        </div>
        <el-alert
          v-if="methodUnavailable"
          class="unavailable-alert"
          type="warning"
          :closable="false"
          show-icon
          :title="unavailableHint"
        />
        <div class="dry-run-row">
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
          <div v-for="form in paramForms" :key="form.param.id" class="param-block">
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

            <!-- 标量 -->
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

            <!-- 具名对象：展开字段 -->
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

            <!-- 数组：逐项列表 -->
            <div v-else-if="form.mode === 'array'" class="array-list">
              <div
                v-if="!getArrayItems(form.param.name).length"
                class="array-empty"
              >
                暂无数据，点击下方添加
              </div>
              <div
                v-for="(item, index) in getArrayItems(form.param.name)"
                :key="`${form.param.id}-${index}`"
                class="array-item"
                @click="openEditArrayItem(form, index)"
              >
                <div class="array-item-main">
                  <span class="array-index">{{ index + 1 }}</span>
                  <span class="array-summary">{{
                    summarizeItem(item, form.fields)
                  }}</span>
                </div>
                <div class="array-item-actions" @click.stop>
                  <el-button
                    type="primary"
                    link
                    :icon="EditPen"
                    @click="openEditArrayItem(form, index)"
                  />
                  <el-button
                    type="danger"
                    link
                    :icon="Delete"
                    @click="removeArrayItem(form.param.name, index)"
                  />
                </div>
              </div>
              <el-button
                class="array-add"
                type="primary"
                link
                :icon="Plus"
                @click="openAddArrayItem(form)"
              >
                添加
              </el-button>
            </div>

            <!-- 无法展开的对象/嵌套数组 -->
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

      <p v-if="resultError" class="error-box">{{ resultError }}</p>
      <p v-else-if="resultDryRun && (resultSql || resultRaw != null)" class="dry-run-box">
        试运行已回滚，数据未写入数据库
      </p>

      <template v-if="resultSql || resultRaw != null">
        <div class="section">
          <div class="section-title">查询语句</div>
          <div class="fold-code">
            <div class="fold-body">
              <pre
                class="code-box"
                :class="{
                  'is-collapsed': isLongText(resultSqlText) && !foldOpen.sql,
                }"
              >{{ resultSqlText }}</pre>
              <div
                v-if="isLongText(resultSqlText) && !foldOpen.sql"
                class="fold-fade"
              />
            </div>
            <button
              v-if="isLongText(resultSqlText)"
              type="button"
              class="fold-toggle"
              @click="foldOpen.sql = !foldOpen.sql"
            >
              {{ foldOpen.sql ? '收起' : '展开全部' }}
            </button>
          </div>
        </div>
        <div class="section">
          <div class="section-title">数据源返回</div>
          <div class="fold-code">
            <div class="fold-body">
              <pre
                class="code-box"
                :class="{
                  'is-collapsed': isLongText(resultRawText) && !foldOpen.raw,
                }"
              >{{ resultRawText }}</pre>
              <div
                v-if="isLongText(resultRawText) && !foldOpen.raw"
                class="fold-fade"
              />
            </div>
            <button
              v-if="isLongText(resultRawText)"
              type="button"
              class="fold-toggle"
              @click="foldOpen.raw = !foldOpen.raw"
            >
              {{ foldOpen.raw ? '收起' : '展开全部' }}
            </button>
          </div>
        </div>
        <div class="section">
          <div class="section-title">出参数据</div>
          <div class="fold-code">
            <div class="fold-body">
              <pre
                class="code-box"
                :class="{
                  'is-collapsed':
                    isLongText(resultOutputText) && !foldOpen.output,
                }"
              >{{ resultOutputText }}</pre>
              <div
                v-if="isLongText(resultOutputText) && !foldOpen.output"
                class="fold-fade"
              />
            </div>
            <button
              v-if="isLongText(resultOutputText)"
              type="button"
              class="fold-toggle"
              @click="foldOpen.output = !foldOpen.output"
            >
              {{ foldOpen.output ? '收起' : '展开全部' }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <el-dialog
      v-model="itemDialogVisible"
      :title="itemDialogTitle"
      width="420px"
      append-to-body
      destroy-on-close
      class="array-item-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
      <div v-if="itemEditIsObject" class="item-form">
        <div
          v-for="field in itemEditFields"
          :key="field.name"
          class="item-form-row"
        >
          <div class="item-form-label">
            <span class="prop-name">{{ field.name }}</span>
            <span v-if="field.remark" class="prop-type">{{ field.remark }}</span>
          </div>
          <el-switch
            v-if="field.kind === 'boolean'"
            :model-value="itemEditDraft[field.name] === true"
            @update:model-value="setItemField(field.name, $event === true)"
          />
          <el-input-number
            v-else-if="field.kind === 'number'"
            :model-value="Number(itemEditDraft[field.name] ?? 0)"
            controls-position="right"
            style="width: 100%"
            @update:model-value="setItemField(field.name, $event ?? 0)"
          />
          <el-select
            v-else-if="field.kind === 'enum'"
            :model-value="String(itemEditDraft[field.name] ?? '')"
            clearable
            placeholder="选择"
            style="width: 100%"
            @update:model-value="setItemField(field.name, $event ?? '')"
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
            :rows="3"
            :model-value="formatJson(itemEditDraft[field.name])"
            @blur="
              onItemNestedJsonBlur(
                field.name,
                ($event.target as HTMLTextAreaElement).value,
                field.kind === 'array',
              )
            "
          />
          <el-input
            v-else
            :model-value="String(itemEditDraft[field.name] ?? '')"
            @update:model-value="
              setItemField(field.name, String($event ?? ''))
            "
          />
        </div>
      </div>
      <div v-else class="item-form">
        <div class="item-form-row">
          <div class="item-form-label">
            <span class="prop-name">值</span>
          </div>
          <el-switch
            v-if="itemEditKind === 'boolean'"
            :model-value="itemEditScalar === true"
            @update:model-value="itemEditScalar = $event === true"
          />
          <el-input-number
            v-else-if="itemEditKind === 'number'"
            :model-value="Number(itemEditScalar ?? 0)"
            controls-position="right"
            style="width: 100%"
            @update:model-value="itemEditScalar = $event ?? 0"
          />
          <el-select
            v-else-if="itemEditKind === 'enum'"
            :model-value="String(itemEditScalar ?? '')"
            clearable
            placeholder="选择"
            style="width: 100%"
            @update:model-value="itemEditScalar = $event ?? ''"
          >
            <el-option
              v-for="opt in itemEditEnumOptions"
              :key="opt"
              :label="opt"
              :value="opt"
            />
          </el-select>
          <el-input
            v-else-if="itemEditKind === 'json' || itemEditKind === 'array'"
            type="textarea"
            :rows="4"
            :model-value="formatJson(itemEditScalar)"
            @blur="
              onItemScalarJsonBlur(
                ($event.target as HTMLTextAreaElement).value,
              )
            "
          />
          <el-input
            v-else
            :model-value="String(itemEditScalar ?? '')"
            @update:model-value="itemEditScalar = String($event ?? '')"
          />
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="saveItemDialog">确定</el-button>
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
  padding: 0 14px;
  display: flex;
  align-items: center;
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
  padding: 16px;
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
  scrollbar-gutter: auto;
}

.panel-body::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.section-title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.section-title.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 0;
}

.unavailable-alert {
  margin-top: 10px;
}

.dry-run-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
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

.method-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
}

.proc {
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sep {
  color: #cbd5e1;
}

.name {
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.prop-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.prop-label.nested {
  margin-bottom: 0;
  align-items: baseline;
}

.null-hint {
  font-size: 12px;
  color: #909399;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 32px;
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

.array-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.array-empty {
  padding: 12px;
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
}

.array-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 8px 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}

.array-item:hover {
  border-color: #c6e2ff;
  background: #f5f9ff;
}

.array-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.array-index {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}

.array-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #606266;
}

.array-item-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.array-add {
  align-self: flex-start;
  margin-top: 2px;
}

.item-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.item-form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item-form-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
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
