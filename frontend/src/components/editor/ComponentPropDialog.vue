<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
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
import type { DataTypeLibrary } from '../../types/data-types'
import IconValueSelect from './IconValueSelect.vue'
import ColorPicker from './ColorPicker.vue'
import DataFieldTypeTreeSelect from './DataFieldTypeTreeSelect.vue'

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

const draft = reactive<ComponentPropDef>(createEmptyComponentProp())
const jsonDefaultText = reactive({ value: '' })

const isEdit = computed(() => Boolean(props.prop?.name?.trim()))
const title = computed(() => (isEdit.value ? '编辑参数' : '添加参数'))

const defaultEditor = computed(() => {
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
  draft.twoWay = next.twoWay
  draft.required = Boolean(next.required)
  if (draft.type === 'json' || draft.type === 'array') {
    jsonDefaultText.value = formatDefaultForJson(draft.defaultValue)
  } else {
    jsonDefaultText.value = ''
  }
  // 颜色默认值若被错误存成对象，纠正为字符串
  if (draft.type === 'color' && typeof draft.defaultValue === 'object') {
    draft.defaultValue = ''
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
  type: DataFieldType
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}) {
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
  draft.defaultValue = defaultValue(payload.type)
  if (payload.type === 'json' || payload.type === 'array') {
    jsonDefaultText.value = formatDefaultForJson(draft.defaultValue)
  } else {
    jsonDefaultText.value = ''
  }
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
  if (draft.type === 'json' || draft.type === 'array') {
    const parsed = parseComplexDefault()
    if (parsed === null) return
    defaultVal = parsed
  } else {
    defaultVal = normalizePropDefaultValue(draft.type, defaultVal)
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
    twoWay: Boolean(draft.twoWay),
    required: Boolean(draft.required),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="520px"
    destroy-on-close
    append-to-body
  >
    <el-form label-position="top" size="default">
      <el-form-item label="参数名" required>
        <el-input v-model="draft.name" placeholder="例如：title" />
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

      <el-form-item label="默认值">
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
        <el-form-item label="双向绑定（model）">
          <el-switch v-model="draft.twoWay" />
        </el-form-item>
      </div>
      <p class="hint">
        关闭「双向绑定」为 Props；开启后为 model。模板中用
        <code>{$props.字段名}</code> 读取。
      </p>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.switch-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.hint {
  margin: 0;
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
