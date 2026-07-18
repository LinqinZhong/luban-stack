<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type {
  ProcessorMethodParam,
  ServiceProcessor,
} from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import TypedBindingCascader from '../TypedBindingCascader.vue'

export type InputNodeForm = {
  dataProcessorId: string
  dataMethodId: string
  varName: string
  methodLabel: string
  /** 数据层方法入参名 → 表达式（可用方法入参 / 上游变量 / 嵌套字段） */
  paramBindings: Record<string, string>
}

const props = defineProps<{
  modelValue: boolean
  form: InputNodeForm
  dataProcessors: ServiceProcessor[]
  reservedNames: string[]
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: InputNodeForm]
}>()

const draft = reactive<InputNodeForm>({
  dataProcessorId: '',
  dataMethodId: '',
  varName: '',
  methodLabel: '',
  paramBindings: {},
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
      ...props.form,
      paramBindings: { ...(props.form.paramBindings ?? {}) },
    })
  },
)

const methodOptions = computed(() => {
  const opts: Array<{
    value: string
    label: string
    processorId: string
    methodId: string
  }> = []
  for (const proc of props.dataProcessors) {
    for (const m of proc.methods) {
      const name = m.name.trim() || m.id
      opts.push({
        value: `${proc.id}::${m.id}`,
        label: `${proc.name || proc.id}.${name}`,
        processorId: proc.id,
        methodId: m.id,
      })
    }
  }
  return opts
})

const selectedMethod = computed(() => {
  for (const proc of props.dataProcessors) {
    if (proc.id !== draft.dataProcessorId) continue
    const method = proc.methods.find((m) => m.id === draft.dataMethodId)
    if (method) return method
  }
  return null
})

const methodParams = computed((): ProcessorMethodParam[] => {
  return (selectedMethod.value?.params ?? []).filter((p) => p.name.trim())
})

function syncParamBindings(params: ProcessorMethodParam[]) {
  const next: Record<string, string> = {}
  for (const p of params) {
    const name = p.name.trim()
    if (!name) continue
    next[name] = draft.paramBindings[name] ?? ''
  }
  draft.paramBindings = next
}

const selectedMethodKey = computed({
  get() {
    if (!draft.dataProcessorId || !draft.dataMethodId) return ''
    return `${draft.dataProcessorId}::${draft.dataMethodId}`
  },
  set(key: string) {
    const opt = methodOptions.value.find((o) => o.value === key)
    if (!opt) {
      draft.dataProcessorId = ''
      draft.dataMethodId = ''
      draft.methodLabel = ''
      draft.paramBindings = {}
      return
    }
    draft.dataProcessorId = opt.processorId
    draft.dataMethodId = opt.methodId
    draft.methodLabel = opt.label
    const method = props.dataProcessors
      .find((p) => p.id === opt.processorId)
      ?.methods.find((m) => m.id === opt.methodId)
    syncParamBindings(method?.params ?? [])
  },
})

watch(
  methodParams,
  (params) => {
    if (!params.length && !Object.keys(draft.paramBindings).length) return
    syncParamBindings(params)
  },
  { deep: true },
)

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

const bindingError = computed(() => {
  for (const p of methodParams.value) {
    const name = p.name.trim()
    if (!name) continue
    if (!(draft.paramBindings[name] ?? '').trim()) {
      return `请绑定入参「${name}」`
    }
  }
  return ''
})

function paramTypeLabel(p: ProcessorMethodParam): string {
  return processorTypeExprToTs(p.typeExpr, props.typeLibrary)
}

function handleSave() {
  if (varNameError.value || bindingError.value) return
  if (!draft.dataProcessorId || !draft.dataMethodId) return
  const paramBindings: Record<string, string> = {}
  for (const p of methodParams.value) {
    const name = p.name.trim()
    if (!name) continue
    paramBindings[name] = (draft.paramBindings[name] ?? '').trim()
  }
  emit('save', {
    dataProcessorId: draft.dataProcessorId,
    dataMethodId: draft.dataMethodId,
    varName: draft.varName.trim(),
    methodLabel: draft.methodLabel,
    paramBindings,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑输入节点"
    width="560px"
    destroy-on-close
    append-to-body
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
    >
      <el-form-item label="数据层方法" required>
        <el-select
          v-model="selectedMethodKey"
          filterable
          clearable
          placeholder="选择数据层处理器方法"
          style="width: 100%"
        >
          <el-option
            v-for="opt in methodOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <p v-if="!methodOptions.length" class="hint">
          暂无数据层方法，请先在数据层创建
        </p>
      </el-form-item>

      <el-form-item
        v-if="methodParams.length"
        label="绑定入参"
        required
        :error="bindingError || undefined"
      >
        <div class="param-bindings">
          <div
            v-for="p in methodParams"
            :key="p.id"
            class="param-row"
          >
            <span
              class="param-name"
              :title="`${p.remark || p.name} · ${paramTypeLabel(p)}`"
            >
              {{ p.name }}
              <em class="param-type">{{ paramTypeLabel(p) }}</em>
            </span>
            <TypedBindingCascader
              v-model="draft.paramBindings[p.name]"
              class="param-bind"
              :ambient-vars="ambientVars"
              :target-type="p.typeExpr"
              :type-library="typeLibrary"
            />
          </div>
        </div>
      </el-form-item>
      <el-form-item v-else-if="selectedMethodKey" label="绑定入参">
        <span class="hint-inline">该方法无入参</span>
      </el-form-item>

      <el-form-item
        label="结果变量名"
        required
        :error="draft.varName ? varNameError : ''"
      >
        <el-input
          v-model="draft.varName"
          placeholder="如 goodsList"
          maxlength="64"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="
          Boolean(varNameError) ||
          Boolean(bindingError) ||
          !selectedMethodKey
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

.param-bindings {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.param-name {
  flex: 0 0 128px;
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f5f7fa;
  font-size: 13px;
  color: #606266;
  line-height: 1.3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
}

.param-type {
  font-style: normal;
  font-size: 11px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.param-bind {
  flex: 1;
  min-width: 0;
}
</style>
