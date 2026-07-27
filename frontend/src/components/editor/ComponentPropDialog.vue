<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  defaultValue,
  type DataFieldType,
  type DataFieldValue,
} from '../../types/page-data'
import {
  createEmptyComponentProp,
  type ComponentPropDef,
} from '../../types/component'
import { normalizePropDefaultValue } from '../../utils/component-props'
import {
  normalizeApiParams,
  normalizeApiReturnType,
} from '../../utils/api-prop'
import {
  createEmptyProcessorTypeExpr,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import {
  dataFieldToMethodParamType,
  methodParamToDataFieldType,
  type MethodParam,
} from '../../types/page-method'
import type { DataTypeLibrary } from '../../types/data-types'
import IconValueSelect from './IconValueSelect.vue'
import ColorPicker from './ColorPicker.vue'
import DataFieldTypeTreeSelect from './DataFieldTypeTreeSelect.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'

const props = defineProps<{
  modelValue: boolean
  prop: ComponentPropDef | null
  /** 已有参数名（不含当前），用于重名校验 */
  existingNames?: string[]
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [prop: ComponentPropDef]
}>()

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

const draft = reactive<ComponentPropDef>({
  ...createEmptyComponentProp(),
  apiParams: [],
  apiReturnType: createEmptyProcessorTypeExpr('any'),
})
const jsonDefaultText = reactive({ value: '' })

const genericVisible = ref(false)
const genericTarget = ref<'param' | 'return'>('return')
const genericParamIndex = ref(-1)
const genericNames = ref<string[]>([])
const genericTypeName = ref('')
const genericArgs = ref<Record<string, string>>({})

const isEdit = computed(() => Boolean(props.prop?.name?.trim()))
const title = computed(() => (isEdit.value ? '编辑参数' : '添加参数'))
const isApiType = computed(() => draft.type === 'api')

const namedTypeOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      if (!t.name.trim()) continue
      opts.push({ id: t.id, label: `${group.name} / ${t.name}` })
    }
  }
  return opts
})

function typeDefById(id: string) {
  if (!id) return null
  for (const group of props.typeLibrary?.groups ?? []) {
    const hit = group.types.find((t) => t.id === id)
    if (hit) return hit
  }
  return null
}

function genericNamesOf(typeRef: string): string[] {
  return (typeDefById(typeRef)?.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
}

function leafNamedRef(expr: ProcessorTypeExpr | null | undefined): string {
  if (!expr) return ''
  if (expr.type === 'array') {
    if (expr.itemType === 'array') return expr.itemItemTypeRef || ''
    return expr.itemTypeRef || ''
  }
  return expr.typeRef || ''
}

function formatTypeWithGenerics(
  typeRef: string,
  args: Record<string, string>,
): string {
  const def = typeDefById(typeRef)
  if (!def?.name) return typeRef || '—'
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

function formatTypeExpr(expr: ProcessorTypeExpr | null | undefined): string {
  if (!expr) return 'any'
  const named = leafNamedRef(expr)
  if (named) return formatTypeWithGenerics(named, expr.genericArgs ?? {})
  if (expr.type === 'array') return `${expr.itemType || 'any'}[]`
  return expr.type || 'any'
}

function payloadToTypeExpr(
  payload: {
    type: DataFieldType | 'void' | 'generic'
    typeRef?: string
    itemType?: DataFieldType | 'generic'
    itemTypeRef?: string
    itemItemType?: DataFieldType | 'generic'
    itemItemTypeRef?: string
  },
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
    genericArgs: {},
  }
  const named = leafNamedRef(next)
  const prevNamed = prev ? leafNamedRef(prev) : ''
  if (named && named === prevNamed) {
    next.genericArgs = { ...(prev?.genericArgs ?? {}) }
  } else {
    for (const n of genericNamesOf(named)) next.genericArgs[n] = ''
  }
  return next
}

function paramNamedRef(param: MethodParam): string {
  if (param.typeExpr) return leafNamedRef(param.typeExpr)
  if (param.type === 'array') {
    if (param.itemType === 'array') return param.itemItemTypeRef || ''
    return param.itemTypeRef || ''
  }
  return param.typeRef || ''
}

const defaultEditor = computed(() => {
  if (isApiType.value) return 'none'
  const type = String(draft.type ?? '')
  if (type === 'string') return 'string'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'icon') return 'icon'
  if (type === 'color') return 'color'
  if (type === 'array') return 'array'
  if (type === 'json') return 'json'
  return 'json'
})

