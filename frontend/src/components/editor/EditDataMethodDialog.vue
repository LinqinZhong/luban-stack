<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import {
  DATA_METHOD_CONDITION_OP_OPTIONS,
  DATA_METHOD_OPERATION_OPTIONS,
  DATA_METHOD_SOURCE_OPTIONS,
  CUSTOM_CONDITION_FIELD,
  createEmptyDataMethodCondition,
  createEmptyDataMethodConditionGroup,
  createEmptyDataMethodConfig,
  createEmptyProcessorTypeExpr,
  type DataMethodCondition,
  type DataMethodConditionGroup,
  type DataMethodConditionOp,
  type DataMethodConfig,
  type DataMethodFieldMapping,
  type DataMethodOperation,
  type DataMethodSourceKind,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import {
  unwrapArrayAtom,
  type DataTypeLibrary,
  type InterfaceField,
  type TypeExpr,
} from '../../types/data-types'
import {
  typeLabel,
  type DataFieldType,
} from '../../types/page-data'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect.vue'
import MethodParamsDialog from './MethodParamsDialog.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'
import { DM } from './edit-data-method-copy'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = ['color', 'ref', 'icon']

export type OutputFieldOption = {
  name: string
  remark: string
  sourceLabel?: string
}

export type DataMethodEditPayload = {
  name: string
  params: ProcessorMethodParam[]
  output: ProcessorTypeExpr
  dataConfig: DataMethodConfig
}

const props = defineProps<{
  modelValue: boolean
  method: ProcessorMethod | null
  typeLibrary: DataTypeLibrary | null
  typeOptions: Array<{ id: string; label: string }>
  /** ??????????? id???????????? */
  entityRef?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: DataMethodEditPayload]
}>()

const draft = reactive<DataMethodConfig>(createEmptyDataMethodConfig())
const draftName = ref('')
const draftParams = ref<ProcessorMethodParam[]>([])
const draftOutput = ref<ProcessorTypeExpr>(createEmptyProcessorTypeExpr())
/** ??/????????????? */
const insertEnabled = ref<string[]>([])

const paramsDialogVisible = ref(false)
const genericVisible = ref(false)
const genericNames = ref<string[]>([])
const genericTypeName = ref('')
const genericArgs = ref<Record<string, string>>({})

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

function leafNamedRef(expr: ProcessorTypeExpr): string {
  if (expr.type === 'array') {
    if (expr.itemType === 'array') return expr.itemItemTypeRef || ''
    return expr.itemTypeRef || ''
  }
  return expr.typeRef || ''
}

function primaryAtom(expr: TypeExpr | undefined | null) {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
}

function fieldsOf(def: { fields: InterfaceField[] } | null | undefined): OutputFieldOption[] {
  if (!def) return []
  return def.fields
    .map((f) => ({
      name: f.name.trim(),
      remark: f.remark?.trim() || '',
    }))
    .filter((f) => f.name)
}

/** ????????????????????? QueryPageVo<T> ? T????????????? */
function resolveOutputFields(
  output: ProcessorTypeExpr,
  library: DataTypeLibrary | null,
): OutputFieldOption[] {
  const named = leafNamedRef(output)
  const def = findDataTypeDef(library, named)
  if (def && def.kind === 'interface') {
    const genericField = def.fields.find((f) => {
      const atom = unwrapArrayAtom(primaryAtom(f.type))
      return atom.kind === 'generic'
    })
    if (genericField) {
      const gName = unwrapArrayAtom(primaryAtom(genericField.type)).ref ?? ''
      const boundId = (output.genericArgs?.[gName] ?? '').trim()
      const bound = findDataTypeDef(library, boundId)
      if (bound?.kind === 'interface') {
        const nested = fieldsOf(bound)
        if (nested.length) {
          return nested.map((f) => ({
            ...f,
            sourceLabel: bound.name,
          }))
        }
      }
    }

    return fieldsOf(def).map((f) => ({
      ...f,
      sourceLabel: def.name,
    }))
  }

  // ?? / ??? / ?? / ??????????????
  const t = (output.type || '').trim()
  if (!t) return []

  let label = ''
  if (named) {
    label = def?.name?.trim() || named
    if (t === 'array') label = `${label}[]`
  } else if (t === 'array') {
    const item =
      typeLabel((output.itemType || 'string') as DataFieldType) ||
      output.itemType ||
      '??'
    label = `?? / ${item}`
  } else {
    label = typeLabel(t as DataFieldType) || t
  }

  return [
    {
      name: 'value',
      remark: label,
      sourceLabel: label,
    },
  ]
}

function displayRemark(name: string, remark: string): string {
  const r = remark.trim()
  if (!r || r === name) return ''
  return r
}

const outputFields = computed(() =>
  resolveOutputFields(draftOutput.value, props.typeLibrary),
)

const outputFieldNames = computed(() => outputFields.value.map((f) => f.name))

const isQuery = computed(() => draft.operation === 'query')
const isCustom = computed(() => draft.operation === 'custom')
const isInsert = computed(
  () => draft.operation === 'insert' || draft.operation === 'batchInsert',
)
const isBatchInsert = computed(() => draft.operation === 'batchInsert')
/** ?????????? */
const showConditions = computed(() => !isInsert.value)
const isMysql = computed(() => draft.source === 'mysql')

type ConditionValueUi = 'string' | 'number' | 'boolean' | 'datetime'

type ConditionFieldOption = {
  value: string
  label: string
  valueUi: ConditionValueUi
}

function inferValueUi(
  fieldName: string,
  typeExpr?: TypeExpr | null,
): ConditionValueUi {
  if (typeExpr) {
    const mapped = typeExprToDataFieldType(typeExpr, props.typeLibrary)
    if (mapped.type === 'number') return 'number'
    if (mapped.type === 'boolean') return 'boolean'
    if (mapped.typeRef) {
      const def = findDataTypeDef(props.typeLibrary, mapped.typeRef)
      const n = (def?.name || '').toLowerCase()
      if (n.includes('date') || n.includes('time')) return 'datetime'
    }
  }
  const n = fieldName.toLowerCase()
  if (
    n.includes('time') ||
    n.includes('date') ||
    n.endsWith('at') ||
    n.includes('datetime')
  ) {
    return 'datetime'
  }
  return 'string'
}

