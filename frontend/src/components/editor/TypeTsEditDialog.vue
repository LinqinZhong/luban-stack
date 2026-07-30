<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { ElMessage } from 'element-plus'
import {
  buildAmbientDeclarations,
  buildDataTypeTsContext,
  collectReferencedTypeNames,
  dataTypeToTs,
  parseDataTypeFromTs,
  validateTypeScriptSyntax,
  type DataTypeTsContext,
} from '../../utils/data-type-ts'
import { isValidTypeName, type DataTypeDef, type DataTypeLibrary } from '../../types/data-types'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

const props = defineProps<{
  modelValue: boolean
  typeDef: DataTypeDef | null
  library: DataTypeLibrary
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [def: DataTypeDef]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
const errorText = ref('')
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let ambientModel: monaco.editor.ITextModel | null = null

const title = computed(
  () =>
    `${props.readonly ? '查看' : '编辑'} TypeScript · ${props.typeDef?.name || '未命名'}`,
)

function buildCtx(): DataTypeTsContext {
  return buildDataTypeTsContext(props.library)
}

function allTypeNames(): string[] {
  const names: string[] = []
  for (const g of props.library.groups) {
    for (const t of g.types) {
      if (t.name.trim()) names.push(t.name.trim())
    }
  }
  return names
}

function disposeEditor() {
  editor?.dispose()
  model?.dispose()
  ambientModel?.dispose()
  editor = null
  model = null
  ambientModel = null
}

async function setupEditor() {
  disposeEditor()
  await nextTick()
  if (!hostRef.value || !props.typeDef) return

  errorText.value = ''
  const ctx = buildCtx()
  const initial = dataTypeToTs(props.typeDef, ctx).replace(/\n$/, '')

  const ambient = buildAmbientDeclarations(allTypeNames(), props.typeDef.name.trim())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tsLang = monaco.languages.typescript as any
  tsLang.typescriptDefaults.setCompilerOptions({
    target: tsLang.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
    module: tsLang.ModuleKind.ESNext,
    noEmit: true,
    strict: true,
  })
  tsLang.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })

  const stamp = Date.now()
  if (ambient.trim()) {
    ambientModel = monaco.editor.createModel(
      ambient,
      'typescript',
      monaco.Uri.parse(`inmemory://voider/types-ambient-${stamp}.d.ts`),
    )
  }

  model = monaco.editor.createModel(
    initial,
    'typescript',
    monaco.Uri.parse(`inmemory://voider/type-edit-${stamp}.ts`),
  )

  editor = monaco.editor.create(hostRef.value, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    tabSize: 2,
    wordWrap: 'on',
    theme: 'vs',
    readOnly: Boolean(props.readonly),
  })

  model.onDidChangeContent(() => {
    errorText.value = ''
  })
}

watch(
  () => props.modelValue,
  async (visible) => {
    if (visible) await setupEditor()
    else {
      disposeEditor()
      errorText.value = ''
    }
  },
)

onBeforeUnmount(() => {
  disposeEditor()
})

function close() {
  emit('update:modelValue', false)
}

async function save() {
  if (!props.typeDef || props.readonly) return
  const source = `${(model?.getValue() ?? '').trim()}\n`
  if (!source.trim()) {
    errorText.value = '代码不能为空'
    ElMessage.error(errorText.value)
    return
  }

  const syntaxErrors = validateTypeScriptSyntax(source)
  if (syntaxErrors.length) {
    errorText.value = syntaxErrors.join('\n')
    ElMessage.error('语法错误，无法保存')
    return
  }

  const ctx = buildCtx()
  const parsed = parseDataTypeFromTs(source, {
    existing: props.typeDef,
    ctx,
  })
  if (!parsed.ok) {
    errorText.value = parsed.errors.join('\n')
    ElMessage.error('无法解析为类型结构')
    return
  }

  const newName = parsed.def.name.trim()
  if (!isValidTypeName(newName)) {
    errorText.value = `类型名不合法：${newName || '(空)'}`
    ElMessage.error(errorText.value)
    return
  }

  const dup = [...ctx.nameToId.entries()].some(
    ([name, id]) => name === newName && id !== props.typeDef!.id,
  )
  if (dup) {
    errorText.value = `类型名「${newName}」已存在`
    ElMessage.error(errorText.value)
    return
  }

  const genericNames = parsed.def.generics.map((g) => g.name)
  const refs = collectReferencedTypeNames(source, genericNames)
  const known = new Set(allTypeNames())
  known.delete(props.typeDef.name.trim())
  known.add(newName)
  const missing = refs.filter((n) => !known.has(n))
  if (missing.length) {
    errorText.value = missing.map((n) => `类型「${n}」不存在`).join('\n')
    ElMessage.error('存在未定义的类型引用')
    return
  }

  emit('save', parsed.def)
  close()
  ElMessage.success('已保存并同步到结构')
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="720px"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div class="hint">
      {{
        readonly
          ? '系统预设类型，仅可查看 TypeScript 定义。'
          : '可直接修改类型名与成员。保存时解析回结构；语法错误、重名或引用不存在的类型将无法保存。'
      }}
    </div>
    <div ref="hostRef" class="ts-host" />
    <div v-if="errorText" class="errors">{{ errorText }}</div>
    <template #footer>
      <el-button v-if="readonly" @click="close">关闭</el-button>
      <el-button v-if="!readonly" type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 10px;
  line-height: 1.5;
}

.ts-host {
  width: 100%;
  height: 360px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  overflow: hidden;
}

.errors {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fef0f0;
  color: #f56c6c;
  font-size: 12px;
  white-space: pre-wrap;
  line-height: 1.5;
}
</style>
