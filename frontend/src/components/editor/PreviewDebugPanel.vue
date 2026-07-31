<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowDown, Connection, Delete, EditPen, Plus, RefreshRight } from '@element-plus/icons-vue'
import type { ComponentConfig, ComponentPropDef } from '../../types/component'
import type { DataField, DataFieldValue, PageData } from '../../types/page-data'
import { arrayTypeLabel } from '../../types/page-data'
import type {
  DataTypeLibrary,
  InterfaceField,
} from '../../types/data-types'
import {
  buildDollarProps,
  normalizePropDefaultValue,
} from '../../utils/component-props'
import { findDataTypeDef, typeExprToDataFieldType, fillNamedInterfaceDefaults } from '../../utils/named-type-fields'
import ColorPicker from './ColorPicker.vue'
import ApiPropBindField from './ApiPropBindField.vue'

export type EmitLogEntry = {
  id: number
  time: string
  event: string
  args: Record<string, unknown>
}

type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'array'

type ObjectFieldForm = {
  name: string
  remark: string
  kind: FieldKind
  enumOptions: string[]
}

type PropFormModel = {
  def: ComponentPropDef
  mode: 'scalar' | 'object' | 'json' | 'array' | 'api'
  typeLabel: string
  fields: ObjectFieldForm[]
  itemKind?: FieldKind
  itemEnumOptions?: string[]
}

const props = defineProps<{
  mode: 'page' | 'component'
  config?: ComponentConfig | null
  propValues?: Record<string, unknown>
  /** 预览运行时数据池（含 setData / 计算字段实时值） */
  pageData?: PageData | null
  emitLogs?: EmitLogEntry[]
  typeLibrary?: DataTypeLibrary | null
  projectPath?: string
}>()

const emit = defineEmits<{
  refresh: []
  'update:prop': [name: string, value: unknown]
  'update:data-field': [name: string, value: DataFieldValue]
  'clear-emit-logs': []
}>()

/** 组件调试：数据（入参+数据池）/ 日志（emit） */
const debugTab = ref<'data' | 'log'>('data')

watch(
  () => props.mode,
  () => {
    debugTab.value = 'data'
  },
)

watch(
  () => props.emitLogs?.length ?? 0,
  (len, prev) => {
    if (props.mode === 'component' && len > (prev ?? 0)) {
      debugTab.value = 'log'
    }
  },
)

const dataFields = computed(() =>
  (props.pageData?.fields ?? []).filter((item) => item.name.trim()),
)

function isComputedField(field: DataField): boolean {
  return field.binding === 'computed'
}

function isApiBoundField(field: DataField): boolean {
  return field.binding === 'controller' || field.type === 'api'
}

function isReadonlyDataField(field: DataField): boolean {
  return isComputedField(field) || field.type === 'ref' || field.type === 'api'
}

/** json / array 支持 null（未加载）；用勾选表示「有值」 */
function supportsNullToggle(field: DataField): boolean {
  return field.type === 'json' || field.type === 'array'
}

function isDataFieldPresent(field: DataField): boolean {
  return field.value != null
}

/** 取消勾选时暂存，再勾选可恢复 */
const dataFieldNullStash = reactive<Record<string, DataFieldValue>>({})

function defaultPresentDataFieldValue(form: DataFieldFormModel): DataFieldValue {
  const field = form.field
  if (field.type === 'array') return []
  if (field.type === 'json') {
    const ref = field.typeRef?.trim()
    if (ref && props.typeLibrary) {
      const filled = fillNamedInterfaceDefaults({}, ref, props.typeLibrary)
      if (filled && typeof filled === 'object') {
        return filled as DataFieldValue
      }
    }
    if (form.fields.length) {
      const out: Record<string, unknown> = {}
      for (const f of form.fields) {
        out[f.name] =
          f.kind === 'number'
            ? 0
            : f.kind === 'boolean'
              ? false
              : f.kind === 'array'
                ? []
                : f.kind === 'json'
                  ? {}
                  : ''
      }
      return out
    }
    return {}
  }
  return field.value as DataFieldValue
}

function setDataFieldPresent(form: DataFieldFormModel, present: boolean) {
  if (form.readonly || !supportsNullToggle(form.field)) return
  const name = form.field.name.trim()
  if (!name) return
  if (present) {
    const restored = dataFieldNullStash[name]
    const next =
      restored !== undefined ? restored : defaultPresentDataFieldValue(form)
    delete dataFieldNullStash[name]
    onDataFieldInput(form.field, next)
  } else {
    if (form.field.value != null) {
      dataFieldNullStash[name] = form.field.value as DataFieldValue
    }
    onDataFieldInput(form.field, null)
  }
}

function dataFieldTypeLabel(field: DataField): string {
  return field.type
}

function dataFieldRemark(field: DataField): string {
  return field.remark?.trim() || ''
}

function onDataFieldInput(field: DataField, raw: unknown) {
  if (isReadonlyDataField(field)) return
  const name = field.name.trim()
  if (!name) return
  emit('update:data-field', name, raw as DataFieldValue)
}

function onDataJsonBlur(field: DataField, text: string) {
  if (isReadonlyDataField(field)) return
  const name = field.name.trim()
  if (!name) return
  const raw = text.trim()
  if (!raw) {
    emit('update:data-field', name, field.type === 'array' ? [] : {})
    return
  }
  try {
    emit('update:data-field', name, JSON.parse(raw) as DataFieldValue)
  } catch {
    // keep previous
  }
}