const colorDefault = computed({
  get: () => {
    const value = draft.defaultValue
    return value == null || typeof value === 'object' ? '' : String(value)
  },
  set(value: string) {
    draft.defaultValue = value
  },
})

function formatDefaultForJson(value: DataFieldValue): string {
  try {
    return JSON.stringify(value ?? defaultValue('json'), null, 2)
  } catch {
    return '{}'
  }
}

function syncDraft(source: ComponentPropDef | null) {
  const next = source ? { ...source } : createEmptyComponentProp()
  draft.name = next.name
  draft.type = next.type
  draft.typeRef = next.typeRef
  draft.itemType = next.itemType
  draft.itemTypeRef = next.itemTypeRef
  draft.itemItemType = next.itemItemType
  draft.itemItemTypeRef = next.itemItemTypeRef
  draft.remark = next.remark
  draft.defaultValue = next.defaultValue
  draft.twoWay = next.type === 'api' ? false : next.twoWay
  draft.required = Boolean(next.required)
  draft.apiParams = normalizeApiParams(next.apiParams)
  draft.apiReturnType = normalizeApiReturnType(next.apiReturnType)
  if (draft.type === 'json' || draft.type === 'array') {
    jsonDefaultText.value = formatDefaultForJson(draft.defaultValue)
  } else {
    jsonDefaultText.value = ''
  }
  if (draft.type === 'color' && typeof draft.defaultValue === 'object') {
    draft.defaultValue = ''
  }
  if (draft.type === 'api') {
    draft.defaultValue = ''
    if (!draft.apiParams) draft.apiParams = []
  }
}

watch(
  () => [props.modelValue, props.prop] as const,
  ([open]) => {
    if (!open) return
    syncDraft(props.prop)
  },
)

function onTypeChange(payload: {
  type: DataFieldType | 'void'
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}) {
  if (payload.type === 'void') return
  draft.type = payload.type
  draft.typeRef = payload.typeRef
  draft.itemType = payload.type === 'array' ? payload.itemType || 'string' : undefined
  draft.itemTypeRef = payload.type === 'array' ? payload.itemTypeRef : undefined
  draft.itemItemType =
    payload.type === 'array' && payload.itemType === 'array'
      ? payload.itemItemType || 'string'
      : undefined
  draft.itemItemTypeRef =
    payload.type === 'array' && payload.itemType === 'array'
      ? payload.itemItemTypeRef
      : undefined
  draft.defaultValue = payload.type === 'api' ? '' : defaultValue(payload.type)
  if (payload.type === 'api') {
    draft.twoWay = false
    if (!draft.apiParams?.length) draft.apiParams = []
    if (!draft.apiReturnType) {
      draft.apiReturnType = createEmptyProcessorTypeExpr('any')
    }
  }
  if (payload.type === 'json' || payload.type === 'array') {
    jsonDefaultText.value = formatDefaultForJson(draft.defaultValue)
  } else {
    jsonDefaultText.value = ''
  }
}

function addApiParam() {
  if (!draft.apiParams) draft.apiParams = []
  draft.apiParams.push({
    name: '',
    type: 'any',
    typeExpr: createEmptyProcessorTypeExpr('any'),
  })
}

function removeApiParam(index: number) {
  draft.apiParams?.splice(index, 1)
}

