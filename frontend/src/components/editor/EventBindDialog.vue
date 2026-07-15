<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import {
  CUSTOM_EVENT_METHOD,
  buildEmitAmbientDeclarations,
  dataFieldsToAmbientVars,
  isCustomEventMethod,
  parseEventBindings,
  serializeEventBindings,
  type EventMethodBinding,
  type MethodParam,
  type PageMethod,
} from '../../types/page-method'
import type { ComponentEventDef } from '../../types/component'
import {
  DATA_FIELD_TYPE_OPTIONS,
  buildArrayValue,
  buildObjectValue,
  createEmptyDataField,
  defaultValue,
  resolveArrayFields,
  resolveObjectFields,
  type ArraySubField,
  type DataField,
  type DataFieldType,
  type ObjectSubField,
} from '../../types/page-data'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'
import TsCodeEditor from './TsCodeEditor.vue'
import type { ComponentRenderMap } from '../../types/component-render'
import {
  buildRefAmbientDeclarations,
  type ComponentMethodsMap,
} from '../../utils/widget-ref'

const props = defineProps<{
  modelValue: boolean
  eventLabel: string
  rawValue: string
  methods: PageMethod[]
  dataFields?: DataField[]
  /** 当前页面/组件 XML，用于解析「引用」节点 */
  xml?: string
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  iconOptions?: Array<{ id: string; label: string }>
  /** 组件「事件方法」定义，用于绑定 emit 时选择事件名与参数 */
  emitEvents?: ComponentEventDef[]
  /** 当前事件自身的形参（写自定义方法体时作为函数参数） */
  eventParams?: MethodParam[]
  /** 自定义方法体函数名展示 */
  eventKey?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [value: string]
}>()

const draft = ref<EventMethodBinding[]>([])

const objectDialogVisible = ref(false)
const arrayDialogVisible = ref(false)
const editingBindingId = ref('')
const editingObjectFields = ref<ObjectSubField[]>([])
const editingArrayFields = ref<ArraySubField[]>([])

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

const methodMap = computed(() => {
  const map = new Map<string, PageMethod>()
  for (const item of props.methods) map.set(item.name, item)
  return map
})

const fieldOptions = computed(() =>
  (props.dataFields ?? []).filter((item) => item.name.trim()),
)

const typeLabelMap = computed(() => {
  const map = new Map<string, string>()
  for (const opt of DATA_FIELD_TYPE_OPTIONS) map.set(opt.value, opt.label)
  return map
})

watch(
  () => [props.modelValue, props.rawValue] as const,
  ([open]) => {
    if (!open) {
      navigateParamDrafts.clear()
      return
    }
    navigateParamDrafts.clear()
    const list = parseEventBindings(props.rawValue)
    draft.value = list.length
      ? list.map((item) => ({
          ...item,
          args: { ...item.args },
          body: item.body ?? '',
        }))
      : []
  },
)