const conditionFieldOptions = computed((): ConditionFieldOption[] => {
  const def = findDataTypeDef(props.typeLibrary, props.entityRef ?? '')
  const opts: ConditionFieldOption[] = []
  if (def?.kind === 'interface') {
    for (const f of def.fields) {
      const name = f.name.trim()
      if (!name) continue
      opts.push({
        value: name,
        label: f.remark?.trim() ? `${name}${DM.mid}${f.remark.trim()}` : name,
        valueUi: inferValueUi(name, f.type),
      })
    }
  }
  opts.push({
    value: CUSTOM_CONDITION_FIELD,
    label: DM.custom,
    valueUi: 'string',
  })
  return opts
})

type SourceOption = { value: string; label: string }

/** ?????????? */
const conditionParamOptions = computed((): SourceOption[] => {
  const opts: SourceOption[] = []
  for (const p of draftParams.value) {
    const name = p.name.trim()
    if (!name) continue
    const expr = p.typeExpr
    if (expr.type === 'array') continue
    if (expr.typeRef) {
      const def = findDataTypeDef(props.typeLibrary, expr.typeRef)
      if (def?.kind === 'interface') {
        for (const f of fieldsOf(def)) {
          opts.push({
            value: `${name}.${f.name}`,
            label: `${name}.${f.name}`,
          })
        }
        continue
      }
    }
    opts.push({ value: name, label: name })
  }
  return opts
})

function conditionOpMeta(op: DataMethodConditionOp) {
  return (
    DATA_METHOD_CONDITION_OP_OPTIONS.find((o) => o.value === op) ??
    DATA_METHOD_CONDITION_OP_OPTIONS[0]!
  )
}

function conditionColumnName(cond: DataMethodCondition): string {
  if (cond.field === CUSTOM_CONDITION_FIELD || !cond.field) {
    return cond.customField.trim()
  }
  return cond.field.trim()
}

function conditionValueUi(cond: DataMethodCondition): ConditionValueUi {
  if (cond.field === CUSTOM_CONDITION_FIELD || !cond.field) return 'string'
  return (
    conditionFieldOptions.value.find((o) => o.value === cond.field)?.valueUi ??
    'string'
  )
}

const entityFields = computed(() => {
  const def = findDataTypeDef(props.typeLibrary, props.entityRef ?? '')
  if (!def || def.kind !== 'interface') return [] as OutputFieldOption[]
  return fieldsOf(def).map((f) => ({
    ...f,
    sourceLabel: def.name,
  }))
})

/** ????????????? */
const arrayParamOptions = computed((): SourceOption[] => {
  const opts: SourceOption[] = []
  for (const p of draftParams.value) {
    const name = p.name.trim()
    if (!name || p.typeExpr.type !== 'array') continue
    const itemRef =
      p.typeExpr.itemType === 'array'
        ? p.typeExpr.itemItemTypeRef
        : p.typeExpr.itemTypeRef
    const typeName = itemRef
      ? findDataTypeDef(props.typeLibrary, itemRef)?.name || itemRef
      : p.typeExpr.itemType || DM.element
    opts.push({
      value: name,
      label: `${name}${DM.mid}${typeName}[]`,
    })
  }
  return opts
})

/** ?? / ?????????? */
const insertSourceOptions = computed((): SourceOption[] => {
  const opts: SourceOption[] = []

  if (isBatchInsert.value) {
    const arrayName = draft.batchSourceParam.trim()
    if (!arrayName) return opts
    const p = draftParams.value.find((x) => x.name.trim() === arrayName)
    if (!p || p.typeExpr.type !== 'array') return opts
    const expr = p.typeExpr
    const itemRef =
      expr.itemType === 'array' ? expr.itemItemTypeRef : expr.itemTypeRef
    const itemType =
      expr.itemType === 'array' ? expr.itemItemType : expr.itemType
    if (itemRef) {
      const def = findDataTypeDef(props.typeLibrary, itemRef)
      if (def?.kind === 'interface') {
        for (const f of fieldsOf(def)) {
          opts.push({
            value: `${arrayName}.${f.name}`,
            label: `${f.name}${f.remark ? `${DM.mid}${f.remark}` : ''}`,
          })
        }
        return opts
      }
    }
    if (itemType && itemType !== 'json' && itemType !== 'array') {
      opts.push({ value: arrayName, label: DM.elementSelf })
    }
    return opts
  }

  for (const p of draftParams.value) {
    const name = p.name.trim()
    if (!name) continue
    const expr = p.typeExpr
    if (expr.type === 'array') continue
    if (expr.typeRef || (expr.type === 'json' && expr.typeRef)) {
      const def = findDataTypeDef(props.typeLibrary, expr.typeRef)
      if (def?.kind === 'interface') {
        for (const f of fieldsOf(def)) {
          opts.push({
            value: `${name}.${f.name}`,
            label: `${name}.${f.name}${f.remark ? `${DM.mid}${f.remark}` : ''}`,
          })
        }
        continue
      }
    }
    opts.push({ value: name, label: name })
  }
  return opts
})

const insertMappingRows = computed(() => {
  const map = new Map(
    draft.fieldMappings.map((m) => [m.field, m.column] as const),
  )
  const enabled = new Set(insertEnabled.value)
  return entityFields.value.map((f) => ({
    field: f.name,
    remark: displayRemark(f.name, f.remark),
    source: map.get(f.name) ?? '',
    checked: enabled.has(f.name),
  }))
})

const selectedCount = computed(() => draft.queryFields.length)
const allSelected = computed(
  () =>
    outputFieldNames.value.length > 0 &&
    outputFieldNames.value.every((n) => draft.queryFields.includes(n)),
)

