<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProcessorTypeExpr } from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { defaultEmptyReturnHint } from '../../../../utils/empty-return-value'
import TypedBindingCascader from '../TypedBindingCascader.vue'
import FlowPrintField from '../FlowPrintField.vue'

export type EndNodeForm = {
  /** 方法返回值表达式（变量名或字段路径）；可空，空则按出参类型返回默认空值 */
  returnExpr: string
  printExpr: string
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    form: EndNodeForm
    /** 方法出参类型展示文案 */
    outputTypeLabel: string
    outputType: ProcessorTypeExpr
    ambientVars: MethodParam[]
    typeLibrary?: DataTypeLibrary | null
    /** 是否需要配置返回数据（方法有非 void 出参） */
    requireReturn?: boolean
  }>(),
  { requireReturn: true },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: EndNodeForm]
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
      draft.value = props.form.returnExpr ?? ''
      printDraft.value = props.form.printExpr ?? ''
    }
  },
)

const emptyHint = computed(() =>
  defaultEmptyReturnHint(props.outputType, props.typeLibrary),
)

function handleSave() {
  emit('save', {
    returnExpr: props.requireReturn ? draft.value.trim() : '',
    printExpr: printDraft.value.trim(),
  })
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
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
      @submit.prevent
    >
      <template v-if="requireReturn">
        <el-form-item label="出参类型">
          <span class="hint-inline">{{ outputTypeLabel || '—' }}</span>
        </el-form-item>
        <el-form-item label="返回数据">
          <TypedBindingCascader
            v-model="draft"
            :ambient-vars="ambientVars"
            :target-type="outputType"
            :type-library="typeLibrary"
            placeholder="可选；留空则按出参类型返回空值"
          />
          <p v-if="emptyHint" class="hint">{{ emptyHint }}</p>
        </el-form-item>
      </template>
      <el-form-item label="打印">
        <FlowPrintField
          v-model="printDraft"
          :ambient-names="ambientVars.map((v) => v.name).filter(Boolean)"
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
  font-size: 13px;
  color: #606266;
  line-height: 32px;
}

.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}
</style>