type DataFieldFormModel = {
  field: DataField
  mode: 'scalar' | 'object' | 'json' | 'array'
  typeLabel: string
  fields: ObjectFieldForm[]
  itemKind?: FieldKind
  itemEnumOptions?: string[]
  readonly: boolean
}

function objectFieldsFromSubFields(
  subs: Array<{ name: string; type?: string; remark?: string; typeRef?: string }> | undefined,
): ObjectFieldForm[] {
  if (!subs?.length) return []
  return subs
    .map((f) => {
      const name = f.name.trim()
      if (!name) return null
      const info = fieldKindFromType(f.type, f.typeRef)
      return {
        name,
        remark: f.remark?.trim() || '',
        kind: info.kind,
        enumOptions: info.enumOptions,
      }
    })
    .filter((x): x is ObjectFieldForm => Boolean(x))
}

function resolveDataObjectFields(field: DataField): ObjectFieldForm[] {
  const ref = field.typeRef?.trim() || ''
  if (ref) {
    const fromType = objectFieldsOf(ref)
    if (fromType.length) return fromType
  }
  return objectFieldsFromSubFields(
    (field.objectFields ?? []).map((f) => ({
      name: f.name,
      type: f.type,
      typeRef: f.typeRef,
    })),
  )
}

function resolveDataFieldForm(field: DataField): DataFieldFormModel {
  const readonly = isReadonlyDataField(field)

  if (field.type === 'array') {
    // 未加载（null）：整段显示 null，勿当成空数组展开
    if (field.value == null) {
      const ref = field.itemTypeRef?.trim() || ''
      return {
        field,
        mode: 'json',
        typeLabel: arrayTypeLabel(ref ? namedTypeLabel(ref) : ''),
        fields: [],
        readonly,
      }
    }
    if (field.itemType === 'array') {
      return {
        field,
        mode: 'json',
        typeLabel: arrayTypeLabel(
          atomTypeLabel(field.itemItemType, field.itemItemTypeRef),
          2,
        ),
        fields: [],
        readonly,
      }
    }
    const ref = field.itemTypeRef?.trim() || ''
    if (ref) {
      const fields = objectFieldsOf(ref)
      if (fields.length) {
        return {
          field,
          mode: 'array',
          typeLabel: arrayTypeLabel(namedTypeLabel(ref)),
          fields,
          readonly,
        }
      }
      const named = findDataTypeDef(props.typeLibrary, ref)
      if (named?.kind === 'enum') {
        return {
          field,
          mode: 'array',
          typeLabel: arrayTypeLabel(named.name || ref),
          fields: [],
          itemKind: 'enum',
          itemEnumOptions: named.enumMembers.map((m) => m.name).filter(Boolean),
          readonly,
        }
      }
    }
    const itemType = field.itemType || 'string'
    const itemKind: FieldKind =
      itemType === 'number'
        ? 'number'
        : itemType === 'boolean'
          ? 'boolean'
          : itemType === 'json'
            ? 'json'
            : 'string'
    // 无具名类型时，尝试从首个数组项的 objectFields 推断
    const sampleObjFields = field.arrayFields?.[0]?.objectFields
    const inferred = objectFieldsFromSubFields(
      sampleObjFields?.map((f) => ({
        name: f.name,
        type: f.type,
        typeRef: f.typeRef,
      })),
    )
    return {
      field,
      mode: 'array',
      typeLabel: arrayTypeLabel(atomTypeLabel(itemType, ref)),
      fields: inferred,
      itemKind: inferred.length ? undefined : itemKind,
      itemEnumOptions: [],
      readonly,
    }
  }

  if (field.type === 'json') {
    const ref = field.typeRef?.trim() || ''
    // 未加载（null）：显示 null，勿按 typeRef 展开成 id/price=0 等假数据
    if (field.value == null) {
      return {
        field,
        mode: 'json',
        typeLabel: (ref ? namedTypeLabel(ref) : 'object'),
        fields: [],
        readonly,
      }
    }
    const fields = resolveDataObjectFields(field)
    if (fields.length) {
      return {
        field,
        mode: 'object',
        typeLabel: (ref ? namedTypeLabel(ref) : 'object'),
        fields,
        readonly,
      }
    }
    return {
      field,
      mode: 'json',
      typeLabel: (ref ? namedTypeLabel(ref) : 'object'),
      fields: [],
      readonly,
    }
  }

  if (field.type === 'ref' || field.type === 'api') {
    return {
      field,
      mode: 'scalar',
      typeLabel: dataFieldTypeLabel(field),
      fields: [],
      readonly: true,
    }
  }

  return {
    field,
    mode: 'scalar',
    typeLabel: field.type,
    fields: [],
    readonly,
  }
}

const dataFieldForms = computed(() =>
  dataFields.value.map(resolveDataFieldForm),
)

/** 数据池字段：行内展开编辑（同时最多一个） */
const expandedInlineFieldName = ref('')

function isInlineExpandableField(field: DataField): boolean {
  return field.type !== 'boolean'
}

function toggleInlineExpand(form: DataFieldFormModel) {
  const name = form.field.name.trim()
  if (!name) return
  expandedInlineFieldName.value =
    expandedInlineFieldName.value === name ? '' : name
}

function isInlineExpanded(form: DataFieldFormModel): boolean {
  return expandedInlineFieldName.value === form.field.name.trim()
}