const mappingRows = computed(() => {
  const map = new Map(
    draft.fieldMappings.map((m) => [m.field, m.column] as const),
  )
  return outputFields.value.map((f) => ({
    field: f.name,
    remark: displayRemark(f.name, f.remark),
    column: map.get(f.name) ?? '',
  }))
})

const methodTitle = computed(() => {
  const name = draftName.value.trim() || props.method?.name?.trim()
  return name ? `${DM.title}${DM.mid}${name}` : DM.title
})

function typeDefById(id: string) {
  return findDataTypeDef(props.typeLibrary, id)
}

function leafNamedOf(expr: ProcessorTypeExpr): string {
  return leafNamedRef(expr)
}

function genericNamesOf(typeRef: string): string[] {
  return (typeDefById(typeRef)?.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
}

function formatTypeWithGenerics(
  typeRef: string,
  args: Record<string, string>,
): string {
  const def = typeDefById(typeRef)
  if (!def?.name) return typeRef || '?'
  const names = genericNamesOf(typeRef)
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

function formatTypeExpr(expr: ProcessorTypeExpr): string {
  const named = leafNamedOf(expr)
  const namedLabel = named
    ? formatTypeWithGenerics(named, expr.genericArgs ?? {})
    : ''
  if (expr.type === 'array') {
    if (expr.itemType === 'array') {
      const leaf =
        namedLabel ||
        typeLabel((expr.itemItemType || 'string') as DataFieldType)
      return `${DM.array} / ${DM.array} / ${leaf}`
    }
    const leaf =
      namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
    return `${DM.array} / ${leaf}`
  }
  if (named) return namedLabel
  return typeLabel((expr.type || 'string') as DataFieldType)
}

function paramsSummary(params: ProcessorMethodParam[]): string {
  if (!params.length) return DM.paramsEmpty
  return params
    .map((p) => {
      const label = formatTypeExpr(p.typeExpr)
      return p.name ? `${p.name}: ${label}` : label
    })
    .join(', ')
}

function payloadToTypeExpr(
  payload: TypeSelectPayload,
  prev?: ProcessorTypeExpr,
): ProcessorTypeExpr {
  const next: ProcessorTypeExpr = {
    ...createEmptyProcessorTypeExpr(payload.type),
    type: payload.type,
    typeRef: payload.typeRef ?? '',
    itemType: payload.itemType ?? '',
    itemTypeRef: payload.itemTypeRef ?? '',
    itemItemType: payload.itemItemType ?? '',
    itemItemTypeRef: payload.itemItemTypeRef ?? '',
    genericArgs: {},
  }
  const named = leafNamedOf(next)
  const prevNamed = prev ? leafNamedOf(prev) : ''
  if (named && named === prevNamed) {
    next.genericArgs = { ...(prev?.genericArgs ?? {}) }
  } else {
    for (const n of genericNamesOf(named)) next.genericArgs[n] = ''
  }
  return next
}

function syncQueryFieldsForOutput() {
  const names = resolveOutputFields(
    draftOutput.value,
    props.typeLibrary,
  ).map((f) => f.name)
  if (draft.operation === 'query') {
    const kept = draft.queryFields.filter((n) => names.includes(n))
    draft.queryFields = kept.length ? kept : [...names]
  }
  if (draft.operation === 'custom' && names.length) {
    const map = new Map(
      draft.fieldMappings.map((m) => [m.field, m.column] as const),
    )
    draft.fieldMappings = names.map((name) => ({
      field: name,
      column: map.get(name) ?? '',
    }))
  }
}

watch(
  () => [props.modelValue, props.method] as const,
  ([open]) => {
    if (!open || !props.method) return
    draftName.value = props.method.name
    draftParams.value = props.method.params.map((p) => ({
      ...p,
      typeExpr: {
        ...p.typeExpr,
        genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
      },
    }))
    draftOutput.value = {
      ...props.method.output,
      genericArgs: { ...(props.method.output.genericArgs ?? {}) },
    }
    const next = {
      ...createEmptyDataMethodConfig(),
      ...props.method.dataConfig,
      queryFields: [...(props.method.dataConfig?.queryFields ?? [])],
      fieldMappings: (props.method.dataConfig?.fieldMappings ?? []).map(
        (m) => ({ ...m }),
      ),
      conditionGroups: (props.method.dataConfig?.conditionGroups ?? []).map(
        (g) => ({
          ...g,
          conditions: (g.conditions ?? []).map((c) => ({ ...c })),
        }),
      ),
    }
    Object.assign(draft, next)
    syncQueryFieldsForOutput()
    if (draft.operation === 'batchInsert') {
      const stillValid = arrayParamOptions.value.some(
        (o) => o.value === draft.batchSourceParam,
      )
      if (!stillValid) {
        draft.batchSourceParam = arrayParamOptions.value[0]?.value ?? ''
      }
    }
    if (draft.operation === 'insert' || draft.operation === 'batchInsert') {
      const savedEnabled = (props.method.dataConfig?.fieldMappings ?? [])
        .filter((m) => m.field.trim() && m.column.trim())
        .map((m) => m.field.trim())
      ensureInsertMappings({
        preferEnabled: savedEnabled.length ? savedEnabled : null,
      })
    } else {
      insertEnabled.value = []
    }
  },
)

watch(
  () => draft.operation,
  (op, prev) => {
    if (op === prev) return
    const names = outputFieldNames.value
    if (op === 'query' && !draft.queryFields.length) {
      draft.queryFields = [...names]
    }
    if (op === 'custom' && names.length && !draft.fieldMappings.length) {
      draft.fieldMappings = names.map((name) => ({ field: name, column: '' }))
    }
    if (op === 'batchInsert') {
      const stillValid = arrayParamOptions.value.some(
        (o) => o.value === draft.batchSourceParam,
      )
      if (!stillValid) {
        draft.batchSourceParam = arrayParamOptions.value[0]?.value ?? ''
      }
    }
    if (
      (op === 'insert' || op === 'batchInsert') &&
      entityFields.value.length
    ) {
      ensureInsertMappings({ preferEnabled: null })
    }
  },
)

function ensureInsertMappings(options?: { preferEnabled: string[] | null }) {
  const sources = insertSourceOptions.value
  const byLeaf = new Map<string, string>()
  for (const s of sources) {
    const leaf = s.value.includes('.')
      ? s.value.slice(s.value.lastIndexOf('.') + 1)
      : s.value
    if (!byLeaf.has(leaf)) byLeaf.set(leaf, s.value)
  }
  const prev = new Map(
    draft.fieldMappings.map((m) => [m.field, m.column] as const),
  )
  draft.fieldMappings = entityFields.value.map((f) => ({
    field: f.name,
    column: prev.get(f.name) || byLeaf.get(f.name) || '',
  }))

  const names = new Set(entityFields.value.map((f) => f.name))
  if (options && options.preferEnabled !== undefined) {
    if (options.preferEnabled?.length) {
      insertEnabled.value = options.preferEnabled.filter((n) => names.has(n))
    } else {
      insertEnabled.value = draft.fieldMappings
        .filter((m) => m.column.trim())
        .map((m) => m.field)
    }
    return
  }

  const kept = insertEnabled.value.filter((n) => names.has(n))
  insertEnabled.value = kept.length
    ? kept
    : draft.fieldMappings
        .filter((m) => m.column.trim())
        .map((m) => m.field)
}

function onBatchSourceChange(value: string | number | boolean | undefined) {
  draft.batchSourceParam = typeof value === 'string' ? value : ''
  const prevEnabled = [...insertEnabled.value]
  ensureInsertMappings()
  const names = new Set(entityFields.value.map((f) => f.name))
  const kept = prevEnabled.filter((n) => names.has(n))
  if (kept.length) insertEnabled.value = kept
}

function updateInsertSource(field: string, source: string) {
  const list: DataMethodFieldMapping[] = entityFields.value.map((f) => {
    const existing = draft.fieldMappings.find((m) => m.field === f.name)
    return {
      field: f.name,
      column: f.name === field ? source : (existing?.column ?? ''),
    }
  })
  draft.fieldMappings = list
}

function toggleInsertField(field: string, checked: boolean) {
  if (checked) {
    if (!insertEnabled.value.includes(field)) {
      insertEnabled.value = [...insertEnabled.value, field]
    }
  } else {
    insertEnabled.value = insertEnabled.value.filter((n) => n !== field)
  }
}

function addConditionGroup() {
  draft.conditionGroups = [
    ...draft.conditionGroups,
    createEmptyDataMethodConditionGroup(),
  ]
}

function removeConditionGroup(groupId: string) {
  draft.conditionGroups = draft.conditionGroups.filter((g) => g.id !== groupId)
}

function addCondition(groupId: string) {
  draft.conditionGroups = draft.conditionGroups.map((g) =>
    g.id === groupId
      ? { ...g, conditions: [...g.conditions, createEmptyDataMethodCondition()] }
      : g,
  )
}

function removeCondition(groupId: string, condId: string) {
  draft.conditionGroups = draft.conditionGroups.map((g) => {
    if (g.id !== groupId) return g
    const next = g.conditions.filter((c) => c.id !== condId)
    return {
      ...g,
      conditions: next.length ? next : [createEmptyDataMethodCondition()],
    }
  })
}

function patchCondition(
  groupId: string,
  condId: string,
  patch: Partial<DataMethodCondition>,
) {
  draft.conditionGroups = draft.conditionGroups.map((g) => {
    if (g.id !== groupId) return g
    return {
      ...g,
      conditions: g.conditions.map((c) =>
        c.id === condId ? { ...c, ...patch } : c,
      ),
    }
  })
}

function serializeConditionGroups(): DataMethodConditionGroup[] {
  return draft.conditionGroups
    .map((g) => ({
      id: g.id,
      conditions: g.conditions
        .map((c) => ({
          ...c,
          field: c.field.trim() || CUSTOM_CONDITION_FIELD,
          customField: c.customField.trim(),
          value: c.value,
          valueTo: c.valueTo,
        }))
        .filter((c) => {
          const col = conditionColumnName(c)
          return Boolean(col)
        }),
    }))
    .filter((g) => g.conditions.length > 0)
}

function handleOutputChange(payload: TypeSelectPayload) {
  draftOutput.value = payloadToTypeExpr(payload, draftOutput.value)
  syncQueryFieldsForOutput()
  const named = leafNamedOf(draftOutput.value)
  if (genericNamesOf(named).length) openOutputGenerics()
}

function openOutputGenerics() {
  const named = leafNamedOf(draftOutput.value)
  const names = genericNamesOf(named)
  if (!names.length) return
  genericNames.value = names
  genericTypeName.value = typeDefById(named)?.name ?? ''
  genericArgs.value = { ...(draftOutput.value.genericArgs ?? {}) }
  genericVisible.value = true
}

function saveGenerics(args: Record<string, string>) {
  draftOutput.value = { ...draftOutput.value, genericArgs: args }
  syncQueryFieldsForOutput()
}

function saveParams(params: ProcessorMethodParam[]) {
  draftParams.value = params
  if (draft.operation === 'batchInsert') {
    const stillValid = arrayParamOptions.value.some(
      (o) => o.value === draft.batchSourceParam,
    )
    if (!stillValid) {
      draft.batchSourceParam = arrayParamOptions.value[0]?.value ?? ''
    }
    ensureInsertMappings()
  } else if (draft.operation === 'insert') {
    ensureInsertMappings()
  }
}

function onSourceChange(value: DataMethodSourceKind | string | number | boolean | undefined) {
  if (value === 'mysql' || value === 'redis' || value === 'stream') {
    draft.source = value
  }
}

function onOperationChange(
  value: DataMethodOperation | string | number | boolean | undefined,
) {
  if (
    value === 'query' ||
    value === 'insert' ||
    value === 'batchInsert' ||
    value === 'delete' ||
    value === 'update' ||
    value === 'custom'
  ) {
    draft.operation = value
  }
}

function selectAllFields() {
  draft.queryFields = [...outputFieldNames.value]
}

function clearFields() {
  draft.queryFields = []
}

function toggleField(name: string) {
  if (draft.queryFields.includes(name)) {
    draft.queryFields = draft.queryFields.filter((n) => n !== name)
  } else {
    draft.queryFields = [...draft.queryFields, name]
  }
}

function isFieldSelected(name: string) {
  return draft.queryFields.includes(name)
}

function updateMappingColumn(field: string, column: string) {
  const list: DataMethodFieldMapping[] = outputFields.value.map((f) => {
    const existing = draft.fieldMappings.find((m) => m.field === f.name)
    return {
      field: f.name,
      column: f.name === field ? column : (existing?.column ?? ''),
    }
  })
  draft.fieldMappings = list
}

function handleSave() {
  if (draft.source !== 'mysql') {
    draft.source = 'mysql'
  }
  const name = draftName.value.trim()
  if (!name) {
    return
  }
  const names = new Set(outputFieldNames.value)
  const entityNames = new Set(entityFields.value.map((f) => f.name))
  const config: DataMethodConfig = {
    source: draft.source,
    operation: draft.operation,
    queryFields:
      draft.operation === 'query'
        ? draft.queryFields.filter((n) => names.has(n))
        : [],
    sql: draft.operation === 'custom' ? draft.sql : '',
    fieldMappings:
      draft.operation === 'custom'
        ? draft.fieldMappings
            .filter((m) => names.has(m.field))
            .map((m) => ({
              field: m.field,
              column: m.column.trim(),
            }))
        : draft.operation === 'insert' || draft.operation === 'batchInsert'
          ? draft.fieldMappings
              .filter(
                (m) =>
                  entityNames.has(m.field) &&
                  m.column.trim() &&
                  insertEnabled.value.includes(m.field),
              )
              .map((m) => ({
                field: m.field,
                column: m.column.trim(),
              }))
          : [],
    batchSourceParam:
      draft.operation === 'batchInsert' ? draft.batchSourceParam.trim() : '',
    conditionGroups: showConditions.value ? serializeConditionGroups() : [],
  }
  emit('save', {
    name,
    params: draftParams.value,
    output: draftOutput.value,
    dataConfig: config,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="methodTitle"
    width="820px"
    destroy-on-close
    append-to-body
    class="data-method-dialog"
  >
    <div class="dlg-body">
      <section class="dlg-section">
        <div class="section-label">{{ DM.name }}</div>
        <div class="section-control">
          <el-input
            v-model="draftName"
            :placeholder="DM.namePh"
            maxlength="64"
          />
        </div>
      </section>

      <section class="dlg-section">
        <div class="section-label">{{ DM.params }}</div>
        <div class="section-control">
          <button
            type="button"
            class="params-trigger"
            @click="paramsDialogVisible = true"
          >
            {{ paramsSummary(draftParams) }}
          </button>
        </div>
      </section>

      <section class="dlg-section">
        <div class="section-label">{{ DM.output }}</div>
        <div class="section-control">
          <div class="output-row">
            <DataFieldTypeTreeSelect
              class="output-select"
              :type="(draftOutput.type || 'string') as DataFieldType"
              :type-ref="draftOutput.typeRef"
              :item-type="
                (draftOutput.itemType || undefined) as DataFieldType | undefined
              "
              :item-type-ref="draftOutput.itemTypeRef"
              :item-item-type="
                (draftOutput.itemItemType || undefined) as
                  | DataFieldType
                  | undefined
              "
              :item-item-type-ref="draftOutput.itemItemTypeRef"
              :library="typeLibrary"
              :exclude-types="PROCESSOR_EXCLUDE_TYPES"
              :allow-ref="false"
              clearable
              :placeholder="DM.outputPh"
              @change="handleOutputChange"
            />
            <el-button
              v-if="genericNamesOf(leafNamedOf(draftOutput)).length"
              type="primary"
              link
              @click="openOutputGenerics"
            >
              {{ DM.generics }}
            </el-button>
          </div>
        </div>
      </section>

      <section class="dlg-section">
        <div class="section-label">{{ DM.source }}</div>
        <div class="section-control">
          <el-radio-group
            :model-value="draft.source"
            class="chip-group"
            @update:model-value="onSourceChange"
          >
            <el-radio-button
              v-for="opt in DATA_METHOD_SOURCE_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              :disabled="opt.disabled"
            >
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
      </section>

      <section class="dlg-section">
        <div class="section-label">{{ DM.operation }}</div>
        <div class="section-control">
          <el-radio-group
            :model-value="draft.operation"
            class="chip-group"
            @update:model-value="onOperationChange"
          >
            <el-radio-button
              v-for="opt in DATA_METHOD_OPERATION_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </el-radio-button>
          </el-radio-group>
        </div>
      </section>

      <section v-if="isQuery" class="dlg-section dlg-section--block">
        <div class="section-label">{{ DM.queryFields }}</div>
        <div class="section-control">
          <div v-if="outputFields.length" class="section-actions">
            <span class="count">
              {{ selectedCount }} / {{ outputFields.length }}
            </span>
            <button
              type="button"
              class="text-btn"
              @click="allSelected ? clearFields() : selectAllFields()"
            >
              {{ allSelected ? DM.clear : DM.selectAll }}
            </button>
          </div>
          <div v-if="!outputFields.length" class="empty-box">
            {{ DM.queryFieldsEmpty }}
          </div>
          <div v-else class="field-panel">
            <div v-if="outputFields[0]?.sourceLabel" class="field-panel-head">
              <span class="source-tag">{{ outputFields[0].sourceLabel }}</span>
              <span class="source-hint">{{ DM.outputFieldsHint }}</span>
            </div>
            <ul class="field-list">
              <li
                v-for="f in outputFields"
                :key="f.name"
                class="field-row"
                :class="{ selected: isFieldSelected(f.name) }"
                @click="toggleField(f.name)"
              >
                <el-checkbox
                  :model-value="isFieldSelected(f.name)"
                  @click.stop
                  @update:model-value="toggleField(f.name)"
                />
                <div class="field-meta">
                  <code class="field-code">{{ f.name }}</code>
                  <span
                    v-if="displayRemark(f.name, f.remark)"
                    class="field-desc"
                  >
                    {{ displayRemark(f.name, f.remark) }}
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section
        v-if="showConditions"
        class="dlg-section dlg-section--block"
      >
        <div class="section-label">{{ DM.conditions }}</div>
        <div class="section-control">
          <div class="cond-toolbar">
            <div class="cond-tabs">
              <span
                v-for="(g, gi) in draft.conditionGroups"
                :key="g.id"
                class="cond-tab"
              >
                {{ DM.group }}{{ gi + 1 }}
              </span>
              <span v-if="!draft.conditionGroups.length" class="cond-hint">
                {{ DM.groupHint }}
              </span>
            </div>
            <el-button
              type="primary"
              link
              :icon="Plus"
              @click="addConditionGroup"
            >
              {{ DM.addGroup }}
            </el-button>
          </div>

          <div v-if="!draft.conditionGroups.length" class="empty-box">
            {{ DM.conditionsEmpty }}
          </div>

          <div
            v-for="(group, gi) in draft.conditionGroups"
            :key="group.id"
            class="cond-group"
          >
            <div class="cond-group-head">
              <span class="cond-group-title">{{ DM.group }}{{ gi + 1 }}</span>
              <span class="cond-group-logic">{{ DM.groupAnd }}</span>
              <div class="cond-group-actions">
                <el-button
                  type="primary"
                  link
                  :icon="Plus"
                  @click="addCondition(group.id)"
                >
                  {{ DM.add }}
                </el-button>
                <el-button
                  type="danger"
                  link
                  :icon="Delete"
                  @click="removeConditionGroup(group.id)"
                />
              </div>
            </div>

            <div
              v-for="cond in group.conditions"
              :key="cond.id"
              class="cond-row"
            >
              <el-select
                :model-value="cond.field || CUSTOM_CONDITION_FIELD"
                filterable
                :placeholder="DM.field"
                class="cond-field"
                @update:model-value="
                  patchCondition(group.id, cond.id, {
                    field: String($event ?? ''),
                  })
                "
              >
                <el-option
                  v-for="opt in conditionFieldOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>

              <el-input
                v-if="cond.field === CUSTOM_CONDITION_FIELD"
                :model-value="cond.customField"
                :placeholder="DM.customField"
                class="cond-custom"
                @update:model-value="
                  patchCondition(group.id, cond.id, {
                    customField: String($event ?? ''),
                  })
                "
              />

              <el-select
                :model-value="cond.op"
                :placeholder="DM.cond"
                class="cond-op"
                @update:model-value="
                  patchCondition(group.id, cond.id, {
                    op: ($event as DataMethodConditionOp) || 'eq',
                  })
                "
              >
                <el-option
                  v-for="opt in DATA_METHOD_CONDITION_OP_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>

              <template v-if="conditionOpMeta(cond.op).needsValue">
                <el-select
                  :model-value="cond.valueKind"
                  class="cond-kind"
                  @update:model-value="
                    patchCondition(group.id, cond.id, {
                      valueKind: $event === 'param' ? 'param' : 'literal',
                      value: '',
                      valueTo: '',
                    })
                  "
                >
                  <el-option :label="DM.literal" value="literal" />
                  <el-option :label="DM.param" value="param" />
                </el-select>

                <template v-if="cond.valueKind === 'param'">
                  <el-select
                    :model-value="cond.value"
                    filterable
                    clearable
                    :placeholder="DM.pickParam"
                    class="cond-value"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        value: String($event ?? ''),
                      })
                    "
                  >
                    <el-option
                      v-for="opt in conditionParamOptions"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                  <el-select
                    v-if="conditionOpMeta(cond.op).needsValueTo"
                    :model-value="cond.valueTo"
                    filterable
                    clearable
                    :placeholder="DM.pickParamTo"
                    class="cond-value"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        valueTo: String($event ?? ''),
                      })
                    "
                  >
                    <el-option
                      v-for="opt in conditionParamOptions"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                </template>

                <template v-else>
                  <el-input-number
                    v-if="conditionValueUi(cond) === 'number'"
                    :model-value="Number(cond.value || 0)"
                    controls-position="right"
                    class="cond-value"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        value: String($event ?? 0),
                      })
                    "
                  />
                  <el-switch
                    v-else-if="conditionValueUi(cond) === 'boolean'"
                    :model-value="cond.value === 'true'"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        value: $event === true ? 'true' : 'false',
                      })
                    "
                  />
                  <el-date-picker
                    v-else-if="conditionValueUi(cond) === 'datetime'"
                    :model-value="cond.value || undefined"
                    type="datetime"
                    value-format="YYYY-MM-DD HH:mm:ss"
                    :placeholder="DM.pickTime"
                    class="cond-value"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        value: String($event ?? ''),
                      })
                    "
                  />
                  <el-input
                    v-else
                    :model-value="cond.value"
                    :placeholder="DM.value"
                    class="cond-value"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        value: String($event ?? ''),
                      })
                    "
                  />

                  <template v-if="conditionOpMeta(cond.op).needsValueTo">
                    <el-input-number
                      v-if="conditionValueUi(cond) === 'number'"
                      :model-value="Number(cond.valueTo || 0)"
                      controls-position="right"
                      class="cond-value"
                      @update:model-value="
                        patchCondition(group.id, cond.id, {
                          valueTo: String($event ?? 0),
                        })
                      "
                    />
                    <el-date-picker
                      v-else-if="conditionValueUi(cond) === 'datetime'"
                      :model-value="cond.valueTo || undefined"
                      type="datetime"
                      value-format="YYYY-MM-DD HH:mm:ss"
                      :placeholder="DM.pickTimeTo"
                      class="cond-value"
                      @update:model-value="
                        patchCondition(group.id, cond.id, {
                          valueTo: String($event ?? ''),
                        })
                      "
                    />
                    <el-input
                      v-else
                      :model-value="cond.valueTo"
                      :placeholder="DM.valueTo"
                      class="cond-value"
                      @update:model-value="
                        patchCondition(group.id, cond.id, {
                          valueTo: String($event ?? ''),
                        })
                      "
                    />
                  </template>
                </template>
              </template>

              <el-button
                type="danger"
                link
                :icon="Delete"
                class="cond-del"
                @click="removeCondition(group.id, cond.id)"
              />
            </div>

            <div
              v-if="gi < draft.conditionGroups.length - 1"
              class="cond-or"
            >
              OR
            </div>
          </div>
        </div>
      </section>

      <template v-if="isInsert">
        <section v-if="isBatchInsert" class="dlg-section">
          <div class="section-label">{{ DM.batchSource }}</div>
          <div class="section-control">
            <el-select
              :model-value="draft.batchSourceParam"
              clearable
              filterable
              :placeholder="DM.batchSourcePh"
              class="batch-source-select"
              @update:model-value="onBatchSourceChange"
            >
              <el-option
                v-for="opt in arrayParamOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </div>
        </section>

        <section class="dlg-section dlg-section--block">
          <div class="section-label">{{ DM.fieldMapping }}</div>
          <div class="section-control">
            <div v-if="entityFields[0]?.sourceLabel" class="section-actions">
              <span class="count">
                {{ DM.target }}{{ DM.mid }}{{ entityFields[0].sourceLabel }}
              </span>
            </div>
            <div v-if="!entityFields.length" class="empty-box">
              {{ DM.noEntity }}
            </div>
            <div
              v-else-if="isBatchInsert && !arrayParamOptions.length"
              class="empty-box"
            >
              {{ DM.needArrayParam }}
            </div>
            <div
              v-else-if="isBatchInsert && !draft.batchSourceParam"
              class="empty-box"
            >
              {{ DM.pickBatchSource }}
            </div>
            <div v-else-if="!insertSourceOptions.length" class="empty-box">
              {{
                isBatchInsert
                  ? DM.noBatchFields
                  : DM.needObjectParam
              }}
            </div>
            <div v-else class="mapping-panel insert-mapping">
              <div class="mapping-head">
                <span />
                <span>{{ DM.targetField }}</span>
                <span />
                <span>{{ DM.sourceField }}</span>
              </div>
              <div
                v-for="row in insertMappingRows"
                :key="row.field"
                class="mapping-row"
                :class="{ dimmed: !row.checked }"
              >
                <el-checkbox
                  :model-value="row.checked"
                  @update:model-value="
                    toggleInsertField(row.field, $event === true)
                  "
                />
                <div class="mapping-field">
                  <code class="field-code">{{ row.field }}</code>
                  <span v-if="row.remark" class="field-desc">{{ row.remark }}</span>
                </div>
                <span class="mapping-arrow">?</span>
                <el-select
                  :model-value="row.source"
                  clearable
                  filterable
                  :placeholder="DM.pickSourceField"
                  class="mapping-input"
                  :disabled="!row.checked"
                  @update:model-value="
                    updateInsertSource(row.field, String($event ?? ''))
                  "
                >
                  <el-option
                    v-for="opt in insertSourceOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </div>
            </div>
          </div>
        </section>
      </template>

      <template v-if="isCustom">
        <section class="dlg-section dlg-section--block">
          <div class="section-label">{{ DM.sql }}</div>
          <div class="section-control">
            <el-input
              v-model="draft.sql"
              type="textarea"
              :rows="5"
              :placeholder="DM.sqlPh"
              class="sql-input"
            />
          </div>
        </section>
        <section class="dlg-section dlg-section--block">
          <div class="section-label">{{ DM.fieldMapping }}</div>
          <div class="section-control">
            <div v-if="outputFields[0]?.sourceLabel" class="section-actions">
              <span class="count">{{ outputFields[0].sourceLabel }}</span>
            </div>
            <div v-if="!outputFields.length" class="empty-box">
              {{ DM.mappingEmpty }}
            </div>
            <div v-else class="mapping-panel">
              <div
                v-for="row in mappingRows"
                :key="row.field"
                class="mapping-row"
              >
                <div class="mapping-field">
                  <code class="field-code">{{ row.field }}</code>
                  <span v-if="row.remark" class="field-desc">{{ row.remark }}</span>
                </div>
                <span class="mapping-arrow">?</span>
                <el-input
                  :model-value="row.column"
                  :placeholder="DM.columnExpr"
                  class="mapping-input"
                  @update:model-value="
                    updateMappingColumn(row.field, String($event ?? ''))
                  "
                />
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ DM.cancel }}</el-button>
      <el-button
        type="primary"
        :disabled="!isMysql || !draftName.trim()"
        @click="handleSave"
      >
        {{ DM.ok }}
      </el-button>
    </template>

    <MethodParamsDialog
      v-model="paramsDialogVisible"
      :params="draftParams"
      :type-options="typeOptions"
      :type-library="typeLibrary"
      :method-name="draftName"
      @save="saveParams"
    />
    <TypeGenericArgsDialog
      v-model="genericVisible"
      :type-name="genericTypeName"
      :generic-names="genericNames"
      :args="genericArgs"
      :type-options="typeOptions"
      @save="saveGenerics"
    />
  </el-dialog>
