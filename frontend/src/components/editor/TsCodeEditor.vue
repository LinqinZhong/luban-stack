<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import type { MethodParam, MethodReturnType } from '../../types/page-method'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

const props = defineProps<{
  /** 仅方法体（不含函数签名），对外 v-model */
  modelValue: string
  readonly?: boolean
  language?: string
  /** 显示用的函数名（只读签名） */
  functionName?: string
  /** 写入只读签名的形参 */
  params?: MethodParam[]
  /**
   * 不进形参、可在方法体内直接引用的变量（ambient declare）
   * 用于数据池同级字段等
   */
  ambientVars?: MethodParam[]
  /**
   * 额外 ambient 声明（如 declare function emit...），原样注入 Monaco ExtraLib
   */
  ambientExtra?: string
  returnType?: MethodReturnType
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let syncing = false
let lastValidFull = ''
let lastSignature = ''
let shellDecorations: string[] = []
const ambientUri = 'inmemory://voider/ambient-vars.d.ts'

function mapTsType(type: string): string {
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'Record<string, unknown>'
    case 'array':
      return 'unknown[]'
    case 'void':
      return 'void'
    default:
      return 'any'
  }
}

function sanitizeName(name: string | undefined): string {
  const n = (name ?? '').trim() || 'fn'
  return /^[A-Za-z_$][\w$]*$/.test(n) ? n : 'fn'
}

function buildSignature(): string {
  const paramList = (props.params ?? [])
    .filter((item) => item.name.trim())
    .map((item) => {
      const raw = item.name.trim()
      const rest = raw.startsWith('...')
      const name = rest ? raw : raw
      return `${name}: ${mapTsType(item.type)}`
    })
    .join(', ')
  const ret = mapTsType(props.returnType || 'void')
  return `function ${sanitizeName(props.functionName)}(${paramList}): ${ret} {`
}

function indentBody(body: string): string {
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n')
  if (lines.length === 1 && lines[0] === '') return '  '
  return lines.map((line) => (line.length ? `  ${line}` : '')).join('\n')
}

function extractBody(full: string): string {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < 2) return ''
  return lines
    .slice(1, -1)
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n')
}

function composeFull(body: string): string {
  return `${buildSignature()}\n${indentBody(body)}\n}`
}

function shellIntact(full: string): boolean {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < 2) return false
  return lines[0] === buildSignature() && lines[lines.length - 1] === '}'
}

function refreshAmbient() {
  const lines = (props.ambientVars ?? [])
    .filter((item) => item.name.trim())
    .map((item) => `declare const ${item.name.trim()}: ${mapTsType(item.type)};`)
  const extra = (props.ambientExtra ?? '').trim()
  const source = `${lines.join('\n')}${lines.length && extra ? '\n' : ''}${extra}\n`
  monaco.languages.typescript.typescriptDefaults.addExtraLib(source, ambientUri)
}

