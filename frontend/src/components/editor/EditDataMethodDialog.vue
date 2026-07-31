<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
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
  MAP_KEY_TYPE_OPTIONS,
  typeLabel,
  arrayTypeLabel,
  type DataFieldType,
  type MapKeyType,
} from '../../types/page-data'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import type { MysqlColumnDef, MysqlIndexDef } from '../../types/mysql'
import {
  processorTypeExprToMethodParamType,
  processorTypeExprToTs,
  type MethodParam,
} from '../../types/page-method'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect.vue'
import MethodParamsDialog from './MethodParamsDialog.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'
import SqlCodeEditor from './SqlCodeEditor.vue'
import TypedBindingCascader from './method-flow/TypedBindingCascader.vue'
import { DM } from './edit-data-method-copy'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = ['color', 'ref', 'icon', 'resource']
/** 映射值类型不可再嵌套映射 */
const MAP_VALUE_EXCLUDE_TYPES: DataFieldType[] = [
  ...PROCESSOR_EXCLUDE_TYPES,
  'map',
]

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
  /** 绑定实体类型 id */
  entityRef?: string
  /** 实体对应表列（查询字段 / 主键识别） */
  entityColumns?: MysqlColumnDef[]
  /** 实体对应表索引（单列索引视为唯一可查字段） */
  entityIndexes?: MysqlIndexDef[]
  /** 实体绑定的表名 */
  entityTableName?: string
  /** 禁止使用的方法名（预置方法名等） */
  reservedNames?: string[]
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

/** 映射键在 fieldMappings / 出参字段列表中的占位名 */
const MAP_KEY_FIELD = 'key'