</template>

<style scoped>
.dlg-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.dlg-section {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}

.dlg-section--block {
  align-items: flex-start;
  min-height: 0;
}

.section-label {
  flex: 0 0 72px;
  margin: 0;
  padding: 0;
  height: 32px;
  font-size: 13px;
  font-weight: 500;
  color: #606266;
  line-height: 32px;
  text-align: right;
  box-sizing: border-box;
}

.dlg-section--block .section-label {
  height: auto;
  line-height: 32px;
  padding-top: 0;
}

.section-control {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
}

.section-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-height: 32px;
}

.count {
  font-size: 12px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  line-height: 32px;
}

.text-btn {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
  line-height: 32px;
  height: 32px;
}

.text-btn:hover {
  color: #79bbff;
}

.chip-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  height: 32px;
}

.chip-group :deep(.el-radio-button__inner) {
  height: 32px;
  padding: 0 14px;
  line-height: 30px;
  box-sizing: border-box;
}

.dlg-section :deep(.el-input),
.dlg-section :deep(.el-select),
.batch-source-select {
  width: 100%;
}

.dlg-section :deep(.el-input__wrapper),
.dlg-section :deep(.el-select__wrapper),
.batch-source-select :deep(.el-select__wrapper),
.mapping-input :deep(.el-select__wrapper),
.mapping-input :deep(.el-input__wrapper),
.output-select :deep(.el-select__wrapper) {
  min-height: 32px;
  height: 32px;
  box-sizing: border-box;
}

