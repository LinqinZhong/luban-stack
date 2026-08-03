<script setup lang="ts">
import { computed, ref } from 'vue'
import { EditPen } from '@element-plus/icons-vue'
import type {
  ArraySubField,
  DataField,
  DataFieldType,
  ObjectSubField,
} from '../../types/page-data'
import {
  buildArrayValue,
  buildObjectValue,
  valueToArrayFields,
  valueToObjectFields,
} from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import type { DataTypeLibrary } from '../../types/data-types'
import { unwrapWholeBinding } from '../../utils/binding-expr'
import AttrBindExprDialog, {
  type AttrBindExprKind,
} from './AttrBindExprDialog.vue'
import ColorPicker from './ColorPicker.vue'
import DateTimeValueInput from './DateTimeValueInput.vue'
import IconValueSelect from './IconValueSelect.vue'
import ObjectFieldsDialog from './ObjectFieldsDialog.vue'
import ArrayFieldsDialog from './ArrayFieldsDialog.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    /** 常量态控件类型；默认 string */
    valueType?: DataFieldType
    typeRef?: string | null
    itemType?: DataFieldType
    itemTypeRef?: string | null
    dataFields?: DataField[]
    componentProps?: ComponentPropDef[] | null
    routeParams?: Record<string, unknown> | null
    pageQueryParams?: PageQueryParamDef[] | null
    repeatListName?: string | null
    iconOptions?: Array<{ id: string; label: string }>
    typeLibrary?: DataTypeLibrary | null
    projectPath?: string | null
  }>(),
  {
    placeholder: '',
    valueType: 'string',
    dataFields: () => [],
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const dialogVisible = ref(false)
const dialogKind = ref<AttrBindExprKind>('literal')
const objectDialogVisible = ref(false)
const arrayDialogVisible = ref(false)
const objectFieldsDraft = ref<ObjectSubField[]>([])
const arrayFieldsDraft = ref<ArraySubField[]>([])

function commit(next: string) {
  emit('update:modelValue', next)
  emit('change', next)
}

const bindingExpr = computed(() =>
  unwrapWholeBinding(String(props.modelValue ?? '')),
)

const isLiteral = computed(() => bindingExpr.value == null)

const displayValue = computed(() => {
  const raw = String(props.modelValue ?? '')
  if (bindingExpr.value != null) return bindingExpr.value
  return raw
})

const effectiveType = computed<DataFieldType>(() => props.valueType || 'string')

function openDialog() {
  dialogKind.value = isLiteral.value ? 'literal' : 'expression'
  dialogVisible.value = true
}

function onValueInput(next: string) {
  if (!isLiteral.value) return
  commit(next)
}

function onNumberUpdate(v: number | undefined) {
  if (!isLiteral.value) return
  if (v == null || Number.isNaN(v)) {
    commit('')
    return
  }
  commit(String(v))
}

const numberModel = computed(() => {
  const raw = String(props.modelValue ?? '').trim()
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
})

const boolModel = computed(() => {
  const raw = String(props.modelValue ?? '').trim().toLowerCase()
  return raw === 'true' || raw === '1'
})

function onBoolUpdate(v: boolean) {
  commit(v ? 'true' : 'false')
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const t = raw.trim()
  if (!t) return {}
  try {
    const v = JSON.parse(t) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return {}
}

function parseJsonArray(raw: string): unknown[] {
  const t = raw.trim()
  if (!t) return []
  try {
    const v = JSON.parse(t) as unknown
    if (Array.isArray(v)) return v
  } catch {
    /* ignore */
  }
  return []
}

function openObjectEditor() {
  objectFieldsDraft.value = valueToObjectFields(
    parseJsonObject(String(props.modelValue ?? '')),
  )
  objectDialogVisible.value = true
}

function openArrayEditor() {
  arrayFieldsDraft.value = valueToArrayFields(
    parseJsonArray(String(props.modelValue ?? '')),
  )
  arrayDialogVisible.value = true
}

function onObjectSave(fields: ObjectSubField[]) {
  commit(JSON.stringify(buildObjectValue(fields)))
}

function onArraySave(fields: ArraySubField[]) {
  commit(JSON.stringify(buildArrayValue(fields)))
}

function complexPreview(): string {
  const raw = String(props.modelValue ?? '').trim()
  if (!raw) return '空'
  if (effectiveType.value === 'array') {
    return `${parseJsonArray(raw).length} 项`
  }
  return `${Object.keys(parseJsonObject(raw)).length} 个字段`
}

function onDialogSave(serialized: string) {
  commit(serialized)
}
</script>

<template>
  <div class="attr-bind-field">
    <!-- 绑定：蓝色只读展示 -->
    <el-input
      v-if="!isLiteral"
      class="value-input is-binding"
      size="small"
      :model-value="displayValue"
      readonly
      :placeholder="placeholder"
      @click="openDialog"
    />

    <!-- 常量：按类型控件 -->
    <template v-else>
      <ColorPicker
        v-if="effectiveType === 'color'"
        class="typed-control"
        compact
        :model-value="modelValue"
        :placeholder="placeholder || '选择颜色'"
        @update:model-value="onValueInput"
        @change="onValueInput"
      />
      <el-input-number
        v-else-if="effectiveType === 'number'"
        class="typed-control"
        size="small"
        :model-value="numberModel"
        controls-position="right"
        :placeholder="placeholder || '数字'"
        @update:model-value="onNumberUpdate"
      />
      <el-switch
        v-else-if="effectiveType === 'boolean'"
        class="typed-control typed-switch"
        size="small"
        :model-value="boolModel"
        @update:model-value="onBoolUpdate"
      />
      <DateTimeValueInput
        v-else-if="
          effectiveType === 'time' ||
          effectiveType === 'date' ||
          effectiveType === 'datetime'
        "
        class="typed-control"
        :kind="effectiveType"
        size="small"
        :model-value="modelValue"
        :placeholder="placeholder"
        @update:model-value="onValueInput"
      />
      <IconValueSelect
        v-else-if="effectiveType === 'icon'"
        class="typed-control"
        size="small"
        :model-value="modelValue"
        :options="iconOptions ?? []"
        allow-create
        clearable
        :placeholder="placeholder || '选择图标'"
        @update:model-value="onValueInput"
      />
      <div
        v-else-if="
          effectiveType === 'json' ||
          effectiveType === 'map' ||
          effectiveType === 'array'
        "
        class="complex-control"
      >
        <span class="complex-preview">{{ complexPreview() }}</span>
        <el-button
          type="primary"
          link
          size="small"
          @click="
            effectiveType === 'array' ? openArrayEditor() : openObjectEditor()
          "
        >
          编辑
        </el-button>
      </div>
      <el-input
        v-else
        class="value-input"
        size="small"
        :model-value="displayValue"
        :placeholder="placeholder"
        @update:model-value="onValueInput"
      />
    </template>

    <el-button
      class="edit-btn"
      size="small"
      :icon="EditPen"
      title="编辑绑定"
      @click="openDialog"
    />

    <AttrBindExprDialog
      v-model="dialogVisible"
      :attr-value="modelValue"
      :initial-kind="dialogKind"
      :value-type="effectiveType"
      :type-ref="typeRef"
      :item-type="itemType"
      :item-type-ref="itemTypeRef"
      :data-fields="dataFields"
      :component-props="componentProps"
      :route-params="routeParams"
      :page-query-params="pageQueryParams"
      :repeat-list-name="repeatListName"
      :icon-options="iconOptions"
      :type-library="typeLibrary"
      :project-path="projectPath"
      @save="onDialogSave"
    />

    <ObjectFieldsDialog
      v-model="objectDialogVisible"
      :fields="objectFieldsDraft"
      :icon-options="iconOptions"
      :type-library="typeLibrary"
      :type-ref="typeRef"
      :project-path="projectPath"
      @save="onObjectSave"
    />
    <ArrayFieldsDialog
      v-model="arrayDialogVisible"
      :fields="arrayFieldsDraft"
      :icon-options="iconOptions"
      :type-library="typeLibrary"
      :default-item-type="itemType"
      :default-item-type-ref="itemTypeRef || undefined"
      :project-path="projectPath"
      @save="onArraySave"
    />
  </div>
</template>

<style scoped>
.attr-bind-field {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.value-input,
.typed-control {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
}

.typed-control.el-input-number,
.typed-control :deep(.el-input-number) {
  width: 100%;
}

.typed-control :deep(.el-date-editor),
.typed-control :deep(.el-time-picker) {
  width: 100%;
}

.typed-switch {
  width: auto;
  flex: 0 0 auto;
  align-self: center;
}

.value-input :deep(.el-input__inner) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value-input.is-binding :deep(.el-input__inner),
.value-input.is-binding :deep(.el-input__wrapper),
.value-input.is-binding :deep(input) {
  color: #1677ff;
  -webkit-text-fill-color: #1677ff;
}

.complex-control {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  min-height: 24px;
  height: 24px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-blank);
  box-sizing: border-box;
}

.complex-preview {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
}
</style>
