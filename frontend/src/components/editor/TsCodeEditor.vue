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
   * 不进形参、可在方法体内直接引用的变量（经 extraLib 注入，不进可见代码）
   */
  ambientVars?: MethodParam[]
  /**
   * 额外 ambient 声明（如 declare function emit... / 类型库）
   */
  ambientExtra?: string
  returnType?: MethodReturnType
  /** 精确返回类型（优先于 returnType，如 GoodsItem[]） */
  returnTypeTs?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let ambientLib: monaco.IDisposable | null = null
let syncing = false
let lastValidFull = ''
let lastSignature = ''
let lastAmbientKey = ''
let shellDecorations: string[] = []
let ambientLibSeq = 0

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

function resolveTsType(type: string, tsType?: string): string {
  const precise = tsType?.trim()
  if (precise) return precise
  return mapTsType(type)
}

function sanitizeName(name: string | undefined): string {
  const n = (name ?? '').trim() || 'fn'
  return /^[A-Za-z_$][\w$]*$/.test(n) ? n : 'fn'
}

function buildSignature(): string {
  const paramList = (props.params ?? [])
    .filter((item) => item.name.trim())
    .map((item) => {
      const name = item.name.trim()
      return `${name}: ${resolveTsType(item.type, item.tsType)}`
    })
    .join(', ')
  const ret =
    props.returnTypeTs?.trim() || mapTsType(props.returnType || 'void')
  return `function ${sanitizeName(props.functionName)}(${paramList}): ${ret} {`
}

/** 仅用于 Monaco extraLib，不写入可见编辑器（用 let 允许流程内重新赋值） */
function buildAmbientDts(): string {
  const varLines = (props.ambientVars ?? [])
    .filter((item) => item.name.trim())
    .map(
      (item) =>
        `declare let ${item.name.trim()}: ${resolveTsType(item.type, item.tsType)};`,
    )
  const extra = (props.ambientExtra ?? '').trim()
  return [...varLines, ...(extra ? [extra] : [])]
    .filter((line) => line.trim().length > 0)
    .join('\n')
}

function ambientKey(): string {
  return [
    (props.ambientVars ?? [])
      .map((item) => `${item.name}:${item.tsType || item.type}`)
      .join('|'),
    props.ambientExtra ?? '',
  ].join('##')
}

function syncAmbientLib() {
  const key = ambientKey()
  const dts = buildAmbientDts()
  if (key === lastAmbientKey && ambientLib) return
  lastAmbientKey = key
  ambientLib?.dispose()
  ambientLib = null
  if (!dts.trim()) return
  ambientLibSeq += 1
  ambientLib = monaco.languages.typescript.typescriptDefaults.addExtraLib(
    dts,
    `inmemory://voider/method-ambient-${ambientLibSeq}.d.ts`,
  )
}

function indentBody(body: string): string {
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n')
  if (lines.length === 1 && lines[0] === '') return '  '
  return lines.map((line) => (line.length ? `  ${line}` : '')).join('\n')
}

function composeFull(body: string): string {
  return `${buildSignature()}\n${indentBody(body)}\n}`
}

function extractBody(full: string): string {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < 2) return ''
  // 正文：签名下一行 … 最后一行 `}` 之前
  return lines
    .slice(1, -1)
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n')
}

function shellIntact(full: string): boolean {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < 2) return false
  if (lines[lines.length - 1] !== '}') return false
  return lines[0] === buildSignature()
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
  syncAmbientLib()
  const nextBody = body ?? (extractBody(lastValidFull) || props.modelValue || '')
  const full = composeFull(nextBody)
  if (full === model.getValue()) {
    lastValidFull = full
    lastSignature = buildSignature()
    return
  }

  const pos = preserveCursor ? editor.getPosition() : null
  const oldLine = pos?.lineNumber ?? 1

  syncing = true
  model.setValue(full)
  lastValidFull = full
  lastSignature = buildSignature()
  syncing = false
  applyShellDecorations()

  if (pos) {
    const last = model.getLineCount()
    const bodyFirst = 2
    const bodyLast = Math.max(bodyFirst, last - 1)
    // 壳从「签名+正文」变为无 ambient 后，尽量保持相对正文位置
    const rel = oldLine <= 1 ? 0 : oldLine - 2
    let line = bodyFirst + Math.max(0, rel)
    line = Math.min(Math.max(line, bodyFirst), bodyLast)
    const maxCol = model.getLineMaxColumn(line)
    editor.setPosition({ lineNumber: line, column: Math.min(pos.column, maxCol) })
  }
}

function clampSelectionToBody() {
  if (!editor || !model || props.readonly || syncing) return
  const last = model.getLineCount()
  const bodyFirst = 2
  const bodyLast = last - 1
  if (bodyLast < bodyFirst) return
  const sel = editor.getSelection()
  if (!sel) return

  const startOut = sel.startLineNumber < bodyFirst || sel.startLineNumber > bodyLast
  const endOut = sel.endLineNumber < bodyFirst || sel.endLineNumber > bodyLast
  if (!startOut && !endOut) return

  const clampLine = (line: number) => Math.min(Math.max(line, bodyFirst), bodyLast)
  const startLine = clampLine(sel.startLineNumber)
  const endLine = clampLine(sel.endLineNumber)
  const startCol =
    sel.startLineNumber < bodyFirst
      ? 1
      : sel.startLineNumber > bodyLast
        ? model.getLineMaxColumn(startLine)
        : sel.startColumn
  const endCol =
    sel.endLineNumber < bodyFirst
      ? 1
      : sel.endLineNumber > bodyLast
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

  syncAmbientLib()

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
    insertSpaces: true,
    detectIndentation: false,
    wordWrap: 'on',
    theme: 'vs',
    tabFocusMode: false,
    // 减少被上方表单项裁切；仍用 fixed 逃出编辑器自身 overflow
    fixedOverflowWidgets: true,
    hover: { enabled: true, above: false },
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
    snippetSuggestions: 'inline',
  })

  editor.onKeyDown((e) => {
    if (
      e.keyCode === monaco.KeyCode.Tab ||
      e.keyCode === monaco.KeyCode.Space
    ) {
      e.browserEvent.stopPropagation()
    }
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
  () => ambientKey(),
  () => {
    if (!model) return
    syncAmbientLib()
  },
)

onBeforeUnmount(() => {
  ambientLib?.dispose()
  ambientLib = null
  editor?.dispose()
  model?.dispose()
  editor = null
  model = null
})
</script>

<template>
  <div ref="hostRef" class="ts-editor nokey" />
</template>

<style scoped>
.ts-editor {
  width: 100%;
  height: 300px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  overflow: hidden;
  /* 给上方 hover 留一点空间时仍可能被裁；配合 hover.above=false */
  position: relative;
  z-index: 1;
}

.ts-editor :deep(.ts-shell-readonly) {
  background: #f5f7fa;
  opacity: 0.92;
}

.ts-editor :deep(.ts-shell-readonly-margin) {
  background: #eef1f6;
}

/* 浮层盖过相邻表单项 */
.ts-editor :deep(.overflowingContentWidgets),
.ts-editor :deep(.overflow-widgets-container) {
  z-index: 20;
}
</style>
