<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import {
  leafNamedRefFromPayload,
  methodTypeToDataField,
  type FlowTypeSelectPayload,
} from '../../../../utils/flow-type-select'
import {
  buildAutoFieldMappings,
  buildQueryPageVoTypeExpr,
  filterArrayAmbientVars,
  filterPageAmbientVars,
  listInterfaceFieldNames,
  listPageTypeIds,
  mergeSavedFieldMappings,
  QUERY_PAGE_VO_TYPE_ID,
  readFieldMappings,
  resolveArrayItemFieldNames,
  resolveItemFieldNames,
  resolvePageMapItemTypeRef,
  resolveQueryPageVoGenericName,
  type PageMapFieldMapping,
  type PageMapSourceKind,
} from '../../../../utils/page-map-flow'
import { coarseToProcessorTypeExpr } from '../../../../utils/typed-binding-paths'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect.vue'
import FlowPrintField from '../FlowPrintField.vue'
import TypedBindingCascader from '../TypedBindingCascader.vue'

export type PageMapNodeForm = {
  sourceKind: PageMapSourceKind
  sourcePath: string
  currentExpr: string
  pageSizeExpr: string
  totalExpr: string
  hasNextExpr: string
  /** 固定为 QueryPageVo */
  targetTypeRef: string
  /** { T: itemTypeId } */
  targetGenericArgs: Record<string, string>
  targetVarName: string
  fieldMappings: PageMapFieldMapping[]
  description: string
  printExpr: string
}

const props = defineProps<{
  modelValue: boolean
  form: PageMapNodeForm
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: PageMapNodeForm]
}>()

const draft = reactive<PageMapNodeForm>({
  sourceKind: 'page',
  sourcePath: '',
  currentExpr: '',
  pageSizeExpr: '',
  totalExpr: '',
  hasNextExpr: '',
  targetTypeRef: QUERY_PAGE_VO_TYPE_ID,
  targetGenericArgs: {},
  targetVarName: '',
  fieldMappings: [],
  description: '',
  printExpr: '',
})

/** UI：只选 T（records 元素类型） */
const itemTypeRef = ref('')

const hydrating = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const pageVars = computed(() =>
  filterPageAmbientVars(props.ambientVars, props.typeLibrary),
)

const arrayVars = computed(() => filterArrayAmbientVars(props.ambientVars))

const sourceVars = computed(() =>
  draft.sourceKind === 'array' ? arrayVars.value : pageVars.value,
)

const sourceVar = computed(() =>
  sourceVars.value.find((v) => v.name === draft.sourcePath.trim()) ?? null,
)

const targetTypeExpr = computed(() => {
  const item = itemTypeRef.value.trim()
  if (!item) return null
  return buildQueryPageVoTypeExpr(item, props.typeLibrary)
})

const sourceFieldOptions = computed(() => {
  if (!sourceVar.value?.typeExpr) return []
  if (draft.sourceKind === 'array') {
    return resolveArrayItemFieldNames(
      sourceVar.value.typeExpr,
      props.typeLibrary,
    )
  }
  return resolveItemFieldNames(sourceVar.value.typeExpr, props.typeLibrary)
})

const targetFieldRows = computed(() => {
  const item = itemTypeRef.value.trim()
  if (!item) return []
  return listInterfaceFieldNames(item, props.typeLibrary)
})

/** 排除分页类型，只让用户选元素类型 T */
const excludePageTypeIds = computed(() => listPageTypeIds(props.typeLibrary))

const numberTargetType = coarseToProcessorTypeExpr('number')
const booleanTargetType = coarseToProcessorTypeExpr('boolean')

const treeType = computed(() =>
  methodTypeToDataField('object', itemTypeRef.value || undefined),
)

const targetTypeTs = computed(() =>
  targetTypeExpr.value
    ? processorTypeExprToTs(targetTypeExpr.value, props.typeLibrary)
    : '',
)

function varLabel(v: MethodParam): string {
  const ts = processorTypeExprToTs(v.typeExpr, props.typeLibrary)
  return ts ? `${v.name} · ${ts}` : v.name
}

function applyItemType(itemRef: string) {
  const item = itemRef.trim()
  itemTypeRef.value = item
  const g = resolveQueryPageVoGenericName(props.typeLibrary)
  draft.targetTypeRef = QUERY_PAGE_VO_TYPE_ID
  draft.targetGenericArgs = item ? { [g]: item } : {}
}

function handleItemTypeChange(payload: FlowTypeSelectPayload) {
  if (payload.type === 'void') return
  applyItemType(leafNamedRefFromPayload(payload))
}

