<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, EditPen, Plus, RefreshRight } from '@element-plus/icons-vue'
import type { ComponentConfig, ComponentPropDef } from '../../types/component'
import type { MethodParam, PageMethod } from '../../types/page-method'
import type { DataFieldValue } from '../../types/page-data'
import type {
  DataTypeLibrary,
  InterfaceField,
} from '../../types/data-types'
import {
  buildDollarProps,
  normalizePropDefaultValue,
} from '../../utils/component-props'
import { findDataTypeDef, typeExprToDataFieldType } from '../../utils/named-type-fields'
import ColorPicker from './ColorPicker.vue'

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
  mode: 'scalar' | 'object' | 'json' | 'array'
  typeLabel: string
  fields: ObjectFieldForm[]
  itemKind?: FieldKind
  itemEnumOptions?: string[]
}

const props = defineProps<{
  mode: 'page' | 'component'
  canGoBack?: boolean
  hasEntryPage?: boolean
  config?: ComponentConfig | null
  methods?: PageMethod[]
  propValues?: Record<string, unknown>
  emitLogs?: EmitLogEntry[]
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  back: []
  'go-entry': []
  refresh: []
  'update:prop': [name: string, value: unknown]
  'invoke-method': [payload: { name: string; args: unknown[] }]
  'clear-emit-logs': []
}>()

const propDefs = computed(() =>
  (props.config?.props ?? []).filter((item) => item.name.trim()),
)

const exposedMethods = computed(() => {
  const names = props.config?.exposedMethods ?? []
  const list = props.methods ?? []
  return names
    .map((name) => {
      const method = list.find((item) => item.name === name && !item.builtin)
      return {
        name,
        params: method?.params ?? [],
        hasBody: Boolean(method?.body?.trim()),
      }
    })
    .filter((item) => item.name.trim())
})

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
  if (type === 'json') return '对象'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'array') return '数组'
  return type || 'string'
}

