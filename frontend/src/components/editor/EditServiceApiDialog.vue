<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  createEmptyProcessorTypeExpr,
  createEmptyServiceApiParam,
  HTTP_METHOD_OPTIONS,
  normalizeProcessorTypeExpr,
  SERVICE_API_PARAM_LOCATION_OPTIONS,
  type HttpMethod,
  type ProcessorTypeExpr,
  type ServiceApi,
  type ServiceApiParam,
  type ServiceApiParamLocation,
} from '../../types/backend-services'
import type { DataFieldType } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import DataFieldTypeTreeSelect from './DataFieldTypeTreeSelect.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'

export type ServiceApiEditPayload = {
  name: string
  path: string
  remark: string
  method: HttpMethod
  inputs: ServiceApiParam[]
  output: ProcessorTypeExpr
  requireAuth: boolean
}

const props = defineProps<{
  modelValue: boolean
  api: ServiceApi | null
  dtoOptions: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  reservedNames?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: ServiceApiEditPayload]
}>()

const draftName = ref('')
const draftPath = ref('')
const draftRemark = ref('')
const draftMethod = ref<HttpMethod>('GET')
const draftInputs = ref<ServiceApiParam[]>([])
const draftOutput = ref<ProcessorTypeExpr>(createEmptyProcessorTypeExpr('any'))
const draftRequireAuth = ref(false)

const genericVisible = ref(false)
const genericTarget = ref<'input' | 'output'>('output')
const genericInputIndex = ref(-1)
const genericNames = ref<string[]>([])
const genericTypeName = ref('')
const genericArgs = ref<Record<string, string>>({})

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const title = computed(() => {
  const name = props.api?.name?.trim()
  return name ? `设计 API · ${name}` : '设计 API'
})

const namedTypeOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      if (!t.name.trim()) continue
      opts.push({ id: t.id, label: `${group.name} / ${t.name}` })
    }
  }
  if (!opts.length) {
    for (const o of props.dtoOptions) {
      opts.push({ id: o.id, label: o.label })
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

watch(
  () => [props.modelValue, props.api] as const,
  ([open, api]) => {
    if (!open || !api) return
    draftName.value = api.name ?? ''
    draftPath.value = api.path ?? ''
    draftRemark.value = api.remark ?? ''
    draftMethod.value = api.method ?? 'GET'
    draftInputs.value = (api.inputs ?? []).map((p) => ({
      ...p,
      genericArgs: { ...(p.genericArgs ?? {}) },
    }))
    draftOutput.value = normalizeProcessorTypeExpr(api.output)
    draftRequireAuth.value = Boolean(api.requireAuth)
  },
)

function addInput() {
  draftInputs.value = [
    ...draftInputs.value,
    createEmptyServiceApiParam({
      varName: `arg${draftInputs.value.length + 1}`,
      location: 'query',
    }),
  ]
}

function updateInput(index: number, patch: Partial<ServiceApiParam>) {
  draftInputs.value = draftInputs.value.map((p, i) =>
    i === index ? { ...p, ...patch } : p,
  )
}

function handleInputTypeChange(
  index: number,
  payload: {
    type: DataFieldType | 'void'
    typeRef?: string
    itemType?: DataFieldType
    itemTypeRef?: string
    itemItemType?: DataFieldType
    itemItemTypeRef?: string
  },
) {
  if (payload.type === 'void') return
  const row = draftInputs.value[index]
  const prevRef = row?.typeRef ?? ''
  const typeRef = payload.typeRef ?? ''
  const type =
    typeRef || payload.type === 'json' || payload.type === 'array'
      ? payload.type === 'array'
        ? 'json'
        : typeRef
          ? 'json'
          : payload.type
      : payload.type
  const genericArgs =
    typeRef && typeRef === prevRef ? { ...(row?.genericArgs ?? {}) } : {}
  if (typeRef && typeRef !== prevRef) {
    for (const n of genericNamesOf(typeRef)) genericArgs[n] = ''
  }
  updateInput(index, {
    type: typeRef ? 'json' : type,
    typeRef,
    genericArgs,
  })
  if (genericNamesOf(typeRef).length) {
    openInputGenerics(index, typeRef, genericArgs)
  }
}

function handleOutputChange(payload: {
  type: DataFieldType | 'void'
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}) {
  if (payload.type === 'void') return
  const prev = draftOutput.value
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
  const named = next.type === 'array'
    ? next.itemType === 'array'
      ? next.itemItemTypeRef
      : next.itemTypeRef
    : next.typeRef
  const prevNamed =
    prev.type === 'array'
      ? prev.itemType === 'array'
        ? prev.itemItemTypeRef
        : prev.itemTypeRef
      : prev.typeRef
  if (named && named === prevNamed) {
    next.genericArgs = { ...(prev.genericArgs ?? {}) }
  } else {
    for (const n of genericNamesOf(named)) next.genericArgs[n] = ''
  }
  draftOutput.value = next
  if (genericNamesOf(named).length) {
    openOutputGenerics(next)
  }
}

function openInputGenerics(
  index: number,
  typeRef?: string,
  args?: Record<string, string>,
) {
  const row = draftInputs.value[index]
  const ref = typeRef ?? row?.typeRef ?? ''
  const names = genericNamesOf(ref)
  if (!names.length) return
  genericTarget.value = 'input'
  genericInputIndex.value = index
  genericNames.value = names
  genericTypeName.value = typeDefById(ref)?.name ?? ''
  genericArgs.value = { ...(args ?? row?.genericArgs ?? {}) }
  genericVisible.value = true
}

function openOutputGenerics(expr?: ProcessorTypeExpr) {
  const output = expr ?? draftOutput.value
  const named =
    output.type === 'array'
      ? output.itemType === 'array'
        ? output.itemItemTypeRef
        : output.itemTypeRef
      : output.typeRef
  const names = genericNamesOf(named)
  if (!names.length) return
  genericTarget.value = 'output'
  genericInputIndex.value = -1
  genericNames.value = names
  genericTypeName.value = typeDefById(named)?.name ?? ''
  genericArgs.value = { ...(output.genericArgs ?? {}) }
  genericVisible.value = true
}

function handleGenericSave(args: Record<string, string>) {
  if (genericTarget.value === 'output') {
    draftOutput.value = {
      ...draftOutput.value,
      genericArgs: { ...args },
    }
  } else {
    updateInput(genericInputIndex.value, { genericArgs: { ...args } })
  }
  genericVisible.value = false
}

function removeInput(index: number) {
  draftInputs.value = draftInputs.value.filter((_, i) => i !== index)
}

function handleSave() {
  const name = draftName.value.trim()
  if (!name) {
    ElMessage.warning('请填写名称')
    return
  }
  const reserved = props.reservedNames ?? []
  if (reserved.some((n) => n.toLowerCase() === name.toLowerCase())) {
    ElMessage.warning(`API 名称「${name}」已存在`)
    return
  }
  const inputs = draftInputs.value
    .map((p) => ({
      ...p,
      varName: p.varName.trim(),
      remark: p.remark.trim(),
      type: p.typeRef ? 'json' : p.type.trim() || 'string',
      typeRef: p.typeRef.trim(),
      genericArgs: { ...(p.genericArgs ?? {}) },
    }))
    .filter((p) => p.varName)
  for (const p of inputs) {
    if (!p.varName) {
      ElMessage.warning('请填写变量名')
      return
    }
  }
  emit('save', {
    name,
    path: draftPath.value.trim() || '/',
    remark: draftRemark.value.trim(),
    method: draftMethod.value,
    inputs,
    output: normalizeProcessorTypeExpr(draftOutput.value),
    requireAuth: draftRequireAuth.value,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="900px"
    destroy-on-close
    append-to-body
    class="service-api-dialog"
  >
    <el-form
      class="api-form"
      label-position="right"
      label-width="80px"
      @submit.prevent
    >
      <el-form-item label="名称" required>
        <el-input
          v-model="draftName"
          placeholder="如 list"
          maxlength="64"
        />
      </el-form-item>
      <el-form-item label="路径">
        <el-input
          v-model="draftPath"
          placeholder="如 / 或 /list"
          maxlength="128"
        />
      </el-form-item>
      <el-form-item label="说明">
        <el-input
          v-model="draftRemark"
          type="textarea"
          :rows="2"
          placeholder="可选说明"
          maxlength="200"
        />
      </el-form-item>
      <el-form-item label="请求方法">
        <el-select v-model="draftMethod" style="width: 160px">
          <el-option
            v-for="opt in HTTP_METHOD_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="需要鉴权">
        <el-switch v-model="draftRequireAuth" />
      </el-form-item>

      <el-form-item label="入参" class="inputs-item">
        <div class="inputs-block">
          <div class="inputs-toolbar">
            <el-button type="primary" link :icon="Plus" @click="addInput">
              添加
            </el-button>
          </div>
          <el-table
            :data="draftInputs"
            border
            stripe
            empty-text="暂无入参，点击添加"
            size="small"
          >
            <el-table-column label="变量名" min-width="110">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.varName"
                  placeholder="变量名"
                  size="small"
                  @update:model-value="
                    updateInput($index, { varName: String($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="来源" width="120">
              <template #default="{ row, $index }">
                <el-select
                  :model-value="row.location"
                  size="small"
                  style="width: 100%"
                  @update:model-value="
                    updateInput($index, {
                      location: $event as ServiceApiParamLocation,
                    })
                  "
                >
                  <el-option
                    v-for="opt in SERVICE_API_PARAM_LOCATION_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="220">
              <template #default="{ row, $index }">
                <div class="type-cell">
                  <DataFieldTypeTreeSelect
                    class="type-select"
                    :type="(row.typeRef ? 'json' : row.type || 'string') as DataFieldType"
                    :type-ref="row.typeRef"
                    :library="typeLibrary"
                    composable
                    :exclude-types="['api', 'icon', 'color', 'ref', 'array']"
                    size="small"
                    @change="handleInputTypeChange($index, $event)"
                  />
                  <el-button
                    v-if="genericNamesOf(row.typeRef).length"
                    type="primary"
                    link
                    size="small"
                    @click="openInputGenerics($index)"
                  >
                    泛型
                  </el-button>
                </div>
                <div
                  v-if="genericNamesOf(row.typeRef).length"
                  class="generic-preview"
                >
                  {{ formatTypeWithGenerics(row.typeRef, row.genericArgs ?? {}) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="必传" width="64" align="center">
              <template #default="{ row, $index }">
                <el-checkbox
                  :model-value="row.required"
                  @update:model-value="
                    updateInput($index, { required: Boolean($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="110">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.remark"
                  placeholder="可选"
                  size="small"
                  @update:model-value="
                    updateInput($index, { remark: String($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="" width="56" align="center">
              <template #default="{ $index }">
                <el-button
                  type="danger"
                  link
                  size="small"
                  @click="removeInput($index)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-form-item>

      <el-form-item label="出参">
        <div class="output-row">
          <DataFieldTypeTreeSelect
            class="type-select"
            :type="(draftOutput.type || 'any') as DataFieldType"
            :type-ref="draftOutput.typeRef"
            :item-type="(draftOutput.itemType || undefined) as DataFieldType | undefined"
            :item-type-ref="draftOutput.itemTypeRef"
            :item-item-type="(draftOutput.itemItemType || undefined) as DataFieldType | undefined"
            :item-item-type-ref="draftOutput.itemItemTypeRef"
            :library="typeLibrary"
            composable
            :exclude-types="['api', 'icon', 'color', 'ref']"
            @change="handleOutputChange"
          />
          <el-button
            v-if="
              genericNamesOf(
                draftOutput.type === 'array'
                  ? draftOutput.itemType === 'array'
                    ? draftOutput.itemItemTypeRef
                    : draftOutput.itemTypeRef
                  : draftOutput.typeRef,
              ).length
            "
            type="primary"
            link
            @click="openOutputGenerics()"
          >
            泛型
          </el-button>
        </div>
        <p
          v-if="
            genericNamesOf(
              draftOutput.type === 'array'
                ? draftOutput.itemType === 'array'
                  ? draftOutput.itemItemTypeRef
                  : draftOutput.itemTypeRef
                : draftOutput.typeRef,
            ).length
          "
          class="generic-preview"
        >
          {{
            formatTypeWithGenerics(
              draftOutput.type === 'array'
                ? draftOutput.itemType === 'array'
                  ? draftOutput.itemItemTypeRef
                  : draftOutput.itemTypeRef
                : draftOutput.typeRef,
              draftOutput.genericArgs ?? {},
            )
          }}
        </p>
      </el-form-item>
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
.api-form {
  padding-right: 8px;
}

.inputs-item :deep(.el-form-item__content) {
  display: block;
}

.inputs-block {
  width: 100%;
}

.inputs-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.type-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.type-select {
  flex: 1;
  min-width: 0;
}

.output-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.generic-preview {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
}
</style>
