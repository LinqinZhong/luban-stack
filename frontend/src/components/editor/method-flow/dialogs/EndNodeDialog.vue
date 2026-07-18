<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProcessorTypeExpr } from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import TypedBindingCascader from '../TypedBindingCascader.vue'

export type EndNodeForm = {
  /** 方法返回值表达式（变量名或字段路径） */
  returnExpr: string
}

const props = defineProps<{
  modelValue: boolean
  form: EndNodeForm
  /** 方法出参类型展示文案 */
  outputTypeLabel: string
  outputType: ProcessorTypeExpr
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: EndNodeForm]
}>()

const draft = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) draft.value = props.form.returnExpr ?? ''
  },
)

const returnError = computed(() => {
  if (!draft.value.trim()) return '请选择类型匹配的返回数据'
  return ''
})

function handleSave() {
  if (returnError.value) return
  emit('save', { returnExpr: draft.value.trim() })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑终止节点"
    width="480px"
    destroy-on-close
    append-to-body
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
      @submit.prevent
    >
      <el-form-item label="出参类型">
        <span class="hint-inline">{{ outputTypeLabel || '—' }}</span>
      </el-form-item>
      <el-form-item
        label="返回数据"
        required
        :error="returnError || undefined"
      >
        <TypedBindingCascader
          v-model="draft"
          :ambient-vars="ambientVars"
          :target-type="outputType"
          :type-library="typeLibrary"
          placeholder="选择类型匹配的变量或字段"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="Boolean(returnError)"
        @click="handleSave"
      >
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint-inline {
  font-size: 13px;
  color: #606266;
  line-height: 32px;
}
</style>
