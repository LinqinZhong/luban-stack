<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FlowPrintField from '../FlowPrintField.vue'

export type ThrowNodeForm = {
  messageExpr: string
  printExpr: string
}

const props = defineProps<{
  modelValue: boolean
  form: ThrowNodeForm
  ambientHint: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: ThrowNodeForm]
}>()

const draft = ref('')
const printDraft = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      draft.value = props.form.messageExpr ?? ''
      printDraft.value = props.form.printExpr ?? ''
    }
  },
)

const messageError = computed(() =>
  draft.value.trim() ? '' : '请填写错误信息表达式',
)

function handleSave() {
  if (messageError.value) return
  emit('save', {
    messageExpr: draft.value.trim(),
    printExpr: printDraft.value.trim(),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑业务异常节点"
    width="520px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="96px"
      @submit.prevent
    >
      <el-form-item
        label="错误信息"
        required
        :error="messageError || undefined"
      >
        <el-input
          v-model="draft"
          type="textarea"
          :rows="3"
          placeholder="表达式，如 &quot;库存不足&quot; 或 errMsg"
        />
      </el-form-item>
      <el-form-item v-if="ambientHint" label="可访问变量">
        <span class="hint-inline">{{ ambientHint }}</span>
      </el-form-item>
      <el-form-item label="打印">
        <FlowPrintField
          v-model="printDraft"
          :ambient-names="
            ambientHint
              ? ambientHint.split(',').map((s) => s.trim()).filter(Boolean)
              : []
          "
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button
        type="primary"
        :disabled="Boolean(messageError)"
        @click="handleSave"
      >
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint-inline {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
</style>
