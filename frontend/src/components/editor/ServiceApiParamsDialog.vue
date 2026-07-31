<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import {
  createEmptyServiceApiParam,
  SERVICE_API_PARAM_LOCATION_OPTIONS,
  type ServiceApiParam,
  type ServiceApiParamLocation,
} from '../../types/backend-services'
import type { DataFieldType } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'

const props = defineProps<{
  modelValue: boolean
  inputs: ServiceApiParam[]
  typeLibrary?: DataTypeLibrary | null
  typeOptions: Array<{ id: string; label: string }>
  /** 展示「从方法同步」 */
  canSyncFromMethod?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [inputs: ServiceApiParam[]]
  'sync-from-method': []
}>()

const draft = ref<ServiceApiParam[]>([])
const genericVisible = ref(false)
const genericIndex = ref(-1)
const genericNames = ref<string[]>([])
const genericTypeName = ref('')
const genericArgs = ref<Record<string, string>>({})

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

watch(
  () => [props.modelValue, props.inputs] as const,
  ([open]) => {
    if (!open) return
    draft.value = props.inputs.map((p) => ({
      ...p,
      genericArgs: { ...(p.genericArgs ?? {}) },
    }))
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

function addInput() {
  draft.value = [
    ...draft.value,
    createEmptyServiceApiParam({
      varName: `arg${draft.value.length + 1}`,
      location: 'query',
    }),
  ]
}

function updateInput(index: number, patch: Partial<ServiceApiParam>) {
  draft.value = draft.value.map((p, i) => (i === index ? { ...p, ...patch } : p))
}

function removeInput(index: number) {
  draft.value = draft.value.filter((_, i) => i !== index)
}

function handleInputTypeChange(index: number, payload: TypeSelectPayload) {
  if (payload.type === 'void' || payload.type === 'generic') return
  const row = draft.value[index]
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
    openGenerics(index, typeRef, genericArgs)
  }
}

function openGenerics(
  index: number,
  typeRef?: string,
  args?: Record<string, string>,
) {
  const row = draft.value[index]
  const ref = typeRef ?? row?.typeRef ?? ''
  const names = genericNamesOf(ref)
  if (!names.length) return
  genericIndex.value = index
  genericNames.value = names
  genericTypeName.value = typeDefById(ref)?.name ?? ''
  genericArgs.value = { ...(args ?? row?.genericArgs ?? {}) }
  genericVisible.value = true
}

function handleGenericSave(args: Record<string, string>) {
  if (genericIndex.value < 0) return
  updateInput(genericIndex.value, { genericArgs: { ...args } })
  genericIndex.value = -1
  genericVisible.value = false
}

function handleSyncFromMethod() {
  emit('sync-from-method')
}

function handleSave() {
  emit(
    'save',
    draft.value.map((p) => ({
      ...p,
      varName: p.varName.trim(),
      remark: p.remark.trim(),
      type: p.typeRef ? 'json' : p.type.trim() || 'string',
      typeRef: p.typeRef.trim(),
      genericArgs: { ...(p.genericArgs ?? {}) },
    })),
  )
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑入参"
    width="760px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="params-head">
      <span class="hint">配置 API 入参（变量名、来源、类型）；保存后可在「入参绑定」中映射到业务方法。</span>
      <div class="params-actions">
        <el-button
          v-if="canSyncFromMethod"
          type="primary"
          link
          @click="handleSyncFromMethod"
        >
          从方法同步
        </el-button>
        <el-button type="primary" link :icon="Plus" @click="addInput">
          添加
        </el-button>
      </div>
    </div>
    <el-table
      :data="draft"
      border
      stripe
      empty-text="暂无入参，点击添加或从方法同步"
      size="small"
    >
      <el-table-column label="变量名" min-width="110">
        <template #default="{ row, $index }">
          <el-input
            :model-value="row.varName"
            placeholder="变量名"
            size="small"
            @update:model-value="updateInput($index, { varName: String($event) })"
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
      <el-table-column label="类型" min-width="160">
        <template #default="{ row, $index }">
          <div class="type-cell">
            <DataFieldTypeTreeSelect
              class="type-select"
              :type="(row.type || 'string') as DataFieldType"
              :type-ref="row.typeRef"
              :library="typeLibrary"
              size="small"
              composable
              :exclude-types="['api', 'icon', 'color', 'ref', 'resource', 'void']"
              @change="(p) => handleInputTypeChange($index, p)"
            />
            <el-button
              v-if="genericNamesOf(row.typeRef).length"
              type="primary"
              link
              size="small"
              @click="openGenerics($index)"
            >
              泛型
            </el-button>
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
      <el-table-column label="说明" min-width="100">
        <template #default="{ row, $index }">
          <el-input
            :model-value="row.remark"
            placeholder="可选"
            size="small"
            @update:model-value="updateInput($index, { remark: String($event) })"
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
    <template #footer>
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>

    <TypeGenericArgsDialog
      v-model="genericVisible"
      :type-name="genericTypeName"
      :generic-names="genericNames"
      :args="genericArgs"
      :type-options="typeOptions"
      @save="handleGenericSave"
    />
  </el-dialog>
</template>

<style scoped>
.params-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.params-actions {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
}

.hint {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.type-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.type-select {
  flex: 1;
  min-width: 0;
}
</style>