function syncFieldMappings(preserveSaved = false) {
  const targetFields = targetFieldRows.value
  const sourceFields = sourceFieldOptions.value
  if (!targetFields.length) {
    draft.fieldMappings = []
    return
  }
  if (preserveSaved) {
    draft.fieldMappings = mergeSavedFieldMappings(
      targetFields,
      sourceFields,
      readFieldMappings(draft.fieldMappings),
    )
    return
  }
  draft.fieldMappings = buildAutoFieldMappings(targetFields, sourceFields)
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    hydrating.value = true
    Object.assign(draft, {
      ...props.form,
      sourceKind: props.form.sourceKind === 'array' ? 'array' : 'page',
      targetGenericArgs: { ...(props.form.targetGenericArgs ?? {}) },
      fieldMappings: readFieldMappings(props.form.fieldMappings).map((m) => ({
        ...m,
      })),
    })
    applyItemType(resolvePageMapItemTypeRef(props.form, props.typeLibrary))
    syncFieldMappings(true)
    queueMicrotask(() => {
      hydrating.value = false
    })
  },
)

watch(
  () => [draft.sourceKind, draft.sourcePath, itemTypeRef.value].join('|'),
  () => {
    if (hydrating.value) return
    syncFieldMappings(false)
  },
)

watch(
  () => draft.sourceKind,
  (kind, prev) => {
    if (hydrating.value || kind === prev) return
    draft.sourcePath = ''
  },
)

const sourceError = computed(() =>
  draft.sourcePath.trim() ? '' : '请选择数据源变量',
)

const targetTypeError = computed(() =>
  itemTypeRef.value.trim() ? '' : '请选择元素类型 T',
)

const targetVarError = computed(() => {
  const name = draft.targetVarName.trim()
  if (!name) return '请填写变量名'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return '变量名须为合法标识符'
  }
  return ''
})

const arrayMetaError = computed(() => {
  if (draft.sourceKind !== 'array') return ''
  if (!draft.currentExpr.trim()) return '请填写 current 表达式'
  if (!draft.pageSizeExpr.trim()) return '请填写 pageSize 表达式'
  if (!draft.totalExpr.trim()) return '请填写 total 表达式'
  return ''
})

