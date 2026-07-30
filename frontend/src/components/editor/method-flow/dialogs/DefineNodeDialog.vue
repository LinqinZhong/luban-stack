<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { DataFieldType } from '../../../../types/page-data'
import type { MethodParamType } from '../../../../types/page-method'
import {
  buildTypeLibraryAmbientDeclarations,
  processorTypeExprToTs,
} from '../../../../types/page-method'
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
import {
  composeSingleLetDeclaration,
  parseSingleLetDeclaration,
} from '../../../../utils/parse-single-let-decl'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect.vue'
import TypeGenericArgsDialog from '../../TypeGenericArgsDialog.vue'
import FlowPrintField from '../FlowPrintField.vue'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
  {
    getWorker(_: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }

const tsLang = (monaco.languages as any).typescript

export type DefineNodeForm = {
  varName: string
  valueType: MethodParamType
  valueTypeRef: string
  valueItemType: string
  valueItemTypeRef: string
  valueItemItemType: string
  valueItemItemTypeRef: string
  valueGenericArgs: Record<string, string>
  initExpr: string
  description: string
  printExpr: string
}

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
  valueItemType: '',
  valueItemTypeRef: '',
  valueItemItemType: '',
  valueItemItemTypeRef: '',
  valueGenericArgs: {},
  initExpr: '',
  description: '',
  printExpr: '',
})

const codeError = ref('')
const genericDialogVisible = ref(false)
const hostRef = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let ambientLib: monaco.IDisposable | null = null
let syncing = false
let suppressVarNameWatch = false

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

function genericNamesOf(typeRef: string): string[] {
  return (findDataTypeDef(props.typeLibrary, typeRef)?.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
}

const treeType = computed(
  (): DataFieldType | 'void' =>
    methodTypeToDataField(draft.valueType, draft.valueTypeRef),
)

const treeItemType = computed(
  () => (draft.valueItemType || undefined) as DataFieldType | undefined,
)
const treeItemItemType = computed(
  () => (draft.valueItemItemType || undefined) as DataFieldType | undefined,
)

const leafNamed = computed(() =>
  leafNamedRefFromDraft({
    type: draft.valueType,
    typeRef: draft.valueTypeRef,
    itemType: draft.valueItemType,
    itemTypeRef: draft.valueItemTypeRef,
    itemItemType: draft.valueItemItemType,
    itemItemTypeRef: draft.valueItemItemTypeRef,
  }),
)

const valueGenericNames = computed(() => genericNamesOf(leafNamed.value))
const hasValueGenerics = computed(() => valueGenericNames.value.length > 0)

const valueTypeName = computed(() => {
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

const valueTypeTs = computed(() =>
  processorTypeExprToTs(
    flowDraftToTypeExpr({
      type: draft.valueType,
      typeRef: draft.valueTypeRef,
      itemType: draft.valueItemType,
      itemTypeRef: draft.valueItemTypeRef,
      itemItemType: draft.valueItemItemType,
      itemItemTypeRef: draft.valueItemItemTypeRef,
      genericArgs: draft.valueGenericArgs,
    }),
    props.typeLibrary,
  ),
)

function handleValueTypeChange(payload: FlowTypeSelectPayload) {
  if (payload.type === 'void') return
  const prevNamed = leafNamed.value
  draft.valueType = dataFieldToMethodParamType(payload.type)
  draft.valueTypeRef = payload.typeRef ?? ''
  draft.valueItemType = payload.itemType ?? ''
  draft.valueItemTypeRef = payload.itemTypeRef ?? ''
  draft.valueItemItemType = payload.itemItemType ?? ''
  draft.valueItemItemTypeRef = payload.itemItemTypeRef ?? ''

  const named = leafNamedRefFromPayload(payload)
  const names = genericNamesOf(named)
  draft.valueGenericArgs = applyPayloadToGenericArgs(
    payload,
    prevNamed,
    draft.valueGenericArgs,
    names,
  )
  if (named && names.length && named !== prevNamed) {
    genericDialogVisible.value = true
  }
}

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

function readEditorSource(): string {
  return model?.getValue() ?? ''
}

function writeEditorSource(source: string) {
  if (!model) return
  if (model.getValue() === source) return
  syncing = true
  model.setValue(source)
  syncing = false
}

function rebuildLetSource() {
  const parsed = parseSingleLetDeclaration(readEditorSource())
  const init = parsed.ok ? parsed.initExpr : draft.initExpr || 'null'
  writeEditorSource(
    composeSingleLetDeclaration(draft.varName, init, valueTypeTs.value),
  )
}

function syncAmbientLib() {
  ambientLib?.dispose()
  ambientLib = null
  const dts = buildTypeLibraryAmbientDeclarations(props.typeLibrary).trim()
  if (!dts) return
  ambientLib = tsLang.typescriptDefaults.addExtraLib(
    dts,
    `inmemory://voider/define-ambient-${Date.now()}.d.ts`,
  )
}

function disposeEditor() {
  ambientLib?.dispose()
  ambientLib = null
  editor?.dispose()
  model?.dispose()
  editor = null
  model = null
}

async function setupEditor() {
  disposeEditor()
  await nextTick()
  if (!hostRef.value) return

  tsLang.typescriptDefaults.setCompilerOptions({
    target: tsLang.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
    module: tsLang.ModuleKind.ESNext,
    noEmit: true,
    strict: false,
  })
  tsLang.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })

  syncAmbientLib()

  const initial = composeSingleLetDeclaration(
    draft.varName,
    draft.initExpr,
    valueTypeTs.value,
  )
  model = monaco.editor.createModel(
    initial,
    'typescript',
    monaco.Uri.parse(`inmemory://voider/define-${Date.now()}.ts`),
  )
  editor = monaco.editor.create(hostRef.value, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: false,
    wordWrap: 'on',
    theme: 'vs',
    tabFocusMode: false,
  })

  editor.onKeyDown((e) => {
    if (
      e.keyCode === monaco.KeyCode.Tab ||
      e.keyCode === monaco.KeyCode.Space
    ) {
      e.browserEvent.stopPropagation()
    }
  })

  model.onDidChangeContent(() => {
    if (syncing) return
    codeError.value = ''
    const parsed = parseSingleLetDeclaration(readEditorSource())
    if (!parsed.ok) return
    if (parsed.varName !== draft.varName.trim()) {
      suppressVarNameWatch = true
      draft.varName = parsed.varName
      void nextTick(() => {
        suppressVarNameWatch = false
      })
    }
  })
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      disposeEditor()
      codeError.value = ''
      return
    }
    Object.assign(draft, {
      ...props.form,
      valueItemType: props.form.valueItemType ?? '',
      valueItemTypeRef: props.form.valueItemTypeRef ?? '',
      valueItemItemType: props.form.valueItemItemType ?? '',
      valueItemItemTypeRef: props.form.valueItemItemTypeRef ?? '',
      valueGenericArgs: {
        ...readGenericArgs(props.form.valueGenericArgs),
      },
    })
    if (!draft.initExpr.trim()) draft.initExpr = 'null'
    await setupEditor()
  },
)

