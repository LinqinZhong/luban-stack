<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import {
  parseEventBindings,
  serializeEventBindings,
  type EventMethodBinding,
  type PageMethod,
} from '../../types/page-method'
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
import IconValueSelect from './IconValueSelect.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'

const props = defineProps<{
  modelValue: boolean
  eventLabel: string
  rawValue: string
  methods: PageMethod[]
  dataFields?: DataField[]
  iconOptions?: Array<{ id: string; label: string }>
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
    if (!open) return
    const list = parseEventBindings(props.rawValue)
    draft.value = list.length
      ? list.map((item) => ({
          ...item,
          args: { ...item.args },
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
  })
}

function removeBinding(index: number) {
  draft.value.splice(index, 1)
}

function onMethodChange(binding: EventMethodBinding) {
  const method = methodMap.value.get(binding.method)
  const nextArgs: Record<string, string> = {}
  for (const param of method?.params ?? []) {
    nextArgs[param.name] = binding.args[param.name] ?? ''
  }
  binding.args = nextArgs
}

function paramsOf(methodName: string) {
  return methodMap.value.get(methodName)?.params ?? []
}

function isSetData(methodName: string) {
  return methodName === 'setData'
}

function findField(propName: string | undefined): DataField | undefined {
  const name = propName?.trim()
  if (!name) return undefined
  return fieldOptions.value.find((item) => item.name === name)
}

function fieldType(propName: string | undefined): DataFieldType {
  return findField(propName)?.type ?? 'string'
}

function isTemplateExpr(value: string | undefined): boolean {
  return /\{[^{}]+\}/.test(value ?? '')
}

/** 含 {item.xxx}/{index} 时用文本编辑，便于写变量 */
function useValueExpression(binding: EventMethodBinding): boolean {
  return isTemplateExpr(binding.args.value)
}

function fieldTypeLabel(type: DataFieldType) {
  return typeLabelMap.value.get(type) ?? type
}

function serializeArgValue(type: DataFieldType, value: unknown): string {
  if (type === 'string' || type === 'icon') return String(value ?? '')
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
  if (type === 'string' || type === 'icon') return text
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

function getNumberValue(binding: EventMethodBinding) {
  return Number(parseArgValue('number', binding.args.value) as number)
}

function getBooleanValue(binding: EventMethodBinding) {
  return Boolean(parseArgValue('boolean', binding.args.value))
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
    width="640px"
    destroy-on-close
    append-to-body
  >
    <p class="hint">可绑定多个方法，按列表顺序触发；可为目标方法填写参数。</p>

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
          </el-select>
          <el-button
            type="danger"
            link
            :icon="Delete"
            @click="removeBinding(index)"
          />
        </div>

        <div v-if="paramsOf(binding.method).length" class="args">
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
                <span class="type">{{ fieldTypeLabel(fieldType(binding.args.prop)) }}</span>
              </label>

              <el-input
                v-if="
                  useValueExpression(binding) ||
                  fieldType(binding.args.prop) === 'string'
                "
                :model-value="getStringValue(binding)"
                placeholder="值，或变量如 {item.key}"
                @update:model-value="setArg(binding, 'value', $event ?? '')"
              />
              <el-input-number
                v-else-if="fieldType(binding.args.prop) === 'number'"
                :model-value="getNumberValue(binding)"
                controls-position="right"
                style="width: 100%"
                @update:model-value="
                  setArg(
                    binding,
                    'value',
                    serializeArgValue('number', Number($event ?? 0)),
                  )
                "
              />
              <el-switch
                v-else-if="fieldType(binding.args.prop) === 'boolean'"
                :model-value="getBooleanValue(binding)"
                @update:model-value="
                  setArg(binding, 'value', serializeArgValue('boolean', $event))
                "
              />
              <IconValueSelect
                v-else-if="fieldType(binding.args.prop) === 'icon'"
                :model-value="getStringValue(binding)"
                :options="iconOptions"
                allow-create
                @update:model-value="setArg(binding, 'value', $event ?? '')"
              />
              <div
                v-else-if="fieldType(binding.args.prop) === 'json'"
                class="complex-value"
              >
                <span class="value-preview">{{ complexPreview(binding) }}</span>
                <el-button type="primary" link @click="openObjectEditor(binding)">
                  编辑
                </el-button>
              </div>
              <div v-else class="complex-value">
                <span class="value-preview">{{ complexPreview(binding) }}</span>
                <el-button type="primary" link @click="openArrayEditor(binding)">
                  编辑
                </el-button>
              </div>
              <p class="arg-hint">支持变量：<code>{'{item.字段}'}</code>、<code>{'{index}'}</code></p>
            </div>
          </template>

          <template v-else>
            <div
              v-for="param in paramsOf(binding.method)"
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
