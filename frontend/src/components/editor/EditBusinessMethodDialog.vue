<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  createEmptyProcessorMethodParam,
  createEmptyProcessorTypeExpr,
  PROCESSOR_METHOD_SCOPE_OPTIONS,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorMethodScope,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import { typeLabel, type DataFieldType } from '../../types/page-data'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = ['color', 'ref', 'icon', 'resource']

export type BusinessMethodEditPayload = {
  name: string
  remark: string
  scope: ProcessorMethodScope
  params: ProcessorMethodParam[]
  output: ProcessorTypeExpr
}

const props = defineProps<{
  modelValue: boolean
  method: ProcessorMethod | null
  typeLibrary: DataTypeLibrary | null
  typeOptions: Array<{ id: string; label: string }>
  reservedNames?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: BusinessMethodEditPayload]
}>()

const draftName = ref('')
const draftRemark = ref('')
const draftScope = ref<ProcessorMethodScope>('public')
const draftParams = ref<ProcessorMethodParam[]>([])
const draftOutput = ref<ProcessorTypeExpr>(createEmptyProcessorTypeExpr())

const genericVisible = ref(false)
const genericTarget = ref<'param' | 'output'>('output')
const genericParamIndex = ref(-1)
const genericNames = ref<string[]>([])
const genericTypeName = ref('')
const genericArgs = ref<Record<string, string>>({})

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const title = computed(() => {
  const name = props.method?.name?.trim()
  return name ? `设计方法 · ${name}` : '设计方法'
})

const outputHasGenerics = computed(
  () => genericNamesOf(leafNamedRef(draftOutput.value)).length > 0,
)

const outputTypePreview = computed(() => formatTypeExpr(draftOutput.value))

watch(
  () => [props.modelValue, props.method] as const,
  ([open, method]) => {
    if (!open || !method) return
    draftName.value = method.name ?? ''
    draftRemark.value = method.remark ?? ''
    draftScope.value = method.scope === 'private' ? 'private' : 'public'
    draftParams.value = (method.params ?? []).map((p) => ({
      ...p,
      typeExpr: {
        ...p.typeExpr,
        genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
      },
    }))
    draftOutput.value = {
      ...method.output,
      genericArgs: { ...(method.output.genericArgs ?? {}) },
    }
  },
)

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