.empty-box {
  padding: 20px 16px;
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
}

.field-panel {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.field-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #ebeef5;
}

.source-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 4px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

.source-hint {
  font-size: 12px;
  color: #94a3b8;
}

.field-list {
  margin: 0;
  padding: 4px;
  list-style: none;
  max-height: 220px;
  overflow: auto;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s;
}

.field-row:hover {
  background: #f5f7fa;
}

.field-row.selected {
  background: #f0f7ff;
}

.field-meta {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.field-code {
  flex-shrink: 0;
  padding: 0;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  background: none;
}

.field-desc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #94a3b8;
}

.sql-input :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
}

.mapping-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.mapping-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1.1fr);
  align-items: center;
  gap: 8px;
}

.insert-mapping .mapping-row {
  grid-template-columns: 22px minmax(0, 1fr) 20px minmax(0, 1.2fr);
}

.insert-mapping .mapping-row.dimmed .mapping-field {
  opacity: 0.45;
}

.mapping-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #ebeef5;
}

.mapping-arrow {
  text-align: center;
  color: #cbd5e1;
  font-size: 13px;
}

.mapping-input {
  width: 100%;
}

.insert-mapping .mapping-head {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 20px minmax(0, 1.2fr);
  gap: 8px;
  padding: 0 2px 4px;
  font-size: 12px;
  color: #94a3b8;
}

