<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParamType } from '../../../../types/page-method'

export type DefineNodeForm = {
  varName: string
  valueType: MethodParamType
  valueTypeRef: string
  initExpr: string
  description: string
}

const BUILTIN_TYPES: Array<{ value: MethodParamType; label: string }> = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
  { value: 'any', label: 'any' },
]

const props = defineProps<{
  modelValue: boolean
  form: DefineNodeForm
  typeLibrary?: DataTypeLibrary | null
  reservedNames: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: DefineNodeForm]
}>()

const draft = reactive<DefineNodeForm>({
  varName: '',
  valueType: 'any',
  valueTypeRef: '',
  initExpr: '',
  description: '',
})

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(draft, props.form)
  },
)

const namedTypeOptions = computed(() => {
  const opts: Array<{ value: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      const name = t.name.trim()
      if (!name) continue
      opts.push({
        value: t.id,
        label: t.remark ? `${name} · ${t.remark}` : name,
      })
    }
  }
  return opts
})

const typeSelectValue = computed({
  get() {
    if (draft.valueTypeRef) return `named:${draft.valueTypeRef}`
    return draft.valueType || 'any'
  },
  set(value: string) {
    if (value.startsWith('named:')) {
      draft.valueType = 'object'
      draft.valueTypeRef = value.slice(6)
      return
    }
    draft.valueType = (value || 'any') as MethodParamType
    draft.valueTypeRef = ''
  },
})

const varNameError = computed(() => {
  const name = draft.varName.trim()
  if (!name) return '请填写变量名'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return '变量名须为合法标识符'
  }
  if (props.reservedNames.includes(name)) {
    return '与方法入参或其他节点变量重名'
  }
  return ''
})

function handleSave() {
  if (varNameError.value) return
  emit('save', {
    varName: draft.varName.trim(),
    valueType: draft.valueTypeRef ? 'object' : draft.valueType || 'any',
    valueTypeRef: draft.valueTypeRef,
    initExpr: draft.initExpr.trim(),
    description: draft.description.trim(),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑定义数据节点"
    width="520px"
    destroy-on-close
    append-to-body
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
    >
      <el-form-item label="变量名" required :error="varNameError || undefined">
        <el-input v-model="draft.varName" placeholder="如 pageSize" maxlength="64" />
      </el-form-item>
      <el-form-item label="类型" required>
        <el-select v-model="typeSelectValue" filterable style="width: 100%">
          <el-option
            v-for="opt in BUILTIN_TYPES"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
          <el-option
            v-for="opt in namedTypeOptions"
            :key="opt.value"
            :label="opt.label"
            :value="`named:${opt.value}`"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="初始值表达式">
        <el-input
          v-model="draft.initExpr"
          placeholder="例如：1 或 [] 或 { current: 1 }"
        />
      </el-form-item>
      <el-form-item label="说明">
        <el-input
          v-model="draft.description"
          maxlength="80"
          show-word-limit
          placeholder="显示在流程节点上"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :disabled="Boolean(varNameError)" @click="handleSave">
        确定
      </el-button>
    </template>
  </el-dialog>
</template>