function onApiParamTypeChange(
  param: MethodParam,
  payload: {
    type: DataFieldType | 'void' | 'generic'
    typeRef?: string
    itemType?: DataFieldType | 'generic'
    itemTypeRef?: string
    itemItemType?: DataFieldType | 'generic'
    itemItemTypeRef?: string
  },
) {
  const fieldType =
    payload.type === 'void' || payload.type === 'generic' ? 'any' : payload.type
  param.type = dataFieldToMethodParamType(fieldType)
  param.typeRef = payload.typeRef
  param.itemType =
    fieldType === 'array'
      ? payload.itemType === 'generic'
        ? 'any'
        : payload.itemType || 'string'
      : undefined
  param.itemTypeRef = fieldType === 'array' ? payload.itemTypeRef : undefined
  param.itemItemType =
    fieldType === 'array' && payload.itemType === 'array'
      ? payload.itemItemType === 'generic'
        ? 'any'
        : payload.itemItemType || 'string'
      : undefined
  param.itemItemTypeRef =
    fieldType === 'array' && payload.itemType === 'array'
      ? payload.itemItemTypeRef
      : undefined
  const next = payloadToTypeExpr(payload, param.typeExpr)
  param.typeExpr = next
  if (genericNamesOf(leafNamedRef(next)).length) {
    const idx = draft.apiParams?.indexOf(param) ?? -1
    if (idx >= 0) openParamGenerics(idx, next)
  }
}

function onApiReturnTypeChange(payload: {
  type: DataFieldType | 'void'
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}) {
  const next = payloadToTypeExpr(payload, draft.apiReturnType)
  draft.apiReturnType = next
  if (genericNamesOf(leafNamedRef(next)).length) {
    openReturnGenerics(next)
  }
}

function ensureParamTypeExpr(param: MethodParam): ProcessorTypeExpr {
  if (param.typeExpr) return param.typeExpr
  const expr: ProcessorTypeExpr = {
    ...createEmptyProcessorTypeExpr(methodParamToDataFieldType(param.type)),
    type: methodParamToDataFieldType(param.type),
    typeRef: param.typeRef ?? '',
    itemType: param.itemType ?? '',
    itemTypeRef: param.itemTypeRef ?? '',
    itemItemType: param.itemItemType ?? '',
    itemItemTypeRef: param.itemItemTypeRef ?? '',
    genericArgs: {},
  }
  param.typeExpr = expr
  return expr
}

function openParamGenerics(index: number, expr?: ProcessorTypeExpr) {
  const param = draft.apiParams?.[index]
  if (!param) return
  const typeExpr = expr ?? ensureParamTypeExpr(param)
  const named = leafNamedRef(typeExpr)
  const names = genericNamesOf(named)
  if (!names.length) return
  genericTarget.value = 'param'
  genericParamIndex.value = index
  genericNames.value = names
  genericTypeName.value = typeDefById(named)?.name ?? ''
  genericArgs.value = { ...(typeExpr.genericArgs ?? {}) }
  genericVisible.value = true
}

function openReturnGenerics(expr?: ProcessorTypeExpr) {
  const output = expr ?? draft.apiReturnType ?? createEmptyProcessorTypeExpr('any')
  const named = leafNamedRef(output)
  const names = genericNamesOf(named)
  if (!names.length) return
  genericTarget.value = 'return'
  genericParamIndex.value = -1
  genericNames.value = names
  genericTypeName.value = typeDefById(named)?.name ?? ''
  genericArgs.value = { ...(output.genericArgs ?? {}) }
  genericVisible.value = true
}

function handleGenericSave(args: Record<string, string>) {
  if (genericTarget.value === 'return') {
    draft.apiReturnType = {
      ...(draft.apiReturnType ?? createEmptyProcessorTypeExpr('any')),
      genericArgs: { ...args },
    }
  } else {
    const param = draft.apiParams?.[genericParamIndex.value]
    if (param) {
      const expr = ensureParamTypeExpr(param)
      param.typeExpr = { ...expr, genericArgs: { ...args } }
    }
  }
  genericVisible.value = false
}