function applyShellDecorations() {
  if (!editor || !model) return
  const last = model.getLineCount()
  const ranges: monaco.editor.IModelDeltaDecoration[] = [
    {
      range: new monaco.Range(1, 1, 1, Number.MAX_SAFE_INTEGER),
      options: {
        isWholeLine: true,
        className: 'ts-shell-readonly',
        marginClassName: 'ts-shell-readonly-margin',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    },
  ]
  if (last >= 2) {
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

function restoreShell(body?: string, preserveCursor = true) {
  if (!model || !editor) return
  const nextBody = body ?? (extractBody(lastValidFull) || props.modelValue || '')
  const full = composeFull(nextBody)
  if (full === model.getValue()) {
    lastValidFull = full
    lastSignature = buildSignature()
    return
  }

  const pos = preserveCursor ? editor.getPosition() : null
  const lastLineBefore = model.getLineCount()

  syncing = true
  model.setValue(full)
  lastValidFull = full
  lastSignature = buildSignature()
  syncing = false
  applyShellDecorations()

  if (pos) {
    const last = model.getLineCount()
    const bodyLast = Math.max(2, last - 1)
    let line = pos.lineNumber
    // 签名变化时尽量保持在正文区的相对行
    if (line < 2) line = 2
    if (line >= lastLineBefore) line = bodyLast
    line = Math.min(Math.max(line, 2), bodyLast)
    const maxCol = model.getLineMaxColumn(line)
    editor.setPosition({ lineNumber: line, column: Math.min(pos.column, maxCol) })
  }
}

function clampSelectionToBody() {
  if (!editor || !model || props.readonly || syncing) return
  const last = model.getLineCount()
  if (last < 3) return
  const sel = editor.getSelection()
  if (!sel) return

  // 只在真的落到壳行时才纠正，避免打断正常输入
  const startOut = sel.startLineNumber < 2 || sel.startLineNumber > last - 1
  const endOut = sel.endLineNumber < 2 || sel.endLineNumber > last - 1
  if (!startOut && !endOut) return

  const clampLine = (line: number) => Math.min(Math.max(line, 2), last - 1)
  const startLine = clampLine(sel.startLineNumber)
  const endLine = clampLine(sel.endLineNumber)
  const startCol =
    sel.startLineNumber < 2
      ? 1
      : sel.startLineNumber > last - 1
        ? model.getLineMaxColumn(startLine)
        : sel.startColumn
  const endCol =
    sel.endLineNumber < 2
      ? 1
      : sel.endLineNumber > last - 1
        ? model.getLineMaxColumn(endLine)
        : sel.endColumn

  editor.setSelection(new monaco.Selection(startLine, startCol, endLine, endCol))
}

function getBody(): string {
  if (!model) return props.modelValue ?? ''
  const full = model.getValue()
  if (!shellIntact(full)) return extractBody(lastValidFull) || props.modelValue || ''
  return extractBody(full)
}

defineExpose({ getBody })

onMounted(() => {
  if (!hostRef.value) return

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    noEmit: true,
    esModuleInterop: true,
    strict: false,
  })

  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })

  refreshAmbient()

  const initial = composeFull(props.modelValue ?? '')
  lastValidFull = initial
  lastSignature = buildSignature()

  model = monaco.editor.createModel(
    initial,
    props.language || 'typescript',
    monaco.Uri.parse(`inmemory://voider/method-${Date.now()}.ts`),
  )

  editor = monaco.editor.create(hostRef.value, {
    model,
    readOnly: props.readonly,
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
    // 仅正文行数变化时更新壳装饰（首行/末行位置可能变）
    applyShellDecorations()
    emit('update:modelValue', extractBody(full))
  })

  editor.onDidChangeCursorSelection(() => {
    clampSelectionToBody()
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (!model || syncing) return
    if (extractBody(model.getValue()) === (value ?? '')) return
    restoreShell(value ?? '')
  },
)

watch(
  () => props.readonly,
  (readonly) => {
    editor?.updateOptions({ readOnly: Boolean(readonly) })
  },
)

watch(
  () => buildSignature(),
  (signature) => {
    if (!model || signature === lastSignature) return
    restoreShell(extractBody(model.getValue()))
  },
)

watch(
  () =>
    [
      (props.ambientVars ?? [])
        .map((item) => `${item.name}:${item.type}`)
        .join('|'),
      props.ambientExtra ?? '',
    ].join('##'),
  () => {
    refreshAmbient()
  },
)

onBeforeUnmount(() => {
  editor?.dispose()
  model?.dispose()
  editor = null
  model = null
})
</script>

<template>
  <div ref="hostRef" class="ts-editor" />
</template>

<style scoped>
.ts-editor {
  width: 100%;
  height: 300px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  overflow: hidden;
}

.ts-editor :deep(.ts-shell-readonly) {
  background: #f5f7fa;
  opacity: 0.92;
}

.ts-editor :deep(.ts-shell-readonly-margin) {
  background: #eef1f6;
}
</style>