function createId() {
  return `bind_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function addBinding() {
  const first = props.methods[0]
  draft.value.push({
    id: createId(),
    method: first?.name ?? '',
    args: {},
    body: '',
  })
}

function removeBinding(index: number) {
  draft.value.splice(index, 1)
}

function onMethodChange(binding: EventMethodBinding) {
  if (isCustomEventMethod(binding.method)) {
    binding.args = {}
    if (binding.body == null) binding.body = ''
    navigateParamDrafts.delete(binding.id)
    return
  }
  const method = methodMap.value.get(binding.method)
  const nextArgs: Record<string, string> = {}
  for (const param of paramsOf(binding.method, binding)) {
    nextArgs[param.name] = binding.args[param.name] ?? ''
  }
  if (method?.name === 'emit' && binding.args.event) {
    nextArgs.event = binding.args.event
  }
  if (method?.name === 'showToast' && !nextArgs.duration) {
    nextArgs.duration = 'short'
  }
  binding.args = nextArgs
  navigateParamDrafts.delete(binding.id)
  if (method?.name === 'navigateTo') {
    ensureNavigateParams(binding)
  }
}

function isEmit(methodName: string) {
  return methodName === 'emit'
}

function isCustom(methodName: string) {
  return isCustomEventMethod(methodName)
}

function emitEventOptions() {
  return (props.emitEvents ?? [])
    .map((item) => item.name.trim())
    .filter(Boolean)
}

const customFnName = computed(() => {
  const key = (props.eventKey ?? '').trim()
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : 'handler'
})

const customParams = computed<MethodParam[]>(() =>
  (props.eventParams ?? [])
    .filter((item) => item.name.trim())
    .map((item) => ({ name: item.name.trim(), type: item.type })),
)

const eventParamHints = computed(() =>
  customParams.value.map((item) => ({
    name: item.name,
    type: item.type,
    sample: `{${item.name}}`,
  })),
)

const customAmbientVars = computed(() => dataFieldsToAmbientVars(props.dataFields))

const customAmbientExtra = computed(() => {
  const lines = [
    'declare function navigateTo(to: string, params?: Record<string, unknown>): void;',
    'declare function navigateBack(): void;',
    'declare function setData(prop: string, value: any): void;',
    "declare function showToast(message: string, duration?: 'short' | 'long'): void;",
  ]
  const base = props.emitEvents?.length
    ? `${lines.join('\n')}\n${buildEmitAmbientDeclarations(props.emitEvents)}`
    : `${lines.join('\n')}\n`
  return `${buildRefAmbientDeclarations(
    props.dataFields,
    props.xml,
    props.componentMap,
    props.componentMethodsMap,
  )}${base}`
})

function paramsOf(methodName: string, binding?: EventMethodBinding) {
  if (isCustom(methodName)) return []
  if (isEmit(methodName)) {
    const eventName = (binding?.args.event ?? '').trim()
    const eventDef = (props.emitEvents ?? []).find(
      (item) => item.name.trim() === eventName,
    )
    const rest = (eventDef?.params ?? [])
      .filter((item) => item.name.trim() && !item.name.trim().startsWith('...'))
      .map((item) => ({ name: item.name.trim(), type: item.type }))
    return [{ name: 'event', type: 'string' as const }, ...rest]
  }
  return (methodMap.value.get(methodName)?.params ?? []).filter(
    (item) => !item.name.trim().startsWith('...'),
  )
}

function isSetData(methodName: string) {
  return methodName === 'setData'
}

function isShowToast(methodName: string) {
  return methodName === 'showToast'
}

function isNavigateTo(methodName: string) {
  return methodName === 'navigateTo'
}

type NavigateParamRow = { key: string; value: string }

const navigateParamDrafts = reactive(new Map<string, NavigateParamRow[]>())

function parseNavigateParams(raw: string | undefined): NavigateParamRow[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
        key,
        value:
          typeof value === 'string'
            ? value
            : value == null
              ? ''
              : JSON.stringify(value),
      }))
    }
  } catch {
    // ignore
  }
  // 兼容旧写法：id={id} 或 id=1&name=x
  const text = raw.trim()
  if (!text.startsWith('{') && text.includes('=')) {
    return text
      .split(/[&,]/)
      .map((part) => {
        const i = part.indexOf('=')
        if (i < 0) return { key: part.trim(), value: '' }
        return {
          key: part.slice(0, i).trim(),
          value: part.slice(i + 1).trim(),
        }
      })
      .filter((row) => row.key)
  }
  return []
}

function serializeNavigateParams(rows: NavigateParamRow[]): string {
  const obj: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    obj[key] = row.value
  }
  return Object.keys(obj).length ? JSON.stringify(obj) : ''
}

function ensureNavigateParams(binding: EventMethodBinding): NavigateParamRow[] {
  let rows = navigateParamDrafts.get(binding.id)
  if (!rows) {
    rows = parseNavigateParams(binding.args.params)
    navigateParamDrafts.set(binding.id, rows)
  }
  return rows
}

function syncNavigateParams(binding: EventMethodBinding) {
  const rows = ensureNavigateParams(binding)
  setArg(binding, 'params', serializeNavigateParams(rows))
}

function addNavigateParam(binding: EventMethodBinding) {
  ensureNavigateParams(binding).push({ key: '', value: '' })
}

function removeNavigateParam(binding: EventMethodBinding, index: number) {
  const rows = ensureNavigateParams(binding)
  rows.splice(index, 1)
  syncNavigateParams(binding)
}

function updateNavigateParam(
  binding: EventMethodBinding,
  index: number,
  field: 'key' | 'value',
  value: string,
) {
  const rows = ensureNavigateParams(binding)
  const row = rows[index]
  if (!row) return
  row[field] = value
  syncNavigateParams(binding)
}

function onEmitEventChange(binding: EventMethodBinding) {
  const nextArgs: Record<string, string> = {
    event: binding.args.event ?? '',
  }
  for (const param of paramsOf('emit', binding)) {
    if (param.name === 'event') continue
    nextArgs[param.name] = binding.args[param.name] ?? ''
  }
  binding.args = nextArgs
}

function findField(propName: string | undefined): DataField | undefined {
  const name = propName?.trim()
  if (!name) return undefined
  return fieldOptions.value.find((item) => item.name === name)
}

function fieldType(propName: string | undefined): DataFieldType {
  return findField(propName)?.type ?? 'string'
}

function fieldTypeLabel(type: DataFieldType) {
  return typeLabelMap.value.get(type) ?? type
}

function serializeArgValue(type: DataFieldType, value: unknown): string {
  if (type === 'string' || type === 'icon' || type === 'color' || type === 'ref')
    return String(value ?? '')
  if (type === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? String(n) : '0'
  }
  if (type === 'boolean') return value ? 'true' : 'false'
  try {
    return JSON.stringify(value ?? defaultValue(type))
  } catch {
    return type === 'array' ? '[]' : '{}'
  }
}

function parseArgValue(type: DataFieldType, raw: string | undefined): unknown {
  const text = raw ?? ''
  if (type === 'string' || type === 'icon' || type === 'color' || type === 'ref')
    return text
  if (type === 'number') {
    const n = Number(text)
    return Number.isFinite(n) ? n : 0
  }
  if (type === 'boolean') return text === 'true' || text === '1'
  if (!text.trim()) return defaultValue(type)
  try {
    return JSON.parse(text)
  } catch {
    return defaultValue(type)
  }
}

function setArg(binding: EventMethodBinding, key: string, value: string) {
  binding.args = { ...binding.args, [key]: value }
}

function onPropChange(binding: EventMethodBinding) {
  const field = findField(binding.args.prop)
  const type = field?.type ?? 'string'
  const initial = field ? field.value : defaultValue(type)
  setArg(binding, 'value', serializeArgValue(type, initial))
}

function getStringValue(binding: EventMethodBinding) {
  return binding.args.value ?? ''
}

function complexPreview(binding: EventMethodBinding) {
  const type = fieldType(binding.args.prop)
  const value = parseArgValue(type, binding.args.value)
  if (type === 'json' && value && typeof value === 'object' && !Array.isArray(value)) {
    return `${Object.keys(value as object).length} 个字段`
  }
  if (type === 'array' && Array.isArray(value)) {
    return `${value.length} 项`
  }
  return type === 'array' ? '0 项' : '0 个字段'
}

function openObjectEditor(binding: EventMethodBinding) {
  const field = findField(binding.args.prop) ?? createEmptyDataField()
  const value = parseArgValue('json', binding.args.value)
  editingBindingId.value = binding.id
  editingObjectFields.value = resolveObjectFields(
    field.objectFields,
    value,
  ).map((item) => ({ ...item }))
  objectDialogVisible.value = true
}

function openArrayEditor(binding: EventMethodBinding) {
  const field = findField(binding.args.prop) ?? createEmptyDataField()
  const value = parseArgValue('array', binding.args.value)
  editingBindingId.value = binding.id
  editingArrayFields.value = resolveArrayFields(
    field.arrayFields,
    value,
  ).map((item) => ({ ...item }))
  arrayDialogVisible.value = true
}

function findEditingBinding() {
  return draft.value.find((item) => item.id === editingBindingId.value)
}

function saveObjectFields(objectFields: ObjectSubField[]) {
  const binding = findEditingBinding()
  if (!binding) return
  setArg(binding, 'value', serializeArgValue('json', buildObjectValue(objectFields)))
}

function saveArrayFields(arrayFields: ArraySubField[]) {
  const binding = findEditingBinding()
  if (!binding) return
  setArg(binding, 'value', serializeArgValue('array', buildArrayValue(arrayFields)))
}

function handleSave() {
  for (const binding of draft.value) {
    if (isNavigateTo(binding.method)) syncNavigateParams(binding)
  }
  emit('save', serializeEventBindings(draft.value))
  visible.value = false
}

function handleClear() {
  emit('save', '')
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`配置事件 · ${eventLabel}`"
    width="720px"
    destroy-on-close
    append-to-body
  >
    <p class="hint">可绑定多个方法，按列表顺序触发；可为目标方法填写参数。末尾「自定义」可直接编写方法体。</p>

    <div v-if="eventParamHints.length" class="event-params">
      <span class="event-params-label">事件形参</span>
      <div class="event-params-list">
        <code
          v-for="item in eventParamHints"
          :key="item.name"
          class="event-param-chip"
          :title="`${item.name}: ${item.type}`"
        >{{ item.sample }}<span class="event-param-type">{{ item.type }}</span></code>
      </div>
      <p class="event-params-hint">参数值中可直接写形参，例如 <code>{{ eventParamHints[0]?.sample }}</code></p>
    </div>

    <div class="bind-list">
      <div v-for="(binding, index) in draft" :key="binding.id" class="bind-card">
        <div class="bind-header">
          <el-select
            v-model="binding.method"
            filterable
            placeholder="选择方法"
            style="flex: 1"
            @change="onMethodChange(binding)"
          >
            <el-option
              v-for="method in methods"
              :key="method.name"
              :label="method.builtin ? `${method.name}（预置）` : method.name"
              :value="method.name"
            />
            <el-option
              :value="CUSTOM_EVENT_METHOD"
              label="自定义"
            />
          </el-select>
          <el-button
            type="danger"
            link
            :icon="Delete"
            @click="removeBinding(index)"
          />
        </div>

          <div v-if="isCustom(binding.method)" class="custom-body">
          <p class="arg-hint">
            编写 TypeScript 方法体；可调用 navigateTo / setData / showToast；数据池字段可按名引用。Modal 引用
            .show()/.hide()，组件引用为其「暴露方法」。
          </p>
          <TsCodeEditor
            :model-value="binding.body ?? ''"
            :function-name="customFnName"
            :params="customParams"
            return-type="void"
            :ambient-vars="customAmbientVars"
            :ambient-extra="customAmbientExtra"
            @update:model-value="binding.body = $event"
          />
        </div>

        <div v-else-if="paramsOf(binding.method, binding).length" class="args">
          <template v-if="isSetData(binding.method)">
            <div class="arg-row">
              <label>prop <span class="type">string · 数据池字段</span></label>
              <el-select
                :model-value="binding.args.prop ?? ''"
                filterable
                clearable
                placeholder="选择数据池字段"
                style="width: 100%"
                @update:model-value="
                  (v: string) => {
                    setArg(binding, 'prop', v ?? '')
                    onPropChange(binding)
                  }
                "
              >
                <el-option
                  v-for="field in fieldOptions"
                  :key="field.name"
                  :label="`${field.name}（${fieldTypeLabel(field.type)}）`"
                  :value="field.name"
                />
              </el-select>
            </div>

            <div class="arg-row">
              <label>
                value
                <span class="type">{{ fieldTypeLabel(fieldType(binding.args.prop)) }} · 支持变量</span>
              </label>

              <template v-if="fieldType(binding.args.prop) === 'json'">
                <div class="complex-value">
                  <span class="value-preview">{{ complexPreview(binding) }}</span>
                  <el-button type="primary" link @click="openObjectEditor(binding)">
                    编辑对象
                  </el-button>
                </div>
                <el-input
                  class="expr-input"
                  :model-value="getStringValue(binding)"
                  placeholder="或写变量 / 表达式，如 {scrollTop}"
                  @update:model-value="setArg(binding, 'value', $event ?? '')"
                />
              </template>
              <template v-else-if="fieldType(binding.args.prop) === 'array'">
                <div class="complex-value">
                  <span class="value-preview">{{ complexPreview(binding) }}</span>
                  <el-button type="primary" link @click="openArrayEditor(binding)">
                    编辑数组
                  </el-button>
                </div>
                <el-input
                  class="expr-input"
                  :model-value="getStringValue(binding)"
                  placeholder="或写变量 / 表达式，如 {item.list}"
                  @update:model-value="setArg(binding, 'value', $event ?? '')"
                />
              </template>
              <el-input
                v-else
                :model-value="getStringValue(binding)"
                :placeholder="
                  eventParamHints.length
                    ? `值或变量，如 ${eventParamHints[0].sample} / {item.xxx}`
                    : '值或变量，如 {item.xxx} / {index}'
                "
                @update:model-value="setArg(binding, 'value', $event ?? '')"
              />
              <p class="arg-hint">
                支持变量：
                <template v-if="eventParamHints.length">
                  <code
                    v-for="item in eventParamHints"
                    :key="item.name"
                  >{{ item.sample }}</code>
                  、
                </template>
                <code>{'{item.字段}'}</code>、<code>{'{index}'}</code>
              </p>
            </div>
          </template>

          <template v-else-if="isShowToast(binding.method)">
            <div class="arg-row">
              <label>message <span class="type">string · 提示内容</span></label>
              <el-input
                v-model="binding.args.message"
                placeholder="Toast 内容，支持 {item.xxx}"
              />
            </div>
            <div class="arg-row">
              <label>duration <span class="type">显示时长</span></label>
              <el-select
                :model-value="binding.args.duration || 'short'"
                style="width: 100%"
                @update:model-value="setArg(binding, 'duration', ($event as string) || 'short')"
              >
                <el-option label="短（默认）" value="short" />
                <el-option label="长" value="long" />
              </el-select>
            </div>
          </template>

          <template v-else-if="isNavigateTo(binding.method)">
            <div class="arg-row">
              <label>to <span class="type">string · 页面 id</span></label>
              <el-input
                v-model="binding.args.to"
                placeholder="目标页面 id"
              />
            </div>
            <div class="arg-row">
              <label>params <span class="type">object · 路由参数</span></label>
              <div class="param-kv-list">
                <div
                  v-for="(row, index) in ensureNavigateParams(binding)"
                  :key="index"
                  class="param-kv-row"
                >
                  <el-input
                    :model-value="row.key"
                    placeholder="参数名"
                    @update:model-value="
                      updateNavigateParam(binding, index, 'key', $event ?? '')
                    "
                  />
                  <el-input
                    :model-value="row.value"
                    placeholder="值，如 {id}"
                    @update:model-value="
                      updateNavigateParam(binding, index, 'value', $event ?? '')
                    "
                  />
                  <el-button
                    type="danger"
                    link
                    :icon="Delete"
                    @click="removeNavigateParam(binding, index)"
                  />
                </div>
                <el-button
                  type="primary"
                  link
                  :icon="Plus"
                  @click="addNavigateParam(binding)"
                >
                  添加参数
                </el-button>
              </div>
              <p class="arg-hint">
                值支持事件形参 / 变量：<code>{'{id}'}</code>、<code>{'{item.xxx}'}</code>
              </p>
            </div>
          </template>

          <template v-else-if="isEmit(binding.method)">
            <div class="arg-row">
              <label>event <span class="type">string · 事件名</span></label>
              <el-select
                v-if="emitEventOptions().length"
                v-model="binding.args.event"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入事件名"
                style="width: 100%"
                @change="onEmitEventChange(binding)"
              >
                <el-option
                  v-for="name in emitEventOptions()"
                  :key="name"
                  :label="name"
                  :value="name"
                />
              </el-select>
              <el-input
                v-else
                v-model="binding.args.event"
                placeholder="如 onClick"
                @change="onEmitEventChange(binding)"
              />
            </div>
            <div
              v-for="param in paramsOf('emit', binding).filter((p) => p.name !== 'event')"
              :key="param.name"
              class="arg-row"
            >
              <label>{{ param.name }} <span class="type">{{ param.type }}</span></label>
              <el-input
                v-model="binding.args[param.name]"
                :placeholder="`参数 ${param.name}，支持 {item.xxx}`"
              />
            </div>
            <p class="arg-hint">向父页面抛出：emit(event, ...参数)</p>
          </template>

          <template v-else>
            <div
              v-for="param in paramsOf(binding.method, binding)"
              :key="param.name"
              class="arg-row"
            >
              <label>{{ param.name }} <span class="type">{{ param.type }}</span></label>
              <el-input
                v-model="binding.args[param.name]"
                :placeholder="`参数 ${param.name}，支持 {item.xxx}`"
              />
            </div>
          </template>
        </div>
        <div v-else class="no-args">无参数</div>
      </div>
    </div>

    <el-button type="primary" link :icon="Plus" @click="addBinding">添加绑定</el-button>

    <template #footer>
      <el-button @click="handleClear">清除</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>

  <ObjectFieldsDialog
    v-model="objectDialogVisible"
    :fields="editingObjectFields"
    :icon-options="iconOptions"
    @save="saveObjectFields"
  />
  <ArrayFieldsDialog
    v-model="arrayDialogVisible"
    :fields="editingArrayFields"
    :icon-options="iconOptions"
    @save="saveArrayFields"
  />
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #909399;
}

.event-params {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #f8fafc;
}

.event-params-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.event-params-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.event-param-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef2ff;
  color: #3730a3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.event-param-type {
  color: #64748b;
  font-weight: 400;
}

.event-params-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #94a3b8;
}

.event-params-hint code {
  font-size: 12px;
  color: #64748b;
}

.expr-input {
  margin-top: 8px;
}

.bind-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 8px;
}

.bind-card {
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.bind-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.custom-body {
  margin-top: 10px;
}

.args {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.arg-row label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  color: #606266;
}

.arg-row .type {
  color: #909399;
}

.arg-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #94a3b8;
}

.arg-hint code {
  font-size: 12px;
  color: #64748b;
}

.complex-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
}

.param-kv-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-kv-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto;
  gap: 8px;
  align-items: center;
}

.value-preview {
  font-size: 13px;
  color: #909399;
}

.no-args {
  margin-top: 8px;
  font-size: 12px;
  color: #c0c4cc;
}
</style>