function parseComplexDefault(): DataFieldValue | null {
  const raw = jsonDefaultText.value.trim()
  if (!raw) return defaultValue(draft.type)
  try {
    const parsed = JSON.parse(raw) as unknown
    if (draft.type === 'array' && !Array.isArray(parsed)) {
      ElMessage.error('默认值需为 JSON 数组')
      return null
    }
    if (
      draft.type === 'json' &&
      (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    ) {
      ElMessage.error('默认值需为 JSON 对象')
      return null
    }
    return parsed as DataFieldValue
  } catch {
    ElMessage.error('默认值 JSON 格式不正确')
    return null
  }
}

function handleSave() {
  const name = draft.name.trim()
  if (!name) {
    ElMessage.error('请填写参数名')
    return
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    ElMessage.error('参数名需以字母或下划线开头，仅含字母、数字、下划线')
    return
  }
  const others = (props.existingNames ?? []).map((item) => item.trim()).filter(Boolean)
  if (others.includes(name)) {
    ElMessage.error(`参数名重复：${name}`)
    return
  }

  let defaultVal = draft.defaultValue
  if (draft.type === 'api') {
    defaultVal = ''
  } else if (draft.type === 'json' || draft.type === 'array') {
    const parsed = parseComplexDefault()
    if (parsed === null) return
    defaultVal = parsed
  } else {
    defaultVal = normalizePropDefaultValue(draft.type, defaultVal)
  }

  const apiParams =
    draft.type === 'api' ? normalizeApiParams(draft.apiParams) : undefined
  const apiReturnType =
    draft.type === 'api' ? normalizeApiReturnType(draft.apiReturnType) : undefined
  if (draft.type === 'api') {
    for (const p of apiParams ?? []) {
      if (!p.name.trim()) {
        ElMessage.error('请填写完整的 API 形参名')
        return
      }
    }
  }

  emit('save', {
    name,
    type: draft.type,
    typeRef: draft.typeRef,
    itemType: draft.itemType,
    itemTypeRef: draft.itemTypeRef,
    itemItemType: draft.itemItemType,
    itemItemTypeRef: draft.itemItemTypeRef,
    remark: draft.remark.trim(),
    defaultValue: defaultVal,
    twoWay: draft.type === 'api' ? false : Boolean(draft.twoWay),
    required: Boolean(draft.required),
    ...(draft.type === 'api'
      ? { apiParams: apiParams ?? [], apiReturnType }
      : {}),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="isApiType ? '720px' : '520px'"
    destroy-on-close
    append-to-body
  >
    <el-form label-position="top" size="default">
      <el-form-item label="参数名" required>
        <el-input v-model="draft.name" placeholder="例如：fetchApi" />
      </el-form-item>

      <el-form-item label="数据类型" required>
        <DataFieldTypeTreeSelect
          :type="draft.type"
          :type-ref="draft.typeRef"
          :item-type="draft.itemType"
          :item-type-ref="draft.itemTypeRef"
          :item-item-type="draft.itemItemType"
          :item-item-type-ref="draft.itemItemTypeRef"
          :library="typeLibrary"
          composable
          @change="onTypeChange"
        />
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="draft.remark" placeholder="备注（可选）" />
      </el-form-item>

      <template v-if="isApiType">
        <el-form-item label="API 形参">
          <div class="api-params">
            <div
              v-for="(param, index) in draft.apiParams"
              :key="index"
              class="api-param-row"
            >
              <el-input
                v-model="param.name"
                placeholder="形参名"
                style="width: 140px"
              />
              <DataFieldTypeTreeSelect
                :type="methodParamToDataFieldType(param.type)"
                :type-ref="param.typeRef"
                :item-type="param.itemType"
                :item-type-ref="param.itemTypeRef"
                :item-item-type="param.itemItemType"
                :item-item-type-ref="param.itemItemTypeRef"
                :library="typeLibrary"
                composable
                :exclude-types="['api', 'icon', 'color', 'ref']"
                @change="onApiParamTypeChange(param, $event)"
              />
              <el-button
                v-if="genericNamesOf(paramNamedRef(param)).length"
                type="primary"
                link
                @click="openParamGenerics(index)"
              >
                泛型
              </el-button>
              <el-button type="danger" link @click="removeApiParam(index)">
                删除
              </el-button>
            </div>
            <el-button type="primary" link @click="addApiParam">+ 添加形参</el-button>
          </div>
          <p class="hint">
            组件内调用
            <code>$props.{{ draft.name || 'fetchApi' }}(args)</code>
            时传入这些字段。匹配规则：API 必填入参必须出现且类型一致；可选入参可省略。
          </p>
        </el-form-item>

        <el-form-item label="出参类型">
          <div class="api-return-row">
            <DataFieldTypeTreeSelect
              :type="(draft.apiReturnType?.type || 'any') as DataFieldType"
              :type-ref="draft.apiReturnType?.typeRef"
              :item-type="(draft.apiReturnType?.itemType || undefined) as DataFieldType | undefined"
              :item-type-ref="draft.apiReturnType?.itemTypeRef"
              :item-item-type="(draft.apiReturnType?.itemItemType || undefined) as DataFieldType | undefined"
              :item-item-type-ref="draft.apiReturnType?.itemItemTypeRef"
              :library="typeLibrary"
              composable
              :exclude-types="['api', 'icon', 'color', 'ref']"
              @change="onApiReturnTypeChange"
            />
            <el-button
              v-if="genericNamesOf(leafNamedRef(draft.apiReturnType)).length"
              type="primary"
              link
              @click="openReturnGenerics()"
            >
              泛型
            </el-button>
          </div>
          <p
            v-if="genericNamesOf(leafNamedRef(draft.apiReturnType)).length"
            class="generic-preview"
          >
            {{ formatTypeExpr(draft.apiReturnType) }}
          </p>
          <p class="hint">
            此处配置的是 resolve 类型
            <code>T</code>；组件内调用返回
            <code>Promise&lt;T&gt;</code>，例如
            <code>await $props.{{ draft.name || 'fetchApi' }}(args)</code>。
            父级绑定的控制器 API 出参须与 <code>T</code> 一致。
          </p>
        </el-form-item>
      </template>

      <el-form-item v-else label="默认值">
        <el-input
          v-if="defaultEditor === 'string'"
          :model-value="String(draft.defaultValue ?? '')"
          placeholder="默认值"
          @update:model-value="draft.defaultValue = $event"
        />
        <el-input-number
          v-else-if="defaultEditor === 'number'"
          :model-value="Number(draft.defaultValue ?? 0)"
          controls-position="right"
          style="width: 100%"
          @update:model-value="draft.defaultValue = Number($event ?? 0)"
        />
        <el-switch
          v-else-if="defaultEditor === 'boolean'"
          :model-value="draft.defaultValue === true || draft.defaultValue === 'true'"
          @update:model-value="draft.defaultValue = $event"
        />
        <IconValueSelect
          v-else-if="defaultEditor === 'icon'"
          :model-value="String(draft.defaultValue ?? '')"
          :options="iconOptions"
          @update:model-value="draft.defaultValue = $event"
        />
        <ColorPicker
          v-else-if="defaultEditor === 'color'"
          :key="'color-default'"
          v-model="colorDefault"
          placeholder="#409eff / rgba(...)"
        />
        <el-input
          v-else
          v-model="jsonDefaultText.value"
          type="textarea"
          :rows="5"
          :placeholder="
            defaultEditor === 'array' ? 'JSON 数组，例如 []' : 'JSON 对象，例如 {}'
          "
        />
      </el-form-item>

      <div class="switch-row">
        <el-form-item label="必填">
          <el-switch v-model="draft.required" />
        </el-form-item>
        <el-form-item v-if="!isApiType" label="双向绑定（model）">
          <el-switch v-model="draft.twoWay" />
        </el-form-item>
      </div>
      <p class="hint">
        <template v-if="isApiType">
          后端 API 由父页面绑定具体控制器方法；组件内当作异步函数调用，返回
          <code>Promise&lt;出参类型&gt;</code>。
        </template>
        <template v-else>
          关闭「双向绑定」为 Props；开启后为 model。模板中用
          <code>{$props.字段名}</code> 读取。
        </template>
      </p>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>

  <TypeGenericArgsDialog
    v-model="genericVisible"
    :type-name="genericTypeName"
    :generic-names="genericNames"
    :args="genericArgs"
    :type-options="namedTypeOptions"
    @save="handleGenericSave"
  />
</template>

<style scoped>
.switch-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.api-params {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.api-param-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.api-param-row :deep(.el-select),
.api-param-row :deep(.el-cascader) {
  flex: 1;
  min-width: 0;
}

.api-return-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.api-return-row :deep(.el-cascader) {
  flex: 1;
  min-width: 0;
}

.generic-preview {
  margin: 6px 0 0;
  font-size: 12px;
  color: #64748b;
}

.hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #94a3b8;
}

.hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  background: #f2f3f5;
}
</style>
