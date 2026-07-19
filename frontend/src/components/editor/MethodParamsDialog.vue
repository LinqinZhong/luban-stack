<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import {
  createEmptyProcessorMethodParam,
  createEmptyProcessorTypeExpr,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  typeLabel,
  type DataFieldType,
} from '../../types/page-data'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = ['color', 'ref', 'icon']

const props = defineProps<{
  modelValue: boolean
  params: ProcessorMethodParam[]
  typeOptions: Array<{ id: string; label: string }>
  typeLibrary: DataTypeLibrary | null
  methodName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [params: ProcessorMethodParam[]]
}>()

const draft = ref<ProcessorMethodParam[]>([])
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
  () => [props.modelValue, props.params] as const,
  ([open]) => {
    if (!open) return
    draft.value = props.params.map((p) => ({
      ...p,
      typeExpr: {
        ...p.typeExpr,
        genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
      },
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
  draft.value = [
    ...draft.value,
    createEmptyProcessorMethodParam(`arg${draft.value.length + 1}`),
  ]
}

function updateParam(index: number, patch: Partial<ProcessorMethodParam>) {
  draft.value = draft.value.map((p, i) => (i === index ? { ...p, ...patch } : p))
}

function removeParam(index: number) {
  draft.value = draft.value.filter((_, i) => i !== index)
}

function handleTypeChange(index: number, payload: TypeSelectPayload) {
  const prev = draft.value[index]?.typeExpr
  const next = payloadToTypeExpr(payload, prev)
  updateParam(index, { typeExpr: next })
  if (genericNamesOf(leafNamedRef(next)).length) openGenerics(index, next)
}

function openGenerics(index: number, expr?: ProcessorTypeExpr) {
  const row = draft.value[index]
  const typeExpr = expr ?? row?.typeExpr
  if (!typeExpr) return
  const named = leafNamedRef(typeExpr)
  const names = genericNamesOf(named)
  if (!names.length) return
  genericIndex.value = index
  genericNames.value = names
  genericTypeName.value = typeDefById(named)?.name ?? ''
  genericArgs.value = { ...(typeExpr.genericArgs ?? {}) }
  genericVisible.value = true
}

function saveGenerics(args: Record<string, string>) {
  if (genericIndex.value < 0) return
  const row = draft.value[genericIndex.value]
  if (!row) return
  updateParam(genericIndex.value, {
    typeExpr: { ...row.typeExpr, genericArgs: args },
  })
  genericIndex.value = -1
}

function handleSave() {
  emit(
    'save',
    draft.value.map((p) => ({
      ...p,
      name: p.name.trim(),
      remark: p.remark.trim(),
      typeExpr: {
        ...p.typeExpr,
        genericArgs: p.typeExpr.genericArgs ?? {},
      },
    })),
  )
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="methodName ? `入参 · ${methodName}` : '入参'"
    width="640px"
    destroy-on-close
    append-to-body
  >
    <div class="params-head">
      <span class="hint">为方法添加入参；带泛型的类型可选「泛型」配置，未配按 any。</span>
      <el-button type="primary" link :icon="Plus" @click="addParam">
        添加
      </el-button>
    </div>
    <el-table :data="draft" border stripe empty-text="暂无入参，点击添加">
      <el-table-column label="名称" min-width="110">
        <template #default="{ row, $index }">
          <el-input
            :model-value="row.name"
            placeholder="参数名"
            size="small"
            @update:model-value="updateParam($index, { name: String($event) })"
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
                (row.typeExpr.itemType || undefined) as DataFieldType | undefined
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
              @change="handleTypeChange($index, $event)"
            />
            <el-button
              v-if="genericNamesOf(leafNamedRef(row.typeExpr)).length"
              type="primary"
              link
              size="small"
              @click="openGenerics($index)"
            >
              泛型
            </el-button>
          </div>
          <div
            v-if="genericNamesOf(leafNamedRef(row.typeExpr)).length"
            class="generic-preview"
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
            @update:model-value="updateParam($index, { remark: String($event) })"
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
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>

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
.params-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
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

.generic-preview {
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.3;
}
</style>