/** 具名对象缺字段时写入类型默认值，使画布插值与调试面板数字框一致（如 deliveryFee → 0） */
watch(
  () =>
    dataFields.value.map((f) => ({
      name: f.name,
      type: f.type,
      typeRef: f.typeRef,
      value: f.value,
    })),
  () => {
    if (!props.typeLibrary) return
    for (const field of dataFields.value) {
      if (field.type !== 'json' || !field.typeRef?.trim()) continue
      if (isReadonlyDataField(field)) continue
      // null = 未加载；勿填成空对象，否则 !goodsInfo 等 loading 判断失效
      if (field.value == null) continue
      const filled = fillNamedInterfaceDefaults(
        field.value,
        field.typeRef,
        props.typeLibrary,
      )
      if (filled === field.value) continue
      try {
        if (JSON.stringify(filled) === JSON.stringify(field.value)) continue
      } catch {
        // fall through
      }
      onDataFieldInput(field, filled as DataFieldValue)
    }
  },
  { deep: true, flush: 'post' },
)

function getDataArrayItems(field: DataField): unknown[] {
  return Array.isArray(field.value) ? field.value : []
}

function dataObjectFieldValue(field: DataField, fieldName: string): unknown {
  const obj = field.value
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return (obj as Record<string, unknown>)[fieldName]
  }
  return undefined
}

function setDataObjectField(
  form: DataFieldFormModel,
  fieldName: string,
  value: unknown,
) {
  if (form.readonly) return
  const cur = form.field.value
  const base =
    cur && typeof cur === 'object' && !Array.isArray(cur)
      ? { ...(cur as Record<string, unknown>) }
      : buildObjectDefault(form.fields)
  base[fieldName] = value
  onDataFieldInput(form.field, base)
}

function onDataObjectFieldJsonBlur(
  form: DataFieldFormModel,
  fieldName: string,
  text: string,
  asArray: boolean,
) {
  const raw = text.trim()
  if (!raw) {
    setDataObjectField(form, fieldName, asArray ? [] : {})
    return
  }
  try {
    setDataObjectField(form, fieldName, JSON.parse(raw))
  } catch {
    // keep
  }
}

const propDefs = computed(() =>
  (props.config?.props ?? []).filter((item) => item.name.trim()),
)

function fieldKindFromType(
  type: string | undefined,
  typeRef?: string,
): { kind: FieldKind; enumOptions: string[] } {
  if (typeRef) {
    const def = findDataTypeDef(props.typeLibrary, typeRef)
    if (def?.kind === 'enum') {
      return {
        kind: 'enum',
        enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
      }
    }
    if (def?.kind === 'number') return { kind: 'number', enumOptions: [] }
    if (def?.kind === 'boolean') return { kind: 'boolean', enumOptions: [] }
    if (def?.kind === 'interface') return { kind: 'json', enumOptions: [] }
  }
  if (type === 'number') return { kind: 'number', enumOptions: [] }
  if (type === 'boolean') return { kind: 'boolean', enumOptions: [] }
  if (type === 'array') return { kind: 'array', enumOptions: [] }
  if (type === 'json') return { kind: 'json', enumOptions: [] }
  return { kind: 'string', enumOptions: [] }
}

function objectFieldsOf(typeRef: string): ObjectFieldForm[] {
  const def = findDataTypeDef(props.typeLibrary, typeRef)
  if (!def || def.kind !== 'interface') return []
  return def.fields
    .map((f: InterfaceField) => {
      const name = f.name.trim()
      if (!name) return null
      const mapped = typeExprToDataFieldType(f.type, props.typeLibrary)
      const info = fieldKindFromType(mapped.type, mapped.typeRef)
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

function atomTypeLabel(type: string | undefined, typeRef?: string): string {
  if (typeRef) return namedTypeLabel(typeRef)
  if (type === 'json') return 'object'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'array') return '[]'
  return type || 'string'
}

function resolvePropForm(def: ComponentPropDef): PropFormModel {
  if (def.type === 'array') {
    if (def.itemType === 'array') {
      return {
        def,
        mode: 'json',
        typeLabel: arrayTypeLabel(
          atomTypeLabel(def.itemItemType, def.itemItemTypeRef),
          2,
        ),
        fields: [],
      }
    }
    const ref = def.itemTypeRef?.trim() || ''
    if (ref) {
      const fields = objectFieldsOf(ref)
      if (fields.length) {
        return {
          def,
          mode: 'array',
          typeLabel: arrayTypeLabel(namedTypeLabel(ref)),
          fields,
        }
      }
      const named = findDataTypeDef(props.typeLibrary, ref)
      if (named?.kind === 'enum') {
        return {
          def,
          mode: 'array',
          typeLabel: arrayTypeLabel(named.name || ref),
          fields: [],
          itemKind: 'enum',
          itemEnumOptions: named.enumMembers.map((m) => m.name).filter(Boolean),
        }
      }
    }
    const itemType = def.itemType || 'string'
    const itemKind: FieldKind =
      itemType === 'number'
        ? 'number'
        : itemType === 'boolean'
          ? 'boolean'
          : itemType === 'json'
            ? 'json'
            : 'string'
    return {
      def,
      mode: 'array',
      typeLabel: arrayTypeLabel(atomTypeLabel(itemType, ref)),
      fields: [],
      itemKind,
      itemEnumOptions: [],
    }
  }

  if (def.type === 'json') {
    const ref = def.typeRef?.trim() || ''
    if (ref) {
      const fields = objectFieldsOf(ref)
      if (fields.length) {
        return {
          def,
          mode: 'object',
          typeLabel: namedTypeLabel(ref),
          fields,
        }
      }
    }
    return {
      def,
      mode: 'json',
      typeLabel: ref ? namedTypeLabel(ref) : 'object',
      fields: [],
    }
  }

  if (def.type === 'api') {
    const n = def.apiParams?.length ?? 0
    return {
      def,
      mode: 'api',
      typeLabel: n ? `后端API · ${n} 形参` : '后端API',
      fields: [],
    }
  }

  return {
    def,
    mode: 'scalar',
    typeLabel: def.type,
    fields: [],
  }
}

const propForms = computed(() => propDefs.value.map(resolvePropForm))

function propDisplayValue(def: ComponentPropDef): unknown {
  const name = def.name.trim()
  if (props.propValues && name in props.propValues) {
    return props.propValues[name]
  }
  return buildDollarProps(props.config ?? undefined)[name]
}

function onPropInput(def: ComponentPropDef, raw: unknown) {
  const name = def.name.trim()
  if (!name) return
  emit('update:prop', name, normalizePropDefaultValue(def.type, raw))
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}

function onJsonPropBlur(def: ComponentPropDef, text: string) {
  const name = def.name.trim()
  if (!name) return
  const raw = text.trim()
  if (!raw) {
    emit(
      'update:prop',
      name,
      normalizePropDefaultValue(def.type, def.defaultValue),
    )
    return
  }
  try {
    emit('update:prop', name, JSON.parse(raw) as DataFieldValue)
  } catch {
    // keep previous value on invalid json
  }
}

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

function getArrayItems(def: ComponentPropDef): unknown[] {
  const v = propDisplayValue(def)
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
    const text = typeof v === 'object' ? formatJson(v) : String(v)
    parts.push(`${f.name}: ${text}`)
  }
  return parts.length ? parts.join(' · ') : '（空）'
}

function onObjectFieldJsonBlur(
  def: ComponentPropDef,
  fieldName: string,
  text: string,
  asArray: boolean,
) {
  const raw = text.trim()
  if (!raw) {
    setObjectField(def, fieldName, asArray ? [] : {})
    return
  }
  try {
    setObjectField(def, fieldName, JSON.parse(raw))
  } catch {
    // keep
  }
}

function setObjectField(def: ComponentPropDef, fieldName: string, value: unknown) {
  const cur = propDisplayValue(def)
  const base =
    cur && typeof cur === 'object' && !Array.isArray(cur)
      ? { ...(cur as Record<string, unknown>) }
      : buildObjectDefault(
          propForms.value.find((f) => f.def.name === def.name)?.fields ?? [],
        )
  base[fieldName] = value
  onPropInput(def, base)
}

function objectFieldValue(def: ComponentPropDef, fieldName: string): unknown {
  const obj = propDisplayValue(def)
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return (obj as Record<string, unknown>)[fieldName]
  }
  return undefined
}