watch(
  () => draft.varName,
  () => {
    if (!model || suppressVarNameWatch) return
    rebuildLetSource()
  },
)

watch(
  () =>
    [
      draft.valueType,
      draft.valueTypeRef,
      draft.valueItemType,
      draft.valueItemTypeRef,
      draft.valueItemItemType,
      draft.valueItemItemTypeRef,
      JSON.stringify(draft.valueGenericArgs ?? {}),
    ].join('|'),
  () => {
    if (!model) return
    rebuildLetSource()
  },
)

onBeforeUnmount(() => {
  disposeEditor()
})

function openGenerics() {
  if (!hasValueGenerics.value) return
  genericDialogVisible.value = true
}

function saveGenericArgs(args: Record<string, string>) {
  draft.valueGenericArgs = { ...args }
}

function handleSave() {
  codeError.value = ''
  if (varNameError.value) return

  const parsed = parseSingleLetDeclaration(readEditorSource())
  if (!parsed.ok) {
    codeError.value = parsed.errors[0] || '语法错误'
    return
  }

  if (parsed.varName !== draft.varName.trim()) {
    codeError.value = `代码中的变量名「${parsed.varName}」与上方变量名不一致`
    return
  }

  if (props.reservedNames.includes(parsed.varName)) {
    codeError.value = '与方法入参或其他节点变量重名'
    return
  }

  emit('save', {
    varName: parsed.varName,
    valueType: draft.valueTypeRef ? 'object' : draft.valueType || 'any',
    valueTypeRef: draft.valueTypeRef,
    valueItemType: draft.valueItemType,
    valueItemTypeRef: draft.valueItemTypeRef,
    valueItemItemType: draft.valueItemItemType,
    valueItemItemTypeRef: draft.valueItemItemTypeRef,
    valueGenericArgs: leafNamed.value
      ? { ...(draft.valueGenericArgs ?? {}) }
      : {},
    initExpr: parsed.initExpr,
    description: draft.description.trim(),
    printExpr: draft.printExpr.trim(),
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
    title="编辑定义数据节点"
    width="560px"
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
      <el-form-item label="变量名" required :error="varNameError || undefined">
        <el-input
          v-model="draft.varName"
          placeholder="如 goodsPage"
          maxlength="64"
        />
      </el-form-item>
      <el-form-item label="类型" required>
        <div class="type-row">
          <DataFieldTypeTreeSelect
            class="type-select"
            :type="treeType === 'void' ? 'any' : treeType"
            :type-ref="draft.valueTypeRef || undefined"
            :item-type="treeItemType"
            :item-type-ref="draft.valueItemTypeRef || undefined"
            :item-item-type="treeItemItemType"
            :item-item-type-ref="draft.valueItemItemTypeRef || undefined"
            :library="typeLibrary"
            :exclude-types="FLOW_TYPE_EXCLUDE"
            :allow-ref="false"
            placeholder="选择类型"
            @change="handleValueTypeChange"
          />
          <template v-if="hasValueGenerics">
            <el-button type="primary" link @click="openGenerics">泛型</el-button>
            <span class="type-preview" :title="valueTypeTs">{{
              valueTypeTs
            }}</span>
          </template>
        </div>
      </el-form-item>
      <el-form-item
        label="初始值"
        required
        :error="codeError || undefined"
      >
        <div
          class="editor-wrap nokey"
          @keydown="stopEditorKeys"
          @keyup="stopEditorKeys"
        >
          <div ref="hostRef" class="let-editor" />
        </div>
      </el-form-item>
      <el-form-item label="说明">
        <el-input
          v-model="draft.description"
          maxlength="80"
          show-word-limit
          placeholder="显示在流程节点上"
        />
      </el-form-item>
      <el-form-item label="打印">
        <FlowPrintField v-model="draft.printExpr" />
      </el-form-item>
    </el-form>
    <template #footer>
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
    :type-name="valueTypeName"
    :generic-names="valueGenericNames"
    :args="draft.valueGenericArgs"
    :type-options="genericTypeOptions"
    @save="saveGenericArgs"
  />
</template>

<style scoped>
.editor-wrap {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  overflow: hidden;
}

.let-editor {
  width: 100%;
  height: 140px;
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