function resolvePropForm(def: ComponentPropDef): PropFormModel {
  if (def.type === 'array') {
    if (def.itemType === 'array') {
      return {
        def,
        mode: 'json',
        typeLabel: `数组 / 数组 / ${atomTypeLabel(def.itemItemType, def.itemItemTypeRef)}`,
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
          typeLabel: `数组 / ${namedTypeLabel(ref)}`,
          fields,
        }
      }
      const named = findDataTypeDef(props.typeLibrary, ref)
      if (named?.kind === 'enum') {
        return {
          def,
          mode: 'array',
          typeLabel: `数组 / ${named.name || ref}`,
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
      typeLabel: `数组 / ${atomTypeLabel(itemType, ref)}`,
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
      typeLabel: ref ? namedTypeLabel(ref) : '对象',
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
const itemEditIndex = ref(-1)
const itemEditFields = ref<ObjectFieldForm[]>([])
const itemEditIsObject = ref(true)
const itemEditKind = ref<FieldKind>('string')
const itemEditEnumOptions = ref<string[]>([])
const itemEditDraft = reactive<Record<string, unknown>>({})
const itemEditScalar = ref<unknown>('')

function clearItemEditDraft() {
  for (const key of Object.keys(itemEditDraft)) delete itemEditDraft[key]
}

function openAddArrayItem(form: PropFormModel) {
  itemEditDef.value = form.def
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

function removeArrayItem(def: ComponentPropDef, index: number) {
  const next = [...getArrayItems(def)]
  next.splice(index, 1)
  onPropInput(def, next)
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
  const def = itemEditDef.value
  if (!def) return
  const next = [...getArrayItems(def)]
  const value = itemEditIsObject.value
    ? { ...itemEditDraft }
    : itemEditScalar.value
  if (itemEditIndex.value >= 0) next[itemEditIndex.value] = value
  else next.push(value)
  onPropInput(def, next)
  itemDialogVisible.value = false
}

const invokeVisible = ref(false)
const invokeName = ref('')
const invokeParams = ref<MethodParam[]>([])
const invokeDraft = reactive<Record<string, string>>({})

function openInvoke(method: { name: string; params: MethodParam[] }) {
  if (!method.params.length) {
    emit('invoke-method', { name: method.name, args: [] })
    return
  }
  invokeName.value = method.name
  invokeParams.value = method.params
  for (const key of Object.keys(invokeDraft)) delete invokeDraft[key]
  for (const param of method.params) {
    const key = param.name.trim()
    if (!key) continue
    invokeDraft[key] =
      param.type === 'boolean'
        ? 'false'
        : param.type === 'number'
          ? '0'
          : param.type === 'object' || param.type === 'array'
            ? param.type === 'array'
              ? '[]'
              : '{}'
            : ''
  }
  invokeVisible.value = true
}

function parseParamValue(param: MethodParam, raw: string): unknown {
  const text = raw.trim()
  if (param.type === 'boolean') {
    const s = text.toLowerCase()
    return s === 'true' || s === '1'
  }
  if (param.type === 'number') {
    const n = Number(text)
    return Number.isFinite(n) ? n : 0
  }
  if (param.type === 'object' || param.type === 'array' || param.type === 'any') {
    if (!text) return param.type === 'array' ? [] : {}
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return raw
}

function confirmInvoke() {
  const args = invokeParams.value.map((param) =>
    parseParamValue(param, invokeDraft[param.name.trim()] ?? ''),
  )
  emit('invoke-method', { name: invokeName.value, args })
  invokeVisible.value = false
}

watch(
  () => props.mode,
  () => {
    invokeVisible.value = false
    itemDialogVisible.value = false
  },
)
</script>

<template>
  <aside class="preview-debug">
    <div class="panel-header">调试</div>

    <div v-if="mode === 'page'" class="panel-body">
      <div class="section">
        <div class="section-title">页面导航</div>
        <div class="nav-actions">
          <el-button @click="emit('back')" :disabled="!canGoBack">返回</el-button>
          <el-button @click="emit('go-entry')" :disabled="!hasEntryPage">
            回到入口页
          </el-button>
          <el-button :icon="RefreshRight" @click="emit('refresh')">刷新</el-button>
        </div>
      </div>
    </div>

    <div v-else class="panel-body">
      <div class="section">
        <div class="section-title">Props</div>
        <el-empty
          v-if="!propForms.length"
          description="暂无 Props"
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

      <div class="section">
        <div class="section-title">暴露方法</div>
        <el-empty
          v-if="!exposedMethods.length"
          description="暂无暴露方法"
          :image-size="48"
        />
        <div v-else class="method-list">
          <div
            v-for="method in exposedMethods"
            :key="method.name"
            class="method-row"
          >
            <div class="method-meta">
              <span class="method-name">{{ method.name }}</span>
              <span class="method-params">
                {{
                  method.params.length
                    ? `(${method.params.map((p) => p.name).join(', ')})`
                    : '()'
                }}
              </span>
            </div>
            <el-button
              type="primary"
              link
              :disabled="!method.hasBody"
              @click="openInvoke(method)"
            >
              {{ method.params.length ? '执行…' : '执行' }}
            </el-button>
          </div>
        </div>
      </div>

      <div class="section emit-section">
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
          description="尚无 emit 触发"
          :image-size="48"
        />
        <ul v-else class="emit-log">
          <li v-for="item in emitLogs" :key="item.id" class="emit-item">
            <div class="emit-head">
              <span class="emit-event">{{ item.event }}</span>
              <span class="emit-time">{{ item.time }}</span>
            </div>
            <pre class="emit-args">{{ formatJson(item.args) }}</pre>
          </li>
        </ul>
      </div>
    </div>

    <el-dialog
      v-model="itemDialogVisible"
      :title="itemDialogTitle"
      width="420px"
      append-to-body
      destroy-on-close
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
        <el-button @click="itemDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveItemDialog">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="invokeVisible"
      :title="`执行 ${invokeName}`"
      width="420px"
      destroy-on-close
      append-to-body
    >
      <el-form label-width="88px">
        <el-form-item
          v-for="param in invokeParams"
          :key="param.name"
          :label="param.name"
        >
          <el-select
            v-if="param.type === 'boolean'"
            v-model="invokeDraft[param.name]"
            style="width: 100%"
          >
            <el-option label="true" value="true" />
            <el-option label="false" value="false" />
          </el-select>
          <el-input
            v-else-if="param.type === 'object' || param.type === 'array' || param.type === 'any'"
            v-model="invokeDraft[param.name]"
            type="textarea"
            :rows="3"
            :placeholder="param.type === 'array' ? '[]' : '{}'"
          />
          <el-input
            v-else
            v-model="invokeDraft[param.name]"
            :placeholder="param.type"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="invokeVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmInvoke">执行</el-button>
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
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
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

.nav-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nav-actions .el-button {
  margin: 0;
  width: 100%;
}

.prop-list,
.method-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  align-items: baseline;
  gap: 6px;
  min-width: 0;
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

.array-add {
  align-self: flex-start;
  margin: 0;
  padding: 0;
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
  min-height: 120px;
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
  scrollbar-width: none;
  scrollbar-gutter: auto;
}

.emit-log::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.emit-item {
  padding: 8px 10px;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
}

.emit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.emit-event {
  font-size: 12px;
  font-weight: 600;
  color: #7dd3fc;
}

.emit-time {
  font-size: 11px;
  color: #94a3b8;
}

.emit-args {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
