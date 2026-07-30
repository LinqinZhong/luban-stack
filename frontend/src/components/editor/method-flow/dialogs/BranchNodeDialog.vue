<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FlowPrintField from '../FlowPrintField.vue'

const props = defineProps<{
  modelValue: boolean
  expression: string
  printExpr: string
  ambientHint: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: { expression: string; printExpr: string }]
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
      draft.value = props.expression
      printDraft.value = props.printExpr ?? ''
    }
  },
)

function handleSave() {
  emit('save', {
    expression: draft.value.trim(),
    printExpr: printDraft.value.trim(),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑判断节点"
    width="520px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
    >
      <el-form-item label="条件表达式">
        <el-input
          v-model="draft"
          type="textarea"
          :rows="4"
          placeholder="例如：goodsList.length > 0"
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
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint-inline {
  font-size: 12px;
  color: #909399;
  line-height: 32px;
}
</style>
