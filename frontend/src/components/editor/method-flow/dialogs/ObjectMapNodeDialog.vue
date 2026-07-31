<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import {
  leafNamedRefFromPayload,
  methodTypeToDataField,
  flowDraftToTypeExpr,
  type FlowTypeSelectPayload,
} from '../../../../utils/flow-type-select'
import {
  buildAutoFieldMappings,
  filterObjectAmbientVars,
  listInterfaceFieldNames,
  mergeSavedFieldMappings,
  readFieldMappings,
  resolveObjectFieldNames,
  type ObjectMapFieldMapping,
} from '../../../../utils/object-map-flow'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect.vue'
import FlowPrintField from '../FlowPrintField.vue'

export type ObjectMapNodeForm = {
  sourcePath: string
  targetTypeRef: string
  targetGenericArgs: Record<string, string>
  targetVarName: string
  fieldMappings: ObjectMapFieldMapping[]
  description: string
  printExpr: string
}

const props = defineProps<{
  modelValue: boolean
  form: ObjectMapNodeForm
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: ObjectMapNodeForm]
}>()

const draft = reactive<ObjectMapNodeForm>({
  sourcePath: '',
  targetTypeRef: '',
  targetGenericArgs: {},
  targetVarName: '',
  fieldMappings: [],
  description: '',
  printExpr: '',
})

const hydrating = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const sourceVars = computed(() =>
  filterObjectAmbientVars(props.ambientVars, props.typeLibrary),
)

const sourceVar = computed(
  () =>
    sourceVars.value.find((v) => v.name === draft.sourcePath.trim()) ?? null,
)

const sourceFieldOptions = computed(() => {
  if (!sourceVar.value?.typeExpr) return []
  return resolveObjectFieldNames(sourceVar.value.typeExpr, props.typeLibrary)
})

const targetFieldRows = computed(() => {
  const ref = draft.targetTypeRef.trim()
  if (!ref) return []
  return listInterfaceFieldNames(ref, props.typeLibrary)
})

const treeType = computed(() =>
  methodTypeToDataField('object', draft.targetTypeRef || undefined),
)

const targetTypeExpr = computed(() => {
  const typeRef = draft.targetTypeRef.trim()
  if (!typeRef) return null
  return flowDraftToTypeExpr({
    type: 'object',
    typeRef,
    genericArgs: draft.targetGenericArgs,
  })
})

const targetTypeTs = computed(() =>
  targetTypeExpr.value
    ? processorTypeExprToTs(targetTypeExpr.value, props.typeLibrary)
    : '',
)

function varLabel(v: MethodParam): string {
  const ts = processorTypeExprToTs(v.typeExpr, props.typeLibrary)
  return ts ? `${v.name} · ${ts}` : v.name
}

function handleTargetTypeChange(payload: FlowTypeSelectPayload) {
  if (payload.type === 'void') return
  const typeRef = leafNamedRefFromPayload(payload)
  draft.targetTypeRef = typeRef
  if (!typeRef) {
    draft.targetGenericArgs = {}
  }
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
      targetGenericArgs: { ...(props.form.targetGenericArgs ?? {}) },
      fieldMappings: readFieldMappings(props.form.fieldMappings).map((m) => ({
        ...m,
      })),
    })
    syncFieldMappings(true)
    queueMicrotask(() => {
      hydrating.value = false
    })
  },
)

watch(
  () => [draft.sourcePath, draft.targetTypeRef].join('|'),
  () => {
    if (hydrating.value) return
    syncFieldMappings(false)
  },
)

const sourceError = computed(() =>
  draft.sourcePath.trim() ? '' : '请选择源对象变量',
)

const targetTypeError = computed(() =>
  draft.targetTypeRef.trim() ? '' : '请选择目标接口类型',
)

const targetVarError = computed(() => {
  const name = draft.targetVarName.trim()
  if (!name) return '请填写变量名'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return '变量名须为合法标识符'
  }
  return ''
})

function handleSave() {
  if (sourceError.value || targetTypeError.value || targetVarError.value) {
    return
  }
  emit('save', {
    sourcePath: draft.sourcePath.trim(),
    targetTypeRef: draft.targetTypeRef.trim(),
    targetGenericArgs: { ...(draft.targetGenericArgs ?? {}) },
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
    title="编辑对象映射节点"
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
      <el-form-item
        label="源对象"
        required
        :error="sourceError || undefined"
      >
        <el-select
          v-model="draft.sourcePath"
          filterable
          clearable
          placeholder="选择对象变量"
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
          暂无接口类型对象变量，请先定义或输入对象数据
        </p>
      </el-form-item>

      <el-form-item
        label="目标类型"
        required
        :error="targetTypeError || undefined"
      >
        <div class="type-row">
          <DataFieldTypeTreeSelect
            class="type-select"
            :type="treeType"
            :type-ref="draft.targetTypeRef || undefined"
            :library="typeLibrary"
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
            placeholder="选择目标接口类型"
            @change="handleTargetTypeChange"
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
          placeholder="写入 scope 的变量名，如 userVo"
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
      <el-form-item v-else-if="draft.targetTypeRef.trim()" label="字段映射">
        <span class="hint-inline">未能解析目标接口字段</span>
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
          Boolean(targetVarError)
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