const itemDialogVisible = ref(false)
const itemDialogTitle = ref('')
const itemEditDef = ref<ComponentPropDef | null>(null)
const itemEditDataField = ref<DataField | null>(null)
const itemEditIndex = ref(-1)
const itemEditFields = ref<ObjectFieldForm[]>([])
const itemEditIsObject = ref(true)
const itemEditKind = ref<FieldKind>('string')
const itemEditEnumOptions = ref<string[]>([])
const itemEditDraft = reactive<Record<string, unknown>>({})
const itemEditScalar = ref<unknown>('')
const itemEditReadonly = ref(false)

function clearItemEditDraft() {
  for (const key of Object.keys(itemEditDraft)) delete itemEditDraft[key]
}

function openAddArrayItem(form: PropFormModel) {
  itemEditDef.value = form.def
  itemEditDataField.value = null
  itemEditReadonly.value = false
  itemEditIndex.value = -1
  itemEditFields.value = form.fields
  itemEditIsObject.value = form.fields.length > 0
  itemEditKind.value = form.itemKind || 'string'
  itemEditEnumOptions.value = form.itemEnumOptions || []
  itemDialogTitle.value = `添加 · ${form.def.name}`
  clearItemEditDraft()
  if (itemEditIsObject.value) {
    Object.assign(itemEditDraft, buildObjectDefault(form.fields))
  } else {
    itemEditScalar.value = defaultForKind(itemEditKind.value)
  }
  itemDialogVisible.value = true
}