function leafNamedRef(expr: ProcessorTypeExpr): string {
  if (expr.type === 'array' || expr.type === 'map') {
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

/** 出参可绑定字段；映射类型须优先于值侧接口展开，否则会丢掉 key 行 */
function resolveOutputFields(
  output: ProcessorTypeExpr,
  library: DataTypeLibrary | null,
): OutputFieldOption[] {
  const t = (output.type || '').trim()

  // 映射：key（唯一/索引）+ value（基本类型一列 / 接口展开）
  if (t === 'map') {
    const valueIsArray = output.itemType === 'array'
    const leafType = (
      valueIsArray ? output.itemItemType || 'string' : output.itemType || 'string'
    ) as DataFieldType
    const leafRef = (
      valueIsArray ? output.itemItemTypeRef || '' : output.itemTypeRef || ''
    ).trim()
    const leafDef = findDataTypeDef(library, leafRef)
    const keyRemark = valueIsArray ? DM.mapIndexField : DM.mapUniqueKey
    const keyRow: OutputFieldOption = {
      name: MAP_KEY_FIELD,
      remark: keyRemark,
      sourceLabel: keyRemark,
    }

    // 值元类型为接口 → 展开字段绑定
    if (leafDef?.kind === 'interface') {
      return [
        keyRow,
        ...fieldsOf(leafDef).map((f) => ({
          ...f,
          sourceLabel: leafDef.name,
        })),
      ]
    }

    // 基本数据类型（含 URI 等别名）→ 单列 value
    let valueLabel =
      leafDef?.name?.trim() ||
      typeLabel(leafType) ||
      leafType ||
      'any'
    if (valueIsArray) valueLabel = arrayTypeLabel(valueLabel)
    return [
      keyRow,
      {
        name: 'value',
        remark: `${DM.mapValue} · ${valueLabel}`,
        sourceLabel: valueLabel,
      },
    ]
  }

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

  if (!t) return []

  let label = ''
  if (named) {
    label = def?.name?.trim() || named
    if (t === 'array') label = `${label}[]`
  } else if (t === 'array') {
    const item =
      typeLabel((output.itemType || 'string') as DataFieldType) ||
      output.itemType ||
      'any'
    label = arrayTypeLabel(item)
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
const isMapOutput = computed(() => draftOutput.value.type === 'map')
const isInsert = computed(
  () => draft.operation === 'insert' || draft.operation === 'batchInsert',
)
const isBatchInsert = computed(() => draft.operation === 'batchInsert')
/** 非插入 / 自定义时展示条件 */
const showConditions = computed(() => !isInsert.value && !isCustom.value)
const isMysql = computed(() => draft.source === 'mysql')

/** 已勾选的查询字段（映射值从此选） */
const selectedQueryFieldOptions = computed(() => {
  const selected = new Set(draft.queryFields)
  return tableFields.value.filter((f) => selected.has(f.name))
})

const mapKeyType = computed<MapKeyType>(() =>
  draftOutput.value.keyType === 'number' ? 'number' : 'string',
)

const mapValueIsInterface = computed(() => {
  const out = draftOutput.value
  if (out.type !== 'map') return false
  const ref = (
    out.itemType === 'array' ? out.itemItemTypeRef : out.itemTypeRef
  ).trim()
  const def = findDataTypeDef(props.typeLibrary, ref)
  return def?.kind === 'interface'
})

/** 主键 + 名为 id 的列 + 单列索引：表列名 */
const uniqueOrPrimaryFieldNames = computed(() => {
  const names = new Set<string>()
  const cols = props.entityColumns ?? []
  for (const c of cols) {
    const col = c.name.trim()
    if (!col) continue
    // 主键，或惯用 id 列，均可作映射键
    if (c.primaryKey || col.toLowerCase() === 'id') names.add(col)
  }
  for (const idx of props.entityIndexes ?? []) {
    if (idx.columns.length !== 1) continue
    const col = idx.columns[0]?.trim()
    if (!col) continue
    names.add(col)
  }
  return names
})

function tableColumnValueUi(columnName: string): ConditionValueUi {
  const col = (props.entityColumns ?? []).find(
    (c) => c.name.trim() === columnName,
  )
  if (col) {
    const t = col.type.trim().toLowerCase()
    if (
      t.includes('date') ||
      t.includes('time') ||
      t === 'year' ||
      t === 'timestamp'
    ) {
      return 'datetime'
    }
    if (
      /^(tiny|small|medium|big)?int|decimal|numeric|float|double|real|bit/.test(
        t,
      )
    ) {
      return 'number'
    }
    if (t === 'bool' || t === 'boolean' || t.startsWith('tinyint(1)')) {
      return 'boolean'
    }
    return 'string'
  }
  return (
    conditionFieldOptions.value.find((o) => o.value === columnName)?.valueUi ??
    'string'
  )
}

/** 键字段候选项：主键/唯一/id 优先；否则已勾选查询字段；再否则全部表列 */
const mapKeyFieldOptions = computed(() => {
  const unique = uniqueOrPrimaryFieldNames.value
  const preferred = tableFields.value.filter((f) => unique.has(f.name))
  if (preferred.length) return preferred
  const selected = new Set(draft.queryFields)
  const fromQuery = tableFields.value.filter((f) => selected.has(f.name))
  if (fromQuery.length) return fromQuery
  return tableFields.value
})

const hasUniqueOrPrimaryKeys = computed(
  () => uniqueOrPrimaryFieldNames.value.size > 0,
)

const mapKeyColumn = computed(
  () =>
    draft.fieldMappings.find((m) => m.field === MAP_KEY_FIELD)?.column ?? '',
)

const mapValueMappingRows = computed(() =>
  mappingRows.value.filter((r) => r.field !== MAP_KEY_FIELD),
)

/** 值类型选择器：把 map 的 value 侧当作顶层类型展示 */
const mapValueSelectType = computed((): DataFieldType => {
  const out = draftOutput.value
  if (out.itemType === 'array') return 'array'
  return ((out.itemType || 'string') as DataFieldType) || 'string'
})
const mapValueSelectTypeRef = computed(() =>
  draftOutput.value.itemType === 'array'
    ? ''
    : draftOutput.value.itemTypeRef || '',
)
const mapValueSelectItemType = computed(
  (): DataFieldType | undefined => {
    const out = draftOutput.value
    if (out.itemType !== 'array') return undefined
    return (out.itemItemType || 'string') as DataFieldType
  },
)
const mapValueSelectItemTypeRef = computed(() =>
  draftOutput.value.itemType === 'array'
    ? draftOutput.value.itemItemTypeRef || ''
    : '',
)

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

/** ?????????? Redis / ?????? */
const enabledSourceOptions = computed(() =>
  DATA_METHOD_SOURCE_OPTIONS.filter((o) => !o.disabled),
)

/** ?????????????? ambient ?? */
const conditionAmbientVars = computed((): MethodParam[] =>
  draftParams.value
    .map((p) => {
      const name = p.name.trim()
      if (!name) return null
      return {
        name,
        type: processorTypeExprToMethodParamType(p.typeExpr),
        typeExpr: p.typeExpr,
        tsType: processorTypeExprToTs(p.typeExpr, props.typeLibrary),
      } satisfies MethodParam
    })
    .filter((p): p is NonNullable<typeof p> => p !== null),
)

function conditionTargetType(cond: DataMethodCondition): ProcessorTypeExpr {
  const ui = conditionValueUi(cond)
  const leaf =
    ui === 'number'
      ? createEmptyProcessorTypeExpr('number')
      : ui === 'boolean'
        ? createEmptyProcessorTypeExpr('boolean')
        : createEmptyProcessorTypeExpr('string')
  // 「属于 / 不属于」→ IN / NOT IN，需要数组入参（如 number[]），不能只匹配元素
  if (cond.op === 'in' || cond.op === 'notIn') {
    return {
      ...createEmptyProcessorTypeExpr('array'),
      itemType: leaf.type || 'string',
    }
  }
  return leaf
}

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

/** 查询字段候选：当前实体绑定表的列名 */
const tableFields = computed((): OutputFieldOption[] => {
  const cols = props.entityColumns ?? []
  const table = props.entityTableName?.trim() || ''
  const list: OutputFieldOption[] = []
  const seen = new Set<string>()
  for (const c of cols) {
    const col = c.name.trim()
    if (!col || seen.has(col)) continue
    seen.add(col)
    list.push({
      name: col,
      remark: c.comment?.trim() || '',
      sourceLabel: table || col,
    })
  }
  return list
})

const tableFieldNames = computed(
  () => new Set(tableFields.value.map((f) => f.name)),
)

/** 查询字段勾选池：表列 */
const queryFieldPool = computed(() => tableFields.value)

const queryFieldsSourceHint = computed(() => {
  const table = props.entityTableName?.trim()
  if (table) return `${DM.target}${DM.mid}${table}`
  return DM.queryFields
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

/** 查询分页：可选入参（对象 / 具名类型，如 QueryPageDto） */
const pageParamOptions = computed((): SourceOption[] => {
  const opts: SourceOption[] = []
  for (const p of draftParams.value) {
    const name = p.name.trim()
    if (!name) continue
    const t = p.typeExpr.type
    if (t === 'array' || t === 'string' || t === 'number' || t === 'boolean') {
      continue
    }
    const ts = processorTypeExprToTs(p.typeExpr, props.typeLibrary)
    opts.push({
      value: name,
      label: `${name}${DM.mid}${ts}`,
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
const allSelected = computed(() => {
  const pool = queryFieldPool.value
  return (
    pool.length > 0 && pool.every((f) => draft.queryFields.includes(f.name))
  )
})

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
      return arrayTypeLabel(leaf, 2)
    }
    const leaf =
      namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
    return arrayTypeLabel(leaf)
  }
  if (expr.type === 'map') {
    const keyLabel = expr.keyType === 'number' ? 'number' : 'string'
    if (expr.itemType === 'array') {
      const leaf =
        namedLabel ||
        typeLabel((expr.itemItemType || 'string') as DataFieldType)
      return `${typeLabel('map')} / ${keyLabel} / ${arrayTypeLabel(leaf)}`
    }
    const leaf =
      namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
    return `${typeLabel('map')} / ${keyLabel} / ${leaf}`
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
  const fieldType =
    payload.type === 'void' || payload.type === 'generic' ? 'any' : payload.type
  const next: ProcessorTypeExpr = {
    ...createEmptyProcessorTypeExpr(fieldType),
    type: fieldType,
    typeRef: payload.typeRef ?? '',
    itemType:
      payload.itemType === 'generic' ? 'any' : (payload.itemType ?? ''),
    itemTypeRef: payload.itemTypeRef ?? '',
    itemItemType:
      payload.itemItemType === 'generic'
        ? 'any'
        : (payload.itemItemType ?? ''),
    itemItemTypeRef: payload.itemItemTypeRef ?? '',
    keyType:
      fieldType === 'map'
        ? payload.keyType === 'number'
          ? 'number'
          : 'string'
        : '',
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
    const tableNames = tableFieldNames.value
    if (draftOutput.value.type === 'map') {
      const map = new Map(
        draft.fieldMappings.map((m) => [m.field, m.column] as const),
      )
      draft.fieldMappings = names.map((name) => ({
        field: name,
        column: map.get(name) ?? '',
      }))
      let next = draft.queryFields.filter((n) => tableNames.has(n))
      if (!next.length) {
        next = [
          ...new Set(
            draft.fieldMappings
              .map((m) => m.column.trim())
              .filter((c) => tableNames.has(c)),
          ),
        ]
      }
      draft.queryFields = next
      return
    }
    const kept = draft.queryFields.filter((n) => tableNames.has(n))
    draft.queryFields = kept.length
      ? kept
      : tableFields.value.map((f) => f.name)
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
    if (
      draft.operation === 'query' &&
      draftOutput.value.type === 'map'
    ) {
      const allowed = new Set(mapKeyFieldOptions.value.map((f) => f.name))
      const cur =
        draft.fieldMappings.find((m) => m.field === MAP_KEY_FIELD)?.column ??
        ''
      if (cur && !allowed.has(cur)) {
        updateMappingColumn(MAP_KEY_FIELD, '')
      }
      ensureMapKeyField()
    }
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
    if (op === 'query') ensureMapKeyField()
  },
)

watch(
  mapKeyFieldOptions,
  () => {
    ensureMapKeyField()
  },
  { deep: true },
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

function onPageParamChange(value: string | number | boolean | undefined) {
  draft.pageParam = typeof value === 'string' ? value : ''
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

function handleMapKeyTypeChange(
  value: MapKeyType | string | number | boolean | undefined,
) {
  const keyType: MapKeyType = value === 'number' ? 'number' : 'string'
  draftOutput.value = { ...draftOutput.value, type: 'map', keyType }
}

function onMapKeyFieldChange(
  value: string | number | boolean | undefined,
) {
  const column = String(value ?? '')
  updateMappingColumn(MAP_KEY_FIELD, column)
  if (column && !draft.queryFields.includes(column)) {
    draft.queryFields = [...draft.queryFields, column]
  }
  if (!column) return
  const ui = tableColumnValueUi(column)
  draftOutput.value = {
    ...draftOutput.value,
    type: 'map',
    keyType: ui === 'number' ? 'number' : 'string',
  }
}

/** 映射出参且尚未绑键时，自动选中首选键字段（如主键 id） */
function ensureMapKeyField() {
  if (draft.operation !== 'query' || draftOutput.value.type !== 'map') return
  const cur =
    draft.fieldMappings.find((m) => m.field === MAP_KEY_FIELD)?.column?.trim() ??
    ''
  if (cur) return
  const first = mapKeyFieldOptions.value[0]
  if (!first?.name) return
  onMapKeyFieldChange(first.name)
}

function handleMapValueTypeChange(payload: TypeSelectPayload) {
  const prev = draftOutput.value
  const keyType: MapKeyType =
    prev.keyType === 'number' ? 'number' : 'string'
  if (payload.cleared) {
    draftOutput.value = {
      ...prev,
      type: 'map',
      keyType,
      itemType: 'string',
      itemTypeRef: '',
      itemItemType: '',
      itemItemTypeRef: '',
      genericArgs: {},
    }
  } else if (payload.type === 'array') {
    draftOutput.value = {
      ...prev,
      type: 'map',
      keyType,
      itemType: 'array',
      itemTypeRef: '',
      itemItemType:
        payload.itemType === 'generic' ? 'any' : (payload.itemType ?? 'string'),
      itemItemTypeRef: payload.itemTypeRef ?? '',
      genericArgs: {},
    }
  } else {
    const fieldType =
      payload.type === 'generic' ? 'any' : (payload.type as DataFieldType)
    draftOutput.value = {
      ...prev,
      type: 'map',
      keyType,
      itemType: fieldType,
      itemTypeRef: payload.typeRef ?? '',
      itemItemType: '',
      itemItemTypeRef: '',
      genericArgs: {},
    }
  }
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
  draft.queryFields = queryFieldPool.value.map((f) => f.name)
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
  // 勾选主键/id 且尚未绑键时，自动用作映射键
  if (
    draft.operation === 'query' &&
    draftOutput.value.type === 'map' &&
    !mapKeyColumn.value &&
    uniqueOrPrimaryFieldNames.value.has(name) &&
    draft.queryFields.includes(name)
  ) {
    onMapKeyFieldChange(name)
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
    ElMessage.warning('请填写方法名')
    return
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    ElMessage.warning('方法名须为合法标识符')
    return
  }
  const reserved = props.reservedNames ?? []
  if (reserved.some((n) => n.toLowerCase() === name.toLowerCase())) {
    ElMessage.warning(`方法名「${name}」不可用（与预置方法或其它方法冲突）`)
    return
  }
  const names = new Set(outputFieldNames.value)
  const tableNames = tableFieldNames.value
  const entityNames = new Set(entityFields.value.map((f) => f.name))
  const mapQuery = draft.operation === 'query' && draftOutput.value.type === 'map'
  const mapMappings = mapQuery
    ? draft.fieldMappings
        .filter((m) => names.has(m.field) && m.column.trim())
        .map((m) => ({
          field: m.field,
          column: m.column.trim(),
        }))
    : []
  if (mapQuery) {
    const keyBound = mapMappings.some((m) => m.field === MAP_KEY_FIELD)
    if (!keyBound) {
      ElMessage.warning(
        draftOutput.value.itemType === 'array'
          ? '请绑定映射键（索引字段）'
          : '请绑定映射键（唯一字段）',
      )
      return
    }
    if (mapMappings.length < 2) {
      ElMessage.warning('请绑定映射值字段')
      return
    }
  }
  const config: DataMethodConfig = {
    source: draft.source,
    operation: draft.operation,
    queryFields:
      draft.operation === 'query'
        ? mapQuery
          ? [
              ...new Set([
                ...draft.queryFields.filter((n) => tableNames.has(n)),
                ...mapMappings.map((m) => m.column),
              ]),
            ]
          : draft.queryFields.filter((n) => tableNames.has(n))
        : [],
    sql: draft.operation === 'custom' ? draft.sql : '',
    fieldMappings:
      mapQuery
        ? mapMappings
        : draft.operation === 'custom'
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
    pageParam: draft.operation === 'query' ? draft.pageParam.trim() : '',
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
    :close-on-click-modal="false"
    :close-on-press-escape="false"
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
          <div
            class="output-row"
            :class="{ 'output-row--map': isMapOutput && isQuery }"
          >
            <DataFieldTypeTreeSelect
              class="output-select"
              :class="{ 'output-select--map': isMapOutput && isQuery }"
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
              :key-type="
                draftOutput.keyType === 'number' ||
                draftOutput.keyType === 'string'
                  ? draftOutput.keyType
                  : undefined
              "
              :library="typeLibrary"
              :exclude-types="PROCESSOR_EXCLUDE_TYPES"
              :allow-ref="false"
              map-leaf
              clearable
              size="small"
              :placeholder="DM.outputPh"
              @change="handleOutputChange"
            />
            <template v-if="isMapOutput && isQuery">
              <span class="map-inline-label">{{ DM.mapKeyShort }}</span>
              <el-select
                :model-value="mapKeyType"
                size="small"
                class="map-inline-select map-inline-select--type"
                :placeholder="DM.mapKeyType"
                @update:model-value="handleMapKeyTypeChange"
              >
                <el-option
                  v-for="opt in MAP_KEY_TYPE_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <span class="map-inline-label">{{ DM.mapValueShort }}</span>
              <DataFieldTypeTreeSelect
                class="map-inline-select"
                :type="mapValueSelectType"
                :type-ref="mapValueSelectTypeRef"
                :item-type="mapValueSelectItemType"
                :item-type-ref="mapValueSelectItemTypeRef"
                :library="typeLibrary"
                :exclude-types="MAP_VALUE_EXCLUDE_TYPES"
                :allow-ref="false"
                clearable
                size="small"
                :placeholder="DM.mapValueType"
                @change="handleMapValueTypeChange"
              />
            </template>
            <el-button
              v-if="genericNamesOf(leafNamedOf(draftOutput)).length"
              type="primary"
              link
              size="small"
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
            size="small"
            class="chip-group"
            @update:model-value="onSourceChange"
          >
            <el-radio-button
              v-for="opt in enabledSourceOptions"
              :key="opt.value"
              :value="opt.value"
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
            size="small"
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
          <div class="field-panel">
            <div class="field-panel-head">
              <span class="source-hint">{{ queryFieldsSourceHint }}</span>
              <div
                v-if="queryFieldPool.length"
                class="field-panel-actions"
              >
                <span class="count">
                  {{ selectedCount }} / {{ queryFieldPool.length }}
                </span>
                <button
                  type="button"
                  class="text-btn"
                  @click="allSelected ? clearFields() : selectAllFields()"
                >
                  {{ allSelected ? DM.clear : DM.selectAll }}
                </button>
              </div>
            </div>
            <div
              v-if="!queryFieldPool.length"
              class="empty-box empty-box--inset"
            >
              {{
                entityTableName?.trim() ? DM.mapNoTableColumns : DM.noEntity
              }}
            </div>
            <ul v-else class="field-list">
              <li
                v-for="f in queryFieldPool"
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
        v-if="isQuery && isMapOutput"
        class="dlg-section dlg-section--block"
      >
        <div class="section-label">{{ DM.fieldMapping }}</div>
        <div class="section-control">
          <p class="page-param-hint map-hint">{{ DM.mapMappingHint }}</p>

          <div class="map-bind-row">
            <span class="map-bind-label">{{ DM.mapKeyField }}</span>
            <el-select
              :model-value="mapKeyColumn"
              clearable
              filterable
              size="small"
              class="map-bind-select"
              :placeholder="DM.mapKeyFieldPh"
              :disabled="!mapKeyFieldOptions.length"
              teleported
              @update:model-value="onMapKeyFieldChange"
            >
              <el-option
                v-for="ef in mapKeyFieldOptions"
                :key="ef.name"
                :label="
                  ef.remark ? `${ef.name}${DM.mid}${ef.remark}` : ef.name
                "
                :value="ef.name"
              />
            </el-select>
          </div>
          <p
            v-if="!hasUniqueOrPrimaryKeys"
            class="page-param-hint map-hint"
          >
            {{ DM.mapNoUniqueKey }}
          </p>

          <div class="map-bind-block">
            <span class="map-bind-label">{{ DM.mapValueMapping }}</span>
            <div
              v-if="!selectedQueryFieldOptions.length"
              class="empty-box empty-box--inset"
            >
              {{ DM.mapNeedQueryFields }}
            </div>
            <div
              v-else-if="!mapValueMappingRows.length"
              class="empty-box empty-box--inset"
            >
              {{ DM.mapNeedQueryFields }}
            </div>
            <div v-else class="mapping-panel mapping-panel--inset">
              <div
                v-for="row in mapValueMappingRows"
                :key="row.field"
                class="mapping-row"
              >
                <div class="mapping-field">
                  <code class="field-code">{{
                    mapValueIsInterface ? row.field : DM.mapValue
                  }}</code>
                  <span
                    v-if="
                      mapValueIsInterface &&
                      displayRemark(row.field, row.remark)
                    "
                    class="field-desc"
                  >
                    {{ displayRemark(row.field, row.remark) }}
                  </span>
                </div>
                <span class="mapping-arrow">{{ DM.arrow }}</span>
                <el-select
                  :model-value="row.column"
                  clearable
                  filterable
                  size="small"
                  class="mapping-input"
                  :placeholder="DM.mapValueFieldPh"
                  teleported
                  @update:model-value="
                    updateMappingColumn(row.field, String($event ?? ''))
                  "
                >
                  <el-option
                    v-for="ef in selectedQueryFieldOptions"
                    :key="ef.name"
                    :label="
                      ef.remark
                        ? `${ef.name}${DM.mid}${ef.remark}`
                        : ef.name
                    "
                    :value="ef.name"
                  />
                </el-select>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="isQuery" class="dlg-section">
        <div class="section-label">{{ DM.pageParam }}</div>
        <div class="section-control">
          <el-select
            :model-value="draft.pageParam"
            clearable
            filterable
            :placeholder="DM.pageParamPh"
            class="page-param-select"
            @update:model-value="onPageParamChange"
          >
            <el-option
              v-for="opt in pageParamOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <p class="page-param-hint">{{ DM.pageParamHint }}</p>
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
                  <TypedBindingCascader
                    :model-value="cond.value"
                    class="cond-value"
                    :ambient-vars="conditionAmbientVars"
                    :target-type="conditionTargetType(cond)"
                    :type-library="typeLibrary"
                    :placeholder="DM.pickParam"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        value: String($event ?? ''),
                      })
                    "
                  />
                  <TypedBindingCascader
                    v-if="conditionOpMeta(cond.op).needsValueTo"
                    :model-value="cond.valueTo"
                    class="cond-value"
                    :ambient-vars="conditionAmbientVars"
                    :target-type="conditionTargetType(cond)"
                    :type-library="typeLibrary"
                    :placeholder="DM.pickParamTo"
                    @update:model-value="
                      patchCondition(group.id, cond.id, {
                        valueTo: String($event ?? ''),
                      })
                    "
                  />
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
                  <span
                    v-if="displayRemark(row.field, row.remark)"
                    class="field-desc"
                  >
                    {{ displayRemark(row.field, row.remark) }}
                  </span>
                </div>
                <span class="mapping-arrow">{{ DM.arrow }}</span>
                <el-select
                  :model-value="row.source"
                  clearable
                  filterable
                  size="small"
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
            <SqlCodeEditor
              v-model="draft.sql"
              :height="160"
              :placeholder="DM.sqlPh"
              :param-names="draftParams.map((p) => p.name).filter(Boolean)"
            />
          </div>
        </section>
        <section class="dlg-section dlg-section--block">
          <div class="section-label">{{ DM.fieldMapping }}</div>
          <div class="section-control">
            <div class="field-panel">
              <div class="field-panel-head">
                <div class="field-panel-type">
                  <DataFieldTypeTreeSelect
                    class="output-select-mini"
                    :type="(draftOutput.type || 'string') as DataFieldType"
                    :type-ref="draftOutput.typeRef"
                    :item-type="
                      (draftOutput.itemType || undefined) as
                        | DataFieldType
                        | undefined
                    "
                    :item-type-ref="draftOutput.itemTypeRef"
                    :item-item-type="
                      (draftOutput.itemItemType || undefined) as
                        | DataFieldType
                        | undefined
                    "
                  :item-item-type-ref="draftOutput.itemItemTypeRef"
                  :key-type="
                    draftOutput.keyType === 'number' ||
                    draftOutput.keyType === 'string'
                      ? draftOutput.keyType
                      : undefined
                  "
                  :library="typeLibrary"
                    :exclude-types="PROCESSOR_EXCLUDE_TYPES"
                    :allow-ref="false"
                    clearable
                    size="small"
                    :placeholder="DM.outputPh"
                    @change="handleOutputChange"
                  />
                  <el-button
                    v-if="genericNamesOf(leafNamedOf(draftOutput)).length"
                    type="primary"
                    link
                    size="small"
                    @click="openOutputGenerics"
                  >
                    {{ DM.generics }}
                  </el-button>
                </div>
              </div>
              <div v-if="!outputFields.length" class="empty-box empty-box--inset">
                {{ DM.mappingEmpty }}
              </div>
              <div v-else class="mapping-panel mapping-panel--inset">
                <div
                  v-for="row in mappingRows"
                  :key="row.field"
                  class="mapping-row"
                >
                  <div class="mapping-field">
                    <code class="field-code">{{ row.field }}</code>
                    <span
                      v-if="displayRemark(row.field, row.remark)"
                      class="field-desc"
                    >
                      {{ displayRemark(row.field, row.remark) }}
                    </span>
                  </div>
                  <span class="mapping-arrow">{{ DM.arrow }}</span>
                  <el-input
                    :model-value="row.column"
                    :placeholder="DM.columnExpr"
                    size="small"
                    class="mapping-input"
                    @update:model-value="
                      updateMappingColumn(row.field, String($event ?? ''))
                    "
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
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
  align-items: flex-start;
  gap: 12px;
  min-height: 32px;
}

.dlg-section--block {
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
  height: 32px;
  line-height: 32px;
  padding-top: 0;
}

.section-control {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: flex-start;
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
  height: 24px;
}

.chip-group :deep(.el-radio-button__inner) {
  height: 24px;
  padding: 0 10px;
  line-height: 22px;
  box-sizing: border-box;
  font-size: 12px;
}

.dlg-section :deep(.el-input),
.dlg-section :deep(.el-select),
.batch-source-select,
.page-param-select {
  width: 100%;
}

.page-param-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  pointer-events: none;
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
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #ebeef5;
  min-height: 40px;
  box-sizing: border-box;
}

.field-panel-type {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.field-panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.output-select-mini {
  flex: 0 1 280px;
  min-width: 160px;
  max-width: 360px;
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
  flex-shrink: 0;
  font-size: 12px;
  color: #94a3b8;
}

.empty-box--inset {
  margin: 0;
  border: none;
  border-radius: 0;
}

.mapping-panel--inset {
  border: none;
  border-radius: 0;
  background: #fff;
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

.mapping-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.mapping-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1.1fr);
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.insert-mapping .mapping-row {
  grid-template-columns: 22px minmax(0, 1fr) 24px minmax(0, 1.2fr);
}

.insert-mapping .mapping-row.dimmed .mapping-field {
  opacity: 0.45;
}

.mapping-field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  background: #fff;
  border: 1px solid #ebeef5;
  box-sizing: border-box;
  overflow: hidden;
}

.mapping-field .field-code {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1;
}

.mapping-field .field-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #909399;
  line-height: 1;
}

.mapping-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  color: #94a3b8;
  font-size: 14px;
  line-height: 1;
  user-select: none;
}

.mapping-input {
  width: 100%;
}

.mapping-input :deep(.el-select__wrapper),
.mapping-input :deep(.el-input__wrapper) {
  min-height: 32px;
  height: 32px;
}

.insert-mapping .mapping-head {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 24px minmax(0, 1.2fr);
  gap: 8px;
  padding: 0 2px 4px;
  font-size: 12px;
  color: #94a3b8;
}

.mapping-head--map {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1.2fr);
  gap: 8px;
  padding: 0 2px 6px;
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

.output-row--map {
  height: auto;
  min-height: 32px;
  flex-wrap: wrap;
}

.output-select {
  flex: 1;
  min-width: 0;
  height: 32px;
}

.output-select--map {
  flex: 0 1 140px;
  max-width: 160px;
}

.map-inline-label {
  flex: 0 0 auto;
  font-size: 12px;
  color: #606266;
  line-height: 32px;
  white-space: nowrap;
}

.map-inline-select {
  flex: 1;
  min-width: 100px;
  max-width: 200px;
}

.map-inline-select--type {
  flex: 0 0 100px;
  max-width: 100px;
}

.map-hint {
  margin: 0;
}

.map-bind-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 32px;
}

.map-bind-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.map-bind-label {
  flex: 0 0 64px;
  font-size: 12px;
  color: #606266;
  line-height: 32px;
}

.map-bind-select {
  flex: 1;
  min-width: 0;
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
.dlg-section .cond-row > .cond-value :deep(.el-cascader),
.dlg-section .cond-row > .cond-value :deep(.typed-binding-wrap),
.dlg-section .cond-row > .cond-value.el-input-number,
.dlg-section .cond-row > .cond-value.el-date-editor {
  width: 100%;
}

.dlg-section .cond-row > .cond-del {
  flex: 0 0 28px;
  width: 28px;
}

</style>
