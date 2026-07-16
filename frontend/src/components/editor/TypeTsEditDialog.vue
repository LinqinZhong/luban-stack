<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { ElMessage } from 'element-plus'
import {
  buildAmbientDeclarations,
  buildDataTypeLockedHeader,
  buildDataTypeTsContext,
  collectReferencedTypeNames,
  composeDataTypeTs,
  extractDataTypeEditableBody,
  parseDataTypeFromTs,
  validateTypeScriptSyntax,
  type DataTypeTsContext,
} from '../../utils/data-type-ts'
import type { DataTypeDef, DataTypeLibrary } from '../../types/data-types'

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
let syncing = false
let lastValidFull = ''
let lastHeader = ''
let shellDecorations: string[] = []
let headerLineCount = 1

const title = computed(
  () => `编辑 TypeScript · ${props.typeDef?.name || '未命名'}`,
)

const needsClosingBrace = computed(() => {
  const k = props.typeDef?.kind
  return k === 'interface' || k === 'enum'
})

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
  shellDecorations = []
}

function composeFull(body: string): string {
  if (!props.typeDef) return body
  const ctx = buildCtx()
  lastHeader = buildDataTypeLockedHeader(props.typeDef, ctx)
  headerLineCount = lastHeader.split('\n').length
  return composeDataTypeTs(props.typeDef, body, ctx).replace(/\n$/, '')
}

function extractBody(full: string): string {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (needsClosingBrace.value) {
    if (lines.length < 2) return ''
    return lines
      .slice(headerLineCount, -1)
      .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
      .join('\n')
  }
  // type Name =
  const joined = lines.slice(headerLineCount).join('\n').trim()
  // header may end with `=` on last header line; body follows on same or next lines
  const headerLines = lastHeader.split('\n')
  const lastHeaderLine = headerLines[headerLines.length - 1] ?? ''
  if (lines[headerLineCount - 1] === lastHeaderLine) {
    return lines.slice(headerLineCount).join('\n').trim()
  }
  // fallback: after first `=`
  const eq = full.indexOf('=')
  return eq >= 0 ? full.slice(eq + 1).trim() : joined
}

function shellIntact(full: string): boolean {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  const headerLines = lastHeader.split('\n')
  if (lines.length < headerLines.length + (needsClosingBrace.value ? 1 : 0)) {
    return false
  }
  for (let i = 0; i < headerLines.length; i++) {
    if (lines[i] !== headerLines[i]) return false
  }
  if (needsClosingBrace.value) {
    if (lines[lines.length - 1] !== '}') return false
  }
  return true
}

function applyShellDecorations() {
  if (!editor || !model) return
  const last = model.getLineCount()
  const ranges: monaco.editor.IModelDeltaDecoration[] = [
    {
      range: new monaco.Range(1, 1, headerLineCount, Number.MAX_SAFE_INTEGER),
      options: {
        isWholeLine: true,
        className: 'ts-shell-readonly',
        marginClassName: 'ts-shell-readonly-margin',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    },
  ]
  if (needsClosingBrace.value && last > headerLineCount) {
    ranges.push({
      range: new monaco.Range(last, 1, last, Number.MAX_SAFE_INTEGER),
      options: {
        isWholeLine: true,
        className: 'ts-shell-readonly',
        marginClassName: 'ts-shell-readonly-margin',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    })
  }
  shellDecorations = editor.deltaDecorations(shellDecorations, ranges)
}

function restoreShell(body?: string) {
  if (!model || !props.typeDef) return
  syncing = true
  const nextBody = body ?? extractBody(lastValidFull)
  const full = composeFull(nextBody)
  lastValidFull = full
  model.setValue(full)
  applyShellDecorations()
  syncing = false
}

function clampSelection() {
  if (!editor || !model) return
  const sel = editor.getSelection()
  if (!sel) return
  const last = model.getLineCount()
  const minLine = headerLineCount + 1
  const maxLine = needsClosingBrace.value ? Math.max(minLine, last - 1) : last
  let startLine = sel.startLineNumber
  let endLine = sel.endLineNumber
  let startCol = sel.startColumn
  let endCol = sel.endColumn
  let changed = false
  if (startLine < minLine) {
    startLine = minLine
    startCol = 1
    changed = true
  }
  if (endLine < minLine) {
    endLine = minLine
    endCol = 1
    changed = true
  }
  if (endLine > maxLine) {
    endLine = maxLine
    endCol = model.getLineMaxColumn(maxLine)
    changed = true
  }
  if (startLine > maxLine) {
    startLine = maxLine
    startCol = model.getLineMaxColumn(maxLine)
    changed = true
  }
  if (changed) {
    editor.setSelection(new monaco.Selection(startLine, startCol, endLine, endCol))
  }
}

async function setupEditor() {
  disposeEditor()
  await nextTick()
  if (!hostRef.value || !props.typeDef) return

  errorText.value = ''
  const ctx = buildCtx()
  const body = extractDataTypeEditableBody(props.typeDef, ctx)
  const initial = composeFull(body)
  lastValidFull = initial

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
  })

  applyShellDecorations()

  model.onDidChangeContent(() => {
    if (syncing || !model) return
    const full = model.getValue()
    if (!shellIntact(full)) {
      restoreShell()
      return
    }
    lastValidFull = full
    applyShellDecorations()
    errorText.value = ''
  })

  editor.onDidChangeCursorSelection(() => {
    clampSelection()
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
  if (!props.typeDef) return
  const source = (model?.getValue() ?? lastValidFull).trim() + '\n'
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
  const lockedName = props.typeDef.name.trim()
  const parsed = parseDataTypeFromTs(source, {
    existing: props.typeDef,
    ctx,
  })
  if (!parsed.ok) {
    errorText.value = parsed.errors.join('\n')
    ElMessage.error('无法解析为类型结构')
    return
  }

  if (parsed.def.name !== lockedName) {
    errorText.value = `类型名不可修改（应为 ${lockedName}）`
    ElMessage.error(errorText.value)
    return
  }

  const genericNames = parsed.def.generics.map((g) => g.name)
  const refs = collectReferencedTypeNames(source, genericNames)
  const known = new Set(allTypeNames())
  known.add(lockedName)
  const missing = refs.filter((n) => !known.has(n))
  if (missing.length) {
    errorText.value = missing.map((n) => `类型「${n}」不存在`).join('\n')
    ElMessage.error('存在未定义的类型引用')
    return
  }

  emit('save', { ...parsed.def, name: lockedName })
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
  >
    <div class="hint">
      灰色行为只读（类型名不可改）。仅编辑成员/类型表达式；语法错误或引用不存在的类型将无法保存。
    </div>
    <div ref="hostRef" class="ts-host" />
    <div v-if="errorText" class="errors">{{ errorText }}</div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
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

.ts-host :deep(.ts-shell-readonly) {
  background: #f5f7fa;
  opacity: 0.92;
}

.ts-host :deep(.ts-shell-readonly-margin) {
  background: #eef1f6;
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