function handleSave() {
  if (
    sourceError.value ||
    targetTypeError.value ||
    targetVarError.value ||
    arrayMetaError.value
  ) {
    return
  }
  const item = itemTypeRef.value.trim()
  const g = resolveQueryPageVoGenericName(props.typeLibrary)
  emit('save', {
    sourceKind: draft.sourceKind,
    sourcePath: draft.sourcePath.trim(),
    currentExpr: draft.currentExpr.trim(),
    pageSizeExpr: draft.pageSizeExpr.trim(),
    totalExpr: draft.totalExpr.trim(),
    hasNextExpr: draft.hasNextExpr.trim(),
    targetTypeRef: QUERY_PAGE_VO_TYPE_ID,
    targetGenericArgs: { [g]: item },
    targetVarName: draft.targetVarName.trim(),
    fieldMappings: draft.fieldMappings
      .map((m) => ({
        targetField: m.targetField.trim(),
        sourceField: m.sourceField.trim(),
      }))
      .filter((m) => m.targetField),
    description: draft.description.trim(),
    printExpr: draft.printExpr.trim(),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑分页映射节点"
    width="640px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="120px"
    >
      <el-form-item label="数据源类型" required>
        <el-radio-group v-model="draft.sourceKind">
          <el-radio value="page">分页</el-radio>
          <el-radio value="array">[]</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item
        label="数据源"
        required
        :error="sourceError || undefined"
      >
        <el-select
          v-model="draft.sourcePath"
          filterable
          clearable
          :placeholder="
            draft.sourceKind === 'array' ? '选择数组变量' : '选择分页变量'
          "
          style="width: 100%"
        >
          <el-option
            v-for="v in sourceVars"
            :key="v.name"
            :label="varLabel(v)"
            :value="v.name"
          />
        </el-select>
        <p v-if="!sourceVars.length" class="hint">
          {{
            draft.sourceKind === 'array'
              ? '暂无数组类型变量'
              : '暂无分页类型变量，请先定义 QueryPageVo 等分页对象'
          }}
        </p>
      </el-form-item>

      <template v-if="draft.sourceKind === 'array'">
        <el-form-item
          label="current"
          required
          :error="
            arrayMetaError === '请填写 current 表达式'
              ? arrayMetaError
              : undefined
          "
        >
          <TypedBindingCascader
            v-model="draft.currentExpr"
            :ambient-vars="ambientVars"
            :target-type="numberTargetType"
            :type-library="typeLibrary"
            placeholder="选择 current 变量或字段"
          />
        </el-form-item>
        <el-form-item
          label="pageSize"
          required
          :error="
            arrayMetaError === '请填写 pageSize 表达式'
              ? arrayMetaError
              : undefined
          "
        >
          <TypedBindingCascader
            v-model="draft.pageSizeExpr"
            :ambient-vars="ambientVars"
            :target-type="numberTargetType"
            :type-library="typeLibrary"
            placeholder="选择 pageSize 变量或字段"
          />
        </el-form-item>
        <el-form-item
          label="total"
          required
          :error="
            arrayMetaError === '请填写 total 表达式'
              ? arrayMetaError
              : undefined
          "
        >
          <TypedBindingCascader
            v-model="draft.totalExpr"
            :ambient-vars="ambientVars"
            :target-type="numberTargetType"
            :type-library="typeLibrary"
            placeholder="选择 total 变量或字段"
          />
        </el-form-item>
        <el-form-item label="hasNext">
          <TypedBindingCascader
            v-model="draft.hasNextExpr"
            :ambient-vars="ambientVars"
            :target-type="booleanTargetType"
            :type-library="typeLibrary"
            placeholder="可选；留空则按 current×pageSize < total 计算"
          />
        </el-form-item>
      </template>

      <el-form-item
        label="元素类型 T"
        required
        :error="targetTypeError || undefined"
      >
        <div class="type-row">
          <DataFieldTypeTreeSelect
            class="type-select"
            :type="treeType"
            :type-ref="itemTypeRef || undefined"
            :library="typeLibrary"
            :exclude-named-ids="excludePageTypeIds"
            :exclude-types="[
              'string',
              'number',
              'boolean',
              'color',
              'ref',
              'icon',
              'resource',
              'array',
            ]"
            :allow-ref="false"
            placeholder="选择 records 元素类型 T"
            @change="handleItemTypeChange"
          />
          <span v-if="targetTypeTs" class="type-preview" :title="targetTypeTs">
            → {{ targetTypeTs }}
          </span>
        </div>
      </el-form-item>

      <el-form-item
        label="变量名"
        required
        :error="targetVarError || undefined"
      >
        <el-input
          v-model="draft.targetVarName"
          placeholder="写入 scope 的变量名，如 goodsPage"
          maxlength="64"
        />
      </el-form-item>

      <el-form-item v-if="targetFieldRows.length" label="字段映射">
        <div class="mapping-table">
          <div class="mapping-head">
            <span>目标字段</span>
            <span>源字段</span>
          </div>
          <div
            v-for="(row, index) in draft.fieldMappings"
            :key="row.targetField"
            class="mapping-row"
          >
            <span class="field-name" :title="row.targetField">{{
              row.targetField
            }}</span>
            <el-select
              v-model="draft.fieldMappings[index]!.sourceField"
              filterable
              clearable
              placeholder="留空则跳过"
              style="width: 100%"
            >
              <el-option
                v-for="name in sourceFieldOptions"
                :key="name"
                :label="name"
                :value="name"
              />
            </el-select>
          </div>
        </div>
        <p class="hint">
          同名字段已自动映射，可手动调整；源字段留空则跳过该目标字段
        </p>
      </el-form-item>
      <el-form-item v-else-if="itemTypeRef.trim()" label="字段映射">
        <span class="hint-inline">未能解析元素类型字段</span>
      </el-form-item>

      <el-form-item label="说明">
        <el-input
          v-model="draft.description"
          maxlength="80"
          show-word-limit
          placeholder="显示在流程节点上"
        />
      </el-form-item>
      <el-form-item label="打印">
        <FlowPrintField
          v-model="draft.printExpr"
          :ambient-names="ambientVars.map((v) => v.name).filter(Boolean)"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button
        type="primary"
        :disabled="
          Boolean(sourceError) ||
          Boolean(targetTypeError) ||
          Boolean(targetVarError) ||
          Boolean(arrayMetaError)
        "
        @click="handleSave"
      >
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}

.hint-inline {
  font-size: 12px;
  color: #909399;
}

.type-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.type-select {
  flex: 1;
  min-width: 0;
}

.type-preview {
  flex-shrink: 0;
  max-width: 200px;
  font-size: 12px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-table {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mapping-head {
  display: grid;
  grid-template-columns: 128px 1fr;
  gap: 10px;
  font-size: 12px;
  color: #909399;
  padding: 0 2px;
}

.mapping-row {
  display: grid;
  grid-template-columns: 128px 1fr;
  gap: 10px;
  align-items: center;
}

.field-name {
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f5f7fa;
  font-size: 13px;
  color: #606266;
  line-height: 30px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-node-form :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}
</style>