function leafNamedRef(expr: ProcessorTypeExpr): string {
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

function addParam() {
  draftParams.value = [
    ...draftParams.value,
    createEmptyProcessorMethodParam(`arg${draftParams.value.length + 1}`),
  ]
}

function updateParam(index: number, patch: Partial<ProcessorMethodParam>) {
  draftParams.value = draftParams.value.map((p, i) =>
    i === index ? { ...p, ...patch } : p,
  )
}

function removeParam(index: number) {
  draftParams.value = draftParams.value.filter((_, i) => i !== index)
}

function handleParamTypeChange(index: number, payload: TypeSelectPayload) {
  const prev = draftParams.value[index]?.typeExpr
  const next = payloadToTypeExpr(payload, prev)
  updateParam(index, { typeExpr: next })
  if (genericNamesOf(leafNamedRef(next)).length) {
    openParamGenerics(index, next)
  }
}

function openParamGenerics(index: number, expr?: ProcessorTypeExpr) {
  const row = draftParams.value[index]
  const typeExpr = expr ?? row?.typeExpr
  if (!typeExpr) return
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

function handleOutputChange(payload: TypeSelectPayload) {
  const next = payloadToTypeExpr(payload, draftOutput.value)
  draftOutput.value = next
  if (genericNamesOf(leafNamedRef(next)).length) {
    openOutputGenerics(next)
  }
}

function openOutputGenerics(expr?: ProcessorTypeExpr) {
  const output = expr ?? draftOutput.value
  const named = leafNamedRef(output)
  const names = genericNamesOf(named)
  if (!names.length) return
  genericTarget.value = 'output'
  genericParamIndex.value = -1
  genericNames.value = names
  genericTypeName.value = typeDefById(named)?.name ?? ''
  genericArgs.value = { ...(output.genericArgs ?? {}) }
  genericVisible.value = true
}

function saveGenerics(args: Record<string, string>) {
  if (genericTarget.value === 'output') {
    draftOutput.value = { ...draftOutput.value, genericArgs: args }
  } else if (genericParamIndex.value >= 0) {
    const row = draftParams.value[genericParamIndex.value]
    if (row) {
      updateParam(genericParamIndex.value, {
        typeExpr: { ...row.typeExpr, genericArgs: args },
      })
    }
  }
  genericParamIndex.value = -1
}

function handleSave() {
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
    ElMessage.warning(`方法名「${name}」已存在`)
    return
  }
  emit('save', {
    name,
    remark: draftRemark.value.trim(),
    scope: draftScope.value,
    params: draftParams.value.map((p) => ({
      ...p,
      name: p.name.trim(),
      remark: p.remark.trim(),
      typeExpr: {
        ...p.typeExpr,
        genericArgs: p.typeExpr.genericArgs ?? {},
      },
    })),
    output: {
      ...draftOutput.value,
      genericArgs: draftOutput.value.genericArgs ?? {},
    },
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="720px"
    destroy-on-close
    append-to-body
    class="business-method-dialog"
  >
    <el-form
      class="method-form"
      label-position="right"
      label-width="64px"
      @submit.prevent
    >
      <el-form-item label="名称" required>
        <el-input
          v-model="draftName"
          placeholder="方法名，如 list"
          maxlength="64"
        />
      </el-form-item>

      <el-form-item label="说明">
        <el-input
          v-model="draftRemark"
          placeholder="可选说明"
          maxlength="200"
        />
      </el-form-item>

      <el-form-item label="作用域" required>
        <el-radio-group v-model="draftScope">
          <el-radio
            v-for="opt in PROCESSOR_METHOD_SCOPE_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="出参" required>
        <DataFieldTypeTreeSelect
          class="type-select"
          :type="(draftOutput.type || 'string') as DataFieldType"
          :type-ref="draftOutput.typeRef"
          :item-type="
            (draftOutput.itemType || undefined) as DataFieldType | undefined
          "
          :item-type-ref="draftOutput.itemTypeRef"
          :item-item-type="
            (draftOutput.itemItemType || undefined) as DataFieldType | undefined
          "
          :item-item-type-ref="draftOutput.itemItemTypeRef"
          :library="typeLibrary"
          :exclude-types="PROCESSOR_EXCLUDE_TYPES"
          :allow-ref="false"
          clearable
          placeholder="选择出参类型"
          @change="handleOutputChange"
        />
      </el-form-item>

      <el-form-item v-if="outputHasGenerics" label="泛型">
        <div class="generic-row">
          <el-button type="primary" link @click="openOutputGenerics()">
            配置泛型
          </el-button>
          <code class="type-preview" :title="outputTypePreview">{{
            outputTypePreview
          }}</code>
        </div>
      </el-form-item>

      <el-form-item label="入参" class="params-item">
        <div class="params-block">
          <div class="params-toolbar">
            <el-button type="primary" link :icon="Plus" @click="addParam">
              添加
            </el-button>
          </div>
          <el-table
            :data="draftParams"
            border
            stripe
            empty-text="暂无入参，点击添加"
            size="small"
          >
            <el-table-column label="名称" min-width="110">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.name"
                  placeholder="参数名"
                  size="small"
                  @update:model-value="
                    updateParam($index, { name: String($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="220">
              <template #default="{ row, $index }">
                <div class="type-cell">
                  <DataFieldTypeTreeSelect
                    class="type-select"
                    :type="(row.typeExpr.type || 'string') as DataFieldType"
                    :type-ref="row.typeExpr.typeRef"
                    :item-type="
                      (row.typeExpr.itemType || undefined) as
                        | DataFieldType
                        | undefined
                    "
                    :item-type-ref="row.typeExpr.itemTypeRef"
                    :item-item-type="
                      (row.typeExpr.itemItemType || undefined) as
                        | DataFieldType
                        | undefined
                    "
                    :item-item-type-ref="row.typeExpr.itemItemTypeRef"
                    :library="typeLibrary"
                    :exclude-types="PROCESSOR_EXCLUDE_TYPES"
                    :allow-ref="false"
                    clearable
                    size="small"
                    placeholder="选择类型"
                    @change="handleParamTypeChange($index, $event)"
                  />
                  <el-button
                    v-if="genericNamesOf(leafNamedRef(row.typeExpr)).length"
                    type="primary"
                    link
                    size="small"
                    @click="openParamGenerics($index)"
                  >
                    泛型
                  </el-button>
                </div>
                <div
                  v-if="genericNamesOf(leafNamedRef(row.typeExpr)).length"
                  class="param-generic-preview"
                  :title="formatTypeExpr(row.typeExpr)"
                >
                  {{ formatTypeExpr(row.typeExpr) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="100">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.remark"
                  placeholder="可选"
                  size="small"
                  @update:model-value="
                    updateParam($index, { remark: String($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="72" align="center">
              <template #default="{ $index }">
                <el-button
                  type="danger"
                  link
                  size="small"
                  @click="removeParam($index)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>
  </el-dialog>

  <TypeGenericArgsDialog
    v-model="genericVisible"
    :type-name="genericTypeName"
    :generic-names="genericNames"
    :args="genericArgs"
    :type-options="typeOptions"
    @save="saveGenerics"
  />
</template>

<style scoped>
.method-form :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}

.method-form :deep(.el-form-item) {
  margin-bottom: 16px;
}

.method-form :deep(.params-item) {
  margin-bottom: 0;
}

.method-form :deep(.params-item .el-form-item__content) {
  display: block;
}

.type-select {
  width: 100%;
}

.generic-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.type-preview {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 22px;
  color: #606266;
  word-break: break-all;
  white-space: normal;
}

.params-block {
  width: 100%;
}

.params-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.type-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.param-generic-preview {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  word-break: break-all;
  line-height: 1.4;
}
</style>