function openEditArrayItem(form: PropFormModel, index: number) {
  const items = getArrayItems(form.def)
  const current = items[index]
  itemEditDef.value = form.def
  itemEditDataField.value = null
  itemEditReadonly.value = false
  itemEditIndex.value = index
  itemEditFields.value = form.fields
  itemEditIsObject.value = form.fields.length > 0
  itemEditKind.value = form.itemKind || 'string'
  itemEditEnumOptions.value = form.itemEnumOptions || []
  itemDialogTitle.value = `编辑 · ${form.def.name}[${index}]`
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

function openAddDataArrayItem(form: DataFieldFormModel) {
  if (form.readonly) return
  itemEditDef.value = null
  itemEditDataField.value = form.field
  itemEditReadonly.value = false
  itemEditIndex.value = -1
  itemEditFields.value = form.fields
  itemEditIsObject.value = form.fields.length > 0
  itemEditKind.value = form.itemKind || 'string'
  itemEditEnumOptions.value = form.itemEnumOptions || []
  itemDialogTitle.value = `添加 · ${form.field.name}`
  clearItemEditDraft()
  if (itemEditIsObject.value) {
    Object.assign(itemEditDraft, buildObjectDefault(form.fields))
  } else {
    itemEditScalar.value = defaultForKind(itemEditKind.value)
  }
  itemDialogVisible.value = true
}

function openEditDataArrayItem(form: DataFieldFormModel, index: number) {
  const items = getDataArrayItems(form.field)
  const current = items[index]
  itemEditDef.value = null
  itemEditDataField.value = form.field
  itemEditReadonly.value = form.readonly
  itemEditIndex.value = index
  itemEditFields.value = form.fields
  itemEditIsObject.value = form.fields.length > 0
  itemEditKind.value = form.itemKind || 'string'
  itemEditEnumOptions.value = form.itemEnumOptions || []
  itemDialogTitle.value = `${form.readonly ? '查看' : '编辑'} · ${form.field.name}[${index}]`
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

function removeArrayItem(def: ComponentPropDef, index: number) {
  const next = [...getArrayItems(def)]
  next.splice(index, 1)
  onPropInput(def, next)
}

function removeDataArrayItem(field: DataField, index: number) {
  if (isReadonlyDataField(field)) return
  const next = [...getDataArrayItems(field)]
  next.splice(index, 1)
  onDataFieldInput(field, next)
}

function setItemField(name: string, value: unknown) {
  itemEditDraft[name] = value
}

function onItemNestedJsonBlur(fieldName: string, text: string, asArray: boolean) {
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

function saveItemDialog() {
  if (itemEditReadonly.value) {
    itemDialogVisible.value = false
    return
  }
  const value = itemEditIsObject.value
    ? { ...itemEditDraft }
    : itemEditScalar.value

  if (itemEditDataField.value) {
    const field = itemEditDataField.value
    const next = [...getDataArrayItems(field)]
    if (itemEditIndex.value >= 0) next[itemEditIndex.value] = value
    else next.push(value)
    onDataFieldInput(field, next)
    itemDialogVisible.value = false
    return
  }

  const def = itemEditDef.value
  if (!def) return
  const next = [...getArrayItems(def)]
  if (itemEditIndex.value >= 0) next[itemEditIndex.value] = value
  else next.push(value)
  onPropInput(def, next)
  itemDialogVisible.value = false
}

watch(
  () => props.mode,
  () => {
    itemDialogVisible.value = false
  },
)
</script>

<template>
  <aside class="preview-debug">
    <div class="panel-header">
      <span>调试</span>
      <el-radio-group
        v-if="mode === 'component'"
        v-model="debugTab"
        size="small"
        class="panel-tabs"
      >
        <el-radio-button value="data">数据</el-radio-button>
        <el-radio-button value="log">
          日志
          <span v-if="emitLogs?.length" class="tab-badge">{{ emitLogs.length }}</span>
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="panel-body">
      <!-- 组件 · 数据：入参 + 数据池 -->
      <template v-if="mode === 'component' && debugTab === 'data'">
      <div class="section">
        <div class="section-title">入参</div>
        <el-empty
          v-if="!propForms.length"
          description="暂无入参"
          :image-size="48"
        />
        <div v-else class="prop-list">
          <div v-for="form in propForms" :key="form.def.name" class="prop-row">
            <div class="prop-label">
              <span class="prop-name">{{ form.def.name }}</span>
              <span class="prop-type">{{ form.typeLabel }}</span>
            </div>

            <el-switch
              v-if="form.mode === 'scalar' && form.def.type === 'boolean'"
              :model-value="propDisplayValue(form.def) === true"
              @update:model-value="onPropInput(form.def, $event)"
            />
            <el-input-number
              v-else-if="form.mode === 'scalar' && form.def.type === 'number'"
              :model-value="Number(propDisplayValue(form.def) ?? 0)"
              controls-position="right"
              style="width: 100%"
              @update:model-value="onPropInput(form.def, $event ?? 0)"
            />
            <ColorPicker
              v-else-if="form.mode === 'scalar' && form.def.type === 'color'"
              :model-value="String(propDisplayValue(form.def) ?? '')"
              placeholder="#409eff / rgba(...)"
              @update:model-value="onPropInput(form.def, $event)"
            />
            <ApiPropBindField
              v-else-if="form.mode === 'api'"
              :model-value="String(propDisplayValue(form.def) ?? '')"
              :project-path="projectPath || ''"
              :api-params="form.def.apiParams"
              :api-return-type="form.def.apiReturnType"
              :data-fields="dataFields"
              :type-library="typeLibrary"
              @update:model-value="onPropInput(form.def, $event)"
            />
            <el-input
              v-else-if="form.mode === 'scalar'"
              :model-value="String(propDisplayValue(form.def) ?? '')"
              @update:model-value="onPropInput(form.def, $event)"
            />

            <!-- 具名对象：字段展开 -->
            <div v-else-if="form.mode === 'object'" class="object-fields">
              <div
                v-for="field in form.fields"
                :key="field.name"
                class="object-field"
              >
                <div class="object-field-label">
                  <span class="prop-name">{{ field.name }}</span>
                  <span v-if="field.remark" class="prop-type">{{ field.remark }}</span>
                </div>
                <el-switch
                  v-if="field.kind === 'boolean'"
                  :model-value="objectFieldValue(form.def, field.name) === true"
                  @update:model-value="
                    setObjectField(form.def, field.name, $event === true)
                  "
                />
                <el-input-number
                  v-else-if="field.kind === 'number'"
                  :model-value="Number(objectFieldValue(form.def, field.name) ?? 0)"
                  controls-position="right"
                  style="width: 100%"
                  @update:model-value="
                    setObjectField(form.def, field.name, $event ?? 0)
                  "
                />
                <el-select
                  v-else-if="field.kind === 'enum'"
                  :model-value="String(objectFieldValue(form.def, field.name) ?? '')"
                  clearable
                  placeholder="选择"
                  style="width: 100%"
                  @update:model-value="
                    setObjectField(form.def, field.name, $event ?? '')
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
                  :model-value="formatJson(objectFieldValue(form.def, field.name))"
                  @blur="
                    onObjectFieldJsonBlur(
                      form.def,
                      field.name,
                      ($event.target as HTMLTextAreaElement).value,
                      field.kind === 'array',
                    )
                  "
                />
                <el-input
                  v-else
                  :model-value="
                    String(objectFieldValue(form.def, field.name) ?? '')
                  "
                  @update:model-value="
                    setObjectField(form.def, field.name, String($event ?? ''))
                  "
                />
              </div>
            </div>

            <!-- 数组：逐项列表（对齐后端入参） -->
            <div v-else-if="form.mode === 'array'" class="array-list">
              <div
                v-if="!getArrayItems(form.def).length"
                class="array-empty"
              >
                暂无数据，点击下方添加
              </div>
              <div
                v-for="(item, index) in getArrayItems(form.def)"
                :key="`${form.def.name}-${index}`"
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
                    @click="removeArrayItem(form.def, index)"
                  />
                </div>
              </div>
              <button
                type="button"
                class="array-item array-add-item"
                @click="openAddArrayItem(form)"
              >
                <div class="array-item-main">
                  <span class="array-index array-add-icon">
                    <el-icon :size="12"><Plus /></el-icon>
                  </span>
                  <span class="array-summary array-add-label">添加</span>
                </div>
              </button>
            </div>

            <el-input
              v-else
              type="textarea"
              :rows="3"
              :model-value="formatJson(propDisplayValue(form.def))"
              @blur="
                onJsonPropBlur(
                  form.def,
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
          </div>
        </div>
      </div>
      </template>

      <!-- 组件 · 日志：Emit -->
      <div
        v-if="mode === 'component' && debugTab === 'log'"
        class="section emit-section"
      >
        <div class="section-title row">
          <span>Emit 日志</span>
          <el-button
            type="danger"
            link
            :icon="Delete"
            :disabled="!(emitLogs && emitLogs.length)"
            @click="emit('clear-emit-logs')"
          >
            清空
          </el-button>
        </div>
        <el-empty
          v-if="!emitLogs?.length"
          description="点击画布触发 emit 后显示在这里"
          :image-size="48"
        />
        <div v-else class="emit-log">
          <div v-for="item in emitLogs" :key="item.id" class="emit-card">
            <div class="emit-head">
              <span class="emit-event">{{ item.event }}</span>
              <span class="emit-time">{{ item.time }}</span>
            </div>
            <pre class="emit-args">{{ formatJson(item.args) }}</pre>
          </div>
        </div>
      </div>

      <!-- 数据池：页面始终显示；组件在「数据」页 -->
      <div
        v-if="mode === 'page' || debugTab === 'data'"
        class="section"
      >
        <div class="section-title row">
          <span>数据池</span>
          <el-button
            v-if="mode === 'component'"
            :icon="RefreshRight"
            link
            type="primary"
            @click="emit('refresh')"
          >
            刷新
          </el-button>
        </div>
        <el-empty
          v-if="!dataFieldForms.length"
          description="暂无数据池字段"
          :image-size="48"
        />
        <div v-else class="param-list">
          <div
            v-for="form in dataFieldForms"
            :key="form.field.name"
            class="data-field-summary"
            :class="{
              'is-expanded': isInlineExpanded(form),
              'has-remark': Boolean(dataFieldRemark(form.field)),
            }"
          >
            <div class="data-field-summary-top">
              <div class="data-field-summary-main">
                <span
                  v-if="isComputedField(form.field)"
                  class="binding-field-icon is-computed"
                  title="计算字段"
                  aria-label="计算字段"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <rect
                      x="2.25"
                      y="1.25"
                      width="11.5"
                      height="13.5"
                      rx="1.75"
                      stroke="currentColor"
                      stroke-width="1.25"
                    />
                    <rect
                      x="4"
                      y="3"
                      width="8"
                      height="2.5"
                      rx="0.5"
                      fill="currentColor"
                      opacity="0.35"
                    />
                    <rect x="4" y="7" width="2" height="1.75" rx="0.35" fill="currentColor" />
                    <rect x="7" y="7" width="2" height="1.75" rx="0.35" fill="currentColor" />
                    <rect x="10" y="7" width="2" height="1.75" rx="0.35" fill="currentColor" />
                    <rect x="4" y="9.75" width="2" height="1.75" rx="0.35" fill="currentColor" />
                    <rect x="7" y="9.75" width="2" height="1.75" rx="0.35" fill="currentColor" />
                    <rect x="10" y="9.75" width="2" height="1.75" rx="0.35" fill="currentColor" />
                    <rect x="4" y="12.5" width="5" height="1.75" rx="0.35" fill="currentColor" />
                    <rect x="10" y="12.5" width="2" height="1.75" rx="0.35" fill="currentColor" />
                  </svg>
                </span>
                <span
                  v-else-if="isApiBoundField(form.field)"
                  class="binding-field-icon is-controller"
                  title="控制器字段"
                  aria-label="控制器字段"
                >
                  <el-icon :size="14"><Connection /></el-icon>
                </span>
                <el-checkbox
                  v-else-if="form.field.type === 'boolean'"
                  :model-value="form.field.value === true"
                  :disabled="form.readonly"
                  title="布尔值"
                  @update:model-value="
                    onDataFieldInput(form.field, $event === true)
                  "
                />
                <el-checkbox
                  v-else
                  :model-value="
                    supportsNullToggle(form.field)
                      ? isDataFieldPresent(form.field)
                      : true
                  "
                  :disabled="
                    form.readonly || !supportsNullToggle(form.field)
                  "
                  title="勾选=有值；不勾选=null"
                  @update:model-value="
                    supportsNullToggle(form.field)
                      ? setDataFieldPresent(form, $event === true)
                      : undefined
                  "
                />
                <div class="data-field-summary-text">
                  <div class="data-field-summary-line">
                    <span class="prop-name">{{ form.field.name }}</span>
                    <span class="prop-type">: {{ form.typeLabel }}</span>
                  </div>
                  <div
                    v-if="dataFieldRemark(form.field)"
                    class="data-field-remark"
                    :title="dataFieldRemark(form.field)"
                  >
                    {{ dataFieldRemark(form.field) }}
                  </div>
                </div>
              </div>
              <el-button
                v-if="isInlineExpandableField(form.field)"
                type="primary"
                link
                class="expand-btn"
                :class="{ 'is-open': isInlineExpanded(form) }"
                :icon="ArrowDown"
                @click="toggleInlineExpand(form)"
              />
            </div>
            <div
              v-if="isInlineExpandableField(form.field) && isInlineExpanded(form)"
              class="data-field-inline-editor"
            >
              <div
                v-if="
                  supportsNullToggle(form.field) && !isDataFieldPresent(form.field)
                "
                class="null-hint"
              >
                null（外侧不勾选时为空）
              </div>

              <template v-else-if="form.mode === 'scalar'">
                <el-input-number
                  v-if="form.field.type === 'number'"
                  :model-value="Number(form.field.value ?? 0)"
                  :disabled="form.readonly"
                  controls-position="right"
                  style="width: 100%"
                  @update:model-value="onDataFieldInput(form.field, $event ?? 0)"
                />
                <ColorPicker
                  v-else-if="form.field.type === 'color'"
                  class="data-field-color-picker"
                  :class="{ 'is-readonly': form.readonly }"
                  :model-value="String(form.field.value ?? '')"
                  placeholder="#409eff / rgba(...)"
                  @update:model-value="onDataFieldInput(form.field, $event)"
                />
                <el-input
                  v-else
                  :model-value="
                    form.field.value == null ? '' : String(form.field.value)
                  "
                  :readonly="form.readonly"
                  placeholder="输入字符串"
                  @update:model-value="onDataFieldInput(form.field, $event)"
                />
              </template>

              <div v-else-if="form.mode === 'object'" class="object-fields">
                <div
                  v-for="sub in form.fields"
                  :key="sub.name"
                  class="object-field"
                >
                  <div class="object-field-label">
                    <span class="prop-name">{{ sub.name }}</span>
                    <span v-if="sub.remark" class="prop-type">{{
                      sub.remark
                    }}</span>
                  </div>
                  <el-switch
                    v-if="sub.kind === 'boolean'"
                    :model-value="
                      dataObjectFieldValue(form.field, sub.name) === true
                    "
                    :disabled="form.readonly"
                    @update:model-value="
                      setDataObjectField(form, sub.name, $event === true)
                    "
                  />
                  <el-input-number
                    v-else-if="sub.kind === 'number'"
                    :model-value="
                      Number(dataObjectFieldValue(form.field, sub.name) ?? 0)
                    "
                    :disabled="form.readonly"
                    controls-position="right"
                    style="width: 100%"
                    @update:model-value="
                      setDataObjectField(form, sub.name, $event ?? 0)
                    "
                  />
                  <el-select
                    v-else-if="sub.kind === 'enum'"
                    :model-value="
                      String(dataObjectFieldValue(form.field, sub.name) ?? '')
                    "
                    :disabled="form.readonly"
                    clearable
                    placeholder="选择"
                    style="width: 100%"
                    @update:model-value="
                      setDataObjectField(form, sub.name, $event ?? '')
                    "
                  >
                    <el-option
                      v-for="opt in sub.enumOptions"
                      :key="opt"
                      :label="opt"
                      :value="opt"
                    />
                  </el-select>
                  <el-input
                    v-else-if="sub.kind === 'json' || sub.kind === 'array'"
                    type="textarea"
                    :rows="2"
                    :readonly="form.readonly"
                    :model-value="
                      formatJson(dataObjectFieldValue(form.field, sub.name))
                    "
                    @blur="
                      form.readonly
                        ? undefined
                        : onDataObjectFieldJsonBlur(
                            form,
                            sub.name,
                            ($event.target as HTMLTextAreaElement).value,
                            sub.kind === 'array',
                          )
                    "
                  />
                  <el-input
                    v-else
                    :readonly="form.readonly"
                    :model-value="
                      String(dataObjectFieldValue(form.field, sub.name) ?? '')
                    "
                    @update:model-value="
                      setDataObjectField(form, sub.name, String($event ?? ''))
                    "
                  />
                </div>
              </div>

              <div v-else-if="form.mode === 'array'" class="array-list">
                <div
                  v-if="!getDataArrayItems(form.field).length"
                  class="array-empty"
                >
                  暂无数据{{ form.readonly ? '' : '，点击下方添加' }}
                </div>
                <div
                  v-for="(item, index) in getDataArrayItems(form.field)"
                  :key="`${form.field.name}-${index}`"
                  class="array-item"
                  @click="openEditDataArrayItem(form, index)"
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
                      @click="openEditDataArrayItem(form, index)"
                    />
                    <el-button
                      v-if="!form.readonly"
                      type="danger"
                      link
                      :icon="Delete"
                      @click="removeDataArrayItem(form.field, index)"
                    />
                  </div>
                </div>
                <button
                  v-if="!form.readonly"
                  type="button"
                  class="array-item array-add-item"
                  @click="openAddDataArrayItem(form)"
                >
                  <div class="array-item-main">
                    <span class="array-index array-add-icon">
                      <el-icon :size="12"><Plus /></el-icon>
                    </span>
                    <span class="array-summary array-add-label">添加</span>
                  </div>
                </button>
              </div>

              <pre
                v-else-if="form.readonly"
                class="data-readonly-json"
              >{{ formatJson(form.field.value) }}</pre>
              <el-input
                v-else
                type="textarea"
                :rows="6"
                :model-value="formatJson(form.field.value)"
                @blur="
                  onDataJsonBlur(
                    form.field,
                    ($event.target as HTMLTextAreaElement).value,
                  )
                "
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="itemDialogVisible"
      :title="itemDialogTitle"
      width="420px"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >      <div v-if="itemEditIsObject" class="item-form">
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
            @update:model-value="setItemField(field.name, String($event ?? ''))"
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
            :rows="3"
            :model-value="formatJson(itemEditScalar)"
            @blur="
              (() => {
                const raw = ($event.target as HTMLTextAreaElement).value.trim()
                if (!raw) {
                  itemEditScalar = itemEditKind === 'array' ? [] : {}
                  return
                }
                try {
                  itemEditScalar = JSON.parse(raw)
                } catch {
                  /* keep */
                }
              })()
            "
          />
          <el-input
            v-else
            :model-value="String(itemEditScalar ?? '')"
            @update:model-value="itemEditScalar = $event"
          />
        </div>
      </div>
      <template #footer>
        <el-button v-if="itemEditReadonly" @click="itemDialogVisible = false">
          关闭
        </el-button>
        <el-button
          v-if="!itemEditReadonly"
          type="primary"
          @click="saveItemDialog"
        >
          确定
        </el-button>
      </template>
    </el-dialog>
  </aside>
</template>

<style scoped>
.preview-debug {
  width: var(--workspace-right-width, 300px);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-left: 1px solid #ebeef5;
}

.panel-header {
  flex-shrink: 0;
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.panel-tabs {
  flex-shrink: 0;
}

.panel-tabs :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  padding: 0 11px;
  box-sizing: border-box;
  line-height: 1;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.35);
  color: inherit;
  font-size: 10px;
  line-height: 1;
  box-sizing: border-box;
  flex-shrink: 0;
}

.panel-tabs :deep(.el-radio-button:not(.is-active) .tab-badge) {
  background: #409eff;
  color: #fff;
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
}

.prop-list,
.method-list,
.param-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.data-field-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 4px 0;
  border-bottom: 1px solid #f0f2f5;
}

.data-field-summary:last-child {
  border-bottom: none;
}

.data-field-summary-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.data-field-summary.has-remark .data-field-summary-top,
.data-field-summary.has-remark .data-field-summary-main {
  align-items: flex-start;
}

.data-field-summary-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.data-field-summary-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.data-field-summary-line {
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  line-height: 1.4;
}

.data-field-summary-line .prop-name,
.data-field-summary-line .prop-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.data-field-summary-line .prop-name {
  flex-shrink: 0;
  max-width: 55%;
}

.data-field-summary-line .prop-type {
  min-width: 0;
}

.data-field-remark {
  font-size: 11px;
  line-height: 1.35;
  color: #94a3b8;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
}

.data-field-summary.has-remark .binding-field-icon,
.data-field-summary.has-remark .data-field-summary-main > .el-checkbox {
  margin-top: 2px;
}

.data-field-summary.has-remark .expand-btn {
  margin-top: 1px;
}

.binding-field-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.binding-field-icon.is-computed {
  color: #8b5cf6;
}

.binding-field-icon.is-controller {
  color: #f97316;
}

.expand-btn {
  height: 22px;
  padding: 0 2px;
  margin: 0;
}

.expand-btn :deep(.el-icon) {
  transition: transform 0.15s ease;
}

.expand-btn.is-open :deep(.el-icon) {
  transform: rotate(180deg);
}

.data-field-inline-editor {
  padding-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.data-field-inline-editor .object-fields,
.data-field-inline-editor .array-list {
  max-height: 280px;
  overflow: auto;
}

.data-field-color-picker.is-readonly {
  pointer-events: none;
  opacity: 0.72;
}

.param-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.data-readonly-json {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  font-size: 12px;
  line-height: 1.45;
  color: #606266;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
}

.prop-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prop-label,
.method-meta,
.object-field-label,
.item-form-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.null-hint {
  font-size: 12px;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 4px 0 2px;
}

.prop-name,
.method-name {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
}

.prop-type,
.method-params {
  font-size: 12px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.object-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.object-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.array-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.array-empty {
  font-size: 12px;
  color: #94a3b8;
  padding: 8px 0;
}

.array-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
}

.array-item:hover {
  border-color: #c0c4cc;
}

.array-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.array-index {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e8eef7;
  color: #409eff;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.array-summary {
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.array-item-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}

.array-add-item {
  width: 100%;
  margin: 0;
  border-style: dashed;
  background: transparent;
  color: #409eff;
  font: inherit;
  text-align: left;
}

.array-add-item:hover {
  border-color: #409eff;
  background: #f5f9ff;
}

.array-add-icon {
  background: #ecf5ff;
  color: #409eff;
}

.array-add-label {
  color: #409eff;
}

.item-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.item-form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.method-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.emit-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.emit-log {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  flex: 1;
  min-height: 0;
  scrollbar-width: none;
}

.emit-log::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.emit-log:hover {
  scrollbar-width: thin;
  scrollbar-color: #c0c4cc transparent;
}

.emit-log:hover::-webkit-scrollbar {
  width: 6px;
}

.emit-log:hover::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.emit-card {
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.emit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.emit-event {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.emit-time {
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
}

.emit-args {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
