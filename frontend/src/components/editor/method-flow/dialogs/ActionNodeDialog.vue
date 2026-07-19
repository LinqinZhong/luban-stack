<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { DataFieldType } from '../../../../types/page-data'
import type { MethodParam, MethodReturnType } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import { findDataTypeDef } from '../../../../utils/named-type-fields'
import {
  applyPayloadToGenericArgs,
  dataFieldToMethodParamType,
  FLOW_TYPE_EXCLUDE,
  flowDraftToTypeExpr,
  leafNamedRefFromDraft,
  leafNamedRefFromPayload,
  methodTypeToDataField,
  type FlowTypeSelectPayload,
} from '../../../../utils/flow-type-select'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect.vue'
import TsCodeEditor from '../../TsCodeEditor.vue'
import TypeGenericArgsDialog from '../../TypeGenericArgsDialog.vue'
import FlowPrintField from '../FlowPrintField.vue'

export type ActionNodeForm = {
  code: string
  description: string
  printExpr: string
  outputType: MethodReturnType
  outputTypeRef: string
  outputItemType: string
  outputItemTypeRef: string
  outputItemItemType: string
  outputItemItemTypeRef: string
  outputGenericArgs: Record<string, string>
  outputVarName: string
}

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
  printExpr: '',
  outputType: 'void',
  outputTypeRef: '',
  outputItemType: '',
  outputItemTypeRef: '',
  outputItemItemType: '',
  outputItemItemTypeRef: '',
  outputGenericArgs: {},
  outputVarName: '',
})

const genericDialogVisible = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function readGenericArgs(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    Object.assign(draft, {
      code: props.form.code ?? '',
      description: props.form.description ?? '',
      printExpr: props.form.printExpr ?? '',
      outputType: props.form.outputType || 'void',
      outputTypeRef: props.form.outputTypeRef ?? '',
      outputItemType: props.form.outputItemType ?? '',
      outputItemTypeRef: props.form.outputItemTypeRef ?? '',
      outputItemItemType: props.form.outputItemItemType ?? '',
      outputItemItemTypeRef: props.form.outputItemItemTypeRef ?? '',
      outputGenericArgs: {
        ...readGenericArgs(props.form.outputGenericArgs),
      },
      outputVarName: props.form.outputVarName ?? '',
    })
  },
)

function genericNamesOf(typeRef: string): string[] {
  return (findDataTypeDef(props.typeLibrary, typeRef)?.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
}

const treeType = computed(
  (): DataFieldType | 'void' =>
    methodTypeToDataField(draft.outputType, draft.outputTypeRef),
)

const treeItemType = computed(
  () => (draft.outputItemType || undefined) as DataFieldType | undefined,
)
const treeItemItemType = computed(
  () => (draft.outputItemItemType || undefined) as DataFieldType | undefined,
)

const leafNamed = computed(() =>
  leafNamedRefFromDraft({
    type: draft.outputType,
    typeRef: draft.outputTypeRef,
    itemType: draft.outputItemType,
    itemTypeRef: draft.outputItemTypeRef,
    itemItemType: draft.outputItemItemType,
    itemItemTypeRef: draft.outputItemItemTypeRef,
  }),
)

const outputGenericNames = computed(() => genericNamesOf(leafNamed.value))
const hasOutputGenerics = computed(() => outputGenericNames.value.length > 0)

const outputTypeName = computed(() => {
  if (!leafNamed.value) return ''
  return findDataTypeDef(props.typeLibrary, leafNamed.value)?.name?.trim() || ''
})

const genericTypeOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      const name = t.name.trim()
      if (!name) continue
      opts.push({
        id: t.id,
        label: t.remark ? `${name} · ${t.remark}` : name,
      })
    }
  }
  return opts
})

function handleOutputTypeChange(payload: FlowTypeSelectPayload) {
  const prevNamed = leafNamed.value
  if (payload.type === 'void') {
    draft.outputType = 'void'
    draft.outputTypeRef = ''
    draft.outputItemType = ''
    draft.outputItemTypeRef = ''
    draft.outputItemItemType = ''
    draft.outputItemItemTypeRef = ''
    draft.outputGenericArgs = {}
    draft.outputVarName = ''
    return
  }

  const methodType = dataFieldToMethodParamType(payload.type)
  draft.outputType = methodType as MethodReturnType
  draft.outputTypeRef = payload.typeRef ?? ''
  draft.outputItemType = payload.itemType ?? ''
  draft.outputItemTypeRef = payload.itemTypeRef ?? ''
  draft.outputItemItemType = payload.itemItemType ?? ''
  draft.outputItemItemTypeRef = payload.itemItemTypeRef ?? ''

  const named = leafNamedRefFromPayload(payload)
  const names = genericNamesOf(named)
  draft.outputGenericArgs = applyPayloadToGenericArgs(
    payload,
    prevNamed,
    draft.outputGenericArgs,
    names,
  )
  if (named && names.length && named !== prevNamed) {
    genericDialogVisible.value = true
  }
}

