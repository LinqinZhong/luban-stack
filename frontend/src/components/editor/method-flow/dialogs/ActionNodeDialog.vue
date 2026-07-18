<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam, MethodReturnType } from '../../../../types/page-method'
import TsCodeEditor from '../../TsCodeEditor.vue'

export type ActionNodeForm = {
  code: string
  /** 节点卡片上展示的说明 */
  description: string
  /** 出参类型，默认 void */
  outputType: MethodReturnType
  /** 具名类型 id（出参选类型库类型时） */
  outputTypeRef: string
  /** 将本节点输出注入后续节点可访问变量 */
  outputVarName: string
}

const BUILTIN_OUTPUT_TYPES: Array<{ value: MethodReturnType; label: string }> = [
  { value: 'void', label: 'void' },
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
  { value: 'any', label: 'any' },
]

const props = defineProps<{
  modelValue: boolean
  form: ActionNodeForm
  ambientVars: MethodParam[]
  ambientExtra?: string
  ambientHint: string
  typeLibrary?: DataTypeLibrary | null
  reservedNames: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: ActionNodeForm]
}>()

const draft = reactive<ActionNodeForm>({
  code: '',
  description: '',
  outputType: 'void',
  outputTypeRef: '',
  outputVarName: '',
})

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(draft, {
      code: props.form.code ?? '',
      description: props.form.description ?? '',
      outputType: props.form.outputType || 'void',
      outputTypeRef: props.form.outputTypeRef ?? '',
      outputVarName: props.form.outputVarName ?? '',
    })
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

/** 下拉统一值：void / string / … / named:<id> */
const outputSelectValue = computed({
  get() {
    if (draft.outputTypeRef) return `named:${draft.outputTypeRef}`
    return draft.outputType || 'void'
  },
  set(value: string) {
    if (value.startsWith('named:')) {
      draft.outputType = 'object'
      draft.outputTypeRef = value.slice(6)
      return
    }
    draft.outputType = (value || 'void') as MethodReturnType
    draft.outputTypeRef = ''
    if (draft.outputType === 'void') draft.outputVarName = ''
  },
})

const hasOutput = computed(() => draft.outputType !== 'void' || Boolean(draft.outputTypeRef))

const editorReturnType = computed<MethodReturnType>(() =>
  draft.outputTypeRef ? 'object' : draft.outputType || 'void',
)

const editorReturnTypeTs = computed(() => {
  if (!draft.outputTypeRef) return ''
  for (const group of props.typeLibrary?.groups ?? []) {
    const hit = group.types.find((t) => t.id === draft.outputTypeRef)
    const name = hit?.name?.trim()
    if (name) return name
  }
  return ''
})

const varNameError = computed(() => {
  if (!hasOutput.value) return ''
  const name = draft.outputVarName.trim()
  if (!name) return '请填写出参变量名'
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
    code: draft.code,
    description: draft.description.trim(),
    outputType: draft.outputTypeRef ? 'object' : draft.outputType || 'void',
    outputTypeRef: draft.outputTypeRef,
    outputVarName: hasOutput.value ? draft.outputVarName.trim() : '',
  })
  visible.value = false
}

/** 阻止弹层 / Vue Flow 抢走空格、Tab */
function stopEditorKeys(event: KeyboardEvent) {
  if (event.key === ' ' || event.key === 'Tab' || event.code === 'Space') {
    event.stopPropagation()
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑操作节点"
    width="720px"
    destroy-on-close
    append-to-body
    class="action-node-dialog"
  >
    <p v-if="ambientHint" class="hint">可访问变量：{{ ambientHint }}</p>

    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
      @submit.prevent
    >
      <el-form-item label="说明">
        <el-input
          v-model="draft.description"
          maxlength="80"
          show-word-limit
          placeholder="显示在流程节点上"
        />
      </el-form-item>
      <el-form-item label="出参类型">
        <el-select
          v-model="outputSelectValue"
          filterable
          class="full-width"
          placeholder="选择出参类型"
        >
          <el-option
            v-for="opt in BUILTIN_OUTPUT_TYPES"
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
      <el-form-item label="出参变量名" :error="varNameError || undefined">
        <el-input
          v-model="draft.outputVarName"
          :disabled="!hasOutput"
          :placeholder="hasOutput ? '后续节点可访问该变量' : '出参为 void 时无需填写'"
        />
      </el-form-item>
      <el-form-item label="代码">
        <div
          class="editor-wrap nokey"
          @keydown.capture="stopEditorKeys"
          @keyup.capture="stopEditorKeys"
        >
          <TsCodeEditor
            v-if="visible"
            v-model="draft.code"
            function-name="action"
            :ambient-vars="ambientVars"
            :ambient-extra="ambientExtra"
            :return-type="editorReturnType"
            :return-type-ts="editorReturnTypeTs"
          />
        </div>
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

<style scoped>
.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #909399;
}

.editor-wrap {
  width: 100%;
  height: 320px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  overflow: hidden;
}

.editor-wrap :deep(.ts-editor) {
  height: 100%;
  border: none;
  border-radius: 0;
}

.full-width {
  width: 100%;
}
</style>