.params-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  min-height: 32px;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
}

.params-trigger:hover {
  border-color: #c0c4cc;
  color: #409eff;
}

.output-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 32px;
}

.output-select {
  flex: 1;
  min-width: 0;
  height: 32px;
}

.cond-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
}

.cond-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cond-tab {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  background: #f0f5ff;
  color: #409eff;
  font-size: 12px;
  font-weight: 500;
}

.cond-hint {
  font-size: 12px;
  color: #94a3b8;
}

.cond-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.cond-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}

.cond-group-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  line-height: 28px;
}

.cond-group-logic {
  font-size: 11px;
  color: #94a3b8;
  line-height: 28px;
}

.cond-group-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  height: 28px;
}

.cond-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  width: 100%;
}

.cond-row :deep(.el-select__wrapper),
.cond-row :deep(.el-input__wrapper) {
  min-height: 32px;
  height: 32px;
}

.cond-row :deep(.el-input-number) {
  width: 100%;
  height: 32px;
  line-height: 32px;
}

.cond-row :deep(.el-input-number .el-input__wrapper) {
  padding-left: 8px;
  padding-right: 40px;
}

.cond-row :deep(.el-date-editor.el-input),
.cond-row :deep(.el-date-editor.el-input__wrapper) {
  height: 32px;
}