const hasOutput = computed(
  () => draft.outputType !== 'void' || Boolean(draft.outputTypeRef),
)

const editorReturnType = computed<MethodReturnType>(() => {
  if (draft.outputType === 'void' && !draft.outputTypeRef) return 'void'
  if (draft.outputTypeRef || draft.outputType === 'object') return 'object'
  return draft.outputType || 'void'
})

const editorReturnTypeTs = computed(() => {
  if (draft.outputType === 'void' && !draft.outputTypeRef) return ''
  return processorTypeExprToTs(
    flowDraftToTypeExpr({
      type: draft.outputType,
      typeRef: draft.outputTypeRef,
      itemType: draft.outputItemType,
      itemTypeRef: draft.outputItemTypeRef,
      itemItemType: draft.outputItemItemType,
      itemItemTypeRef: draft.outputItemItemTypeRef,
      genericArgs: draft.outputGenericArgs,
    }),
    props.typeLibrary,
  )
})

const outputTypeLabel = computed(() => editorReturnTypeTs.value)

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

function openGenerics() {
  if (!hasOutputGenerics.value) return
  genericDialogVisible.value = true
}

function saveGenericArgs(args: Record<string, string>) {
  draft.outputGenericArgs = { ...args }
}

function handleSave() {
  if (varNameError.value) return
  const isVoid = draft.outputType === 'void' && !draft.outputTypeRef
  emit('save', {
    code: draft.code,
    description: draft.description.trim(),
    printExpr: draft.printExpr.trim(),
    outputType: isVoid
      ? 'void'
      : draft.outputTypeRef
        ? 'object'
        : draft.outputType || 'void',
    outputTypeRef: isVoid ? '' : draft.outputTypeRef,
    outputItemType: isVoid ? '' : draft.outputItemType,
    outputItemTypeRef: isVoid ? '' : draft.outputItemTypeRef,
    outputItemItemType: isVoid ? '' : draft.outputItemItemType,
    outputItemItemTypeRef: isVoid ? '' : draft.outputItemItemTypeRef,
    outputGenericArgs: leafNamed.value
      ? { ...(draft.outputGenericArgs ?? {}) }
      : {},
    outputVarName: hasOutput.value ? draft.outputVarName.trim() : '',
  })
  visible.value = false
}

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
        <div class="type-row">
          <DataFieldTypeTreeSelect
            class="type-select"
            :type="treeType"
            :type-ref="draft.outputTypeRef || undefined"
            :item-type="treeItemType"
            :item-type-ref="draft.outputItemTypeRef || undefined"
            :item-item-type="treeItemItemType"
            :item-item-type-ref="draft.outputItemItemTypeRef || undefined"
            :library="typeLibrary"
            :exclude-types="FLOW_TYPE_EXCLUDE"
            :allow-ref="false"
            allow-void
            clearable
            placeholder="选择出参类型"
            @change="handleOutputTypeChange"
          />
          <template v-if="hasOutputGenerics">
            <el-button type="primary" link @click="openGenerics">泛型</el-button>
            <span class="type-preview" :title="outputTypeLabel">{{
              outputTypeLabel
            }}</span>
          </template>
        </div>
      </el-form-item>
      <el-form-item label="出参变量名" :error="varNameError || undefined">
        <el-input
          v-model="draft.outputVarName"
          :disabled="!hasOutput"
          :placeholder="
            hasOutput ? '后续节点可访问该变量' : '出参为 void 时无需填写'
          "
        />
      </el-form-item>
      <el-form-item label="代码">
        <div
          class="editor-wrap nokey"
          @keydown="stopEditorKeys"
          @keyup="stopEditorKeys"
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
      <el-form-item label="打印">
        <FlowPrintField
          v-model="draft.printExpr"
          :ambient-names="ambientVars.map((v) => v.name).filter(Boolean)"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :disabled="Boolean(varNameError)"
        @click="handleSave"
      >
        确定
      </el-button>
    </template>
  </el-dialog>

  <TypeGenericArgsDialog
    v-model="genericDialogVisible"
    :type-name="outputTypeName"
    :generic-names="outputGenericNames"
    :args="draft.outputGenericArgs"
    :type-options="genericTypeOptions"
    @save="saveGenericArgs"
  />
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

.type-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.type-select {
  flex: 1;
  min-width: 0;
}

.type-preview {
  flex: 0 1 auto;
  max-width: 180px;
  font-size: 12px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-node-form :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}
</style>