.cond-row :deep(.el-switch) {
  height: 32px;
  margin: 0;
  flex-shrink: 0;
}

.cond-field {
  flex: 0 0 112px;
  width: 112px;
}

.cond-custom {
  flex: 0 0 96px;
  width: 96px;
}

.cond-op {
  flex: 0 0 100px;
  width: 100px;
}

.cond-kind {
  flex: 0 0 80px;
  width: 80px;
}

.cond-value {
  flex: 1 1 0;
  min-width: 0;
}

.cond-value + .cond-value {
  flex: 1 1 0;
  min-width: 0;
}

.cond-value :deep(.el-input),
.cond-value :deep(.el-input-number),
.cond-value.el-date-editor {
  width: 100%;
}

.cond-del {
  flex: 0 0 28px;
  height: 32px;
  width: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cond-or {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  color: #e6a23c;
  letter-spacing: 0.08em;
  line-height: 24px;
}

.dlg-section .cond-row > .cond-field,
.dlg-section .cond-row > .cond-custom,
.dlg-section .cond-row > .cond-op,
.dlg-section .cond-row > .cond-kind,
.dlg-section .cond-row > .cond-value,
.dlg-section .cond-row > .cond-del {
  width: auto;
}

.dlg-section .cond-row > .cond-field {
  flex: 0 0 120px;
  width: 120px;
}

.dlg-section .cond-row > .cond-custom {
  flex: 0 0 100px;
  width: 100px;
}

.dlg-section .cond-row > .cond-op {
  flex: 0 0 110px;
  width: 110px;
}

.dlg-section .cond-row > .cond-kind {
  flex: 0 0 84px;
  width: 84px;
}

.dlg-section .cond-row > .cond-value {
  flex: 1 1 0;
  min-width: 0;
  width: auto;
}

.dlg-section .cond-row > .cond-value :deep(.el-select),
.dlg-section .cond-row > .cond-value :deep(.el-input),
.dlg-section .cond-row > .cond-value :deep(.el-input__wrapper),
.dlg-section .cond-row > .cond-value.el-input-number,
.dlg-section .cond-row > .cond-value.el-date-editor {
  width: 100%;
}

.dlg-section .cond-row > .cond-del {
  flex: 0 0 28px;
  width: 28px;
}

</style>
