<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
  {
    getWorker(_: string, label: string) {
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }
      return new editorWorker()
    },
  }

const PRINT_THEME = 'voider-print'
const LINE_HEIGHT = 20
const VERTICAL_PAD = 16
const MIN_LINES = 2
const MAX_LINES = 12

function ensurePrintTheme() {
  monaco.editor.defineTheme(PRINT_THEME, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'string', foreground: '067D17', fontStyle: 'bold' },
      { token: 'string.escape', foreground: '067D17' },
      { token: 'number', foreground: '098658' },
      { token: 'keyword', foreground: '0000FF' },
      { token: 'identifier', foreground: '001080' },
      { token: 'delimiter', foreground: '000000' },
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#000000',
      'editorCursor.foreground': '#409eff',
      'editor.selectionBackground': '#add6ff55',
    },
  })
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    ambientNames?: string[]
    /** 最小高度（默认 2 行） */
    minHeight?: number
    /** 最大高度（默认 12 行） */
    maxHeight?: number
  }>(),
  {
    placeholder: '变量或表达式，如 goodsPage',
    ambientNames: () => [],
    minHeight: LINE_HEIGHT * MIN_LINES + VERTICAL_PAD,
    maxHeight: LINE_HEIGHT * MAX_LINES + VERTICAL_PAD,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
const editorHeight = ref(props.minHeight)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let completionDisposable: monaco.IDisposable | null = null
let contentSizeDisposable: monaco.IDisposable | null = null
let syncing = false
let ambientNamesRef: string[] = []

function stopEditorKeys(event: KeyboardEvent) {
  if (event.key === ' ' || event.key === 'Tab' || event.code === 'Space') {
    event.stopPropagation()
  }
}

function syncHeight() {
  if (!editor || !hostRef.value) return
  const contentH = editor.getContentHeight()
  const next = Math.min(
    props.maxHeight,
    Math.max(props.minHeight, Math.ceil(contentH)),
  )
  if (Math.abs(editorHeight.value - next) < 1) {
    editor.layout()
    return
  }
  editorHeight.value = next
  void nextTick(() => {
    editor?.layout()
  })
}

function mountEditor() {
  if (!hostRef.value || editor) return
  ambientNamesRef = [...(props.ambientNames || [])]
  ensurePrintTheme()

  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
  })

  model = monaco.editor.createModel(
    props.modelValue || '',
    'typescript',
    monaco.Uri.parse(`inmemory://voider/print-${Date.now()}.ts`),
  )

  editor = monaco.editor.create(hostRef.value, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace',
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    // 用 Monaco 边距做缩进，避免 CSS padding 导致光标错位
    lineDecorationsWidth: 20,
    lineNumbersMinChars: 0,
    scrollBeyondLastLine: false,
    scrollbar: {
      vertical: 'hidden',
      horizontal: 'hidden',
      alwaysConsumeMouseWheel: false,
      handleMouseWheel: false,
    },
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    renderLineHighlight: 'none',
    tabSize: 2,
    insertSpaces: true,
    autoIndent: 'full',
    detectIndentation: false,
    wordWrap: 'on',
    theme: PRINT_THEME,
    padding: { top: 8, bottom: 8 },
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: 'off',
    placeholder: props.placeholder,
  })

  completionDisposable = monaco.languages.registerCompletionItemProvider(
    'typescript',
    {
      triggerCharacters: ['.'],
      provideCompletionItems: (textModel, position) => {
        if (textModel !== model) return { suggestions: [] }
        const word = textModel.getWordUntilPosition(position)
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        )
        const prefix = (word.word || '').toLowerCase()
        const suggestions: monaco.languages.CompletionItem[] = []
        for (const name of ambientNamesRef) {
          if (!name) continue
          if (prefix && !name.toLowerCase().startsWith(prefix)) continue
          suggestions.push({
            label: name,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: '可访问变量',
            insertText: name,
            range,
            sortText: `0_${name}`,
          })
        }
        return { suggestions }
      },
    },
  )

  contentSizeDisposable = editor.onDidContentSizeChange(() => {
    syncHeight()
  })

  model.onDidChangeContent(() => {
    if (syncing) return
    emit('update:modelValue', model?.getValue() ?? '')
    syncHeight()
  })

  void nextTick(() => syncHeight())
}

onMounted(() => {
  void nextTick(() => mountEditor())
})

watch(
  () => props.modelValue,
  (value) => {
    if (!model || syncing) return
    if (model.getValue() === value) return
    syncing = true
    model.setValue(value || '')
    syncing = false
    syncHeight()
  },
)

watch(
  () => props.ambientNames,
  (names) => {
    ambientNamesRef = [...(names || [])]
  },
  { deep: true },
)

onBeforeUnmount(() => {
  contentSizeDisposable?.dispose()
  contentSizeDisposable = null
  completionDisposable?.dispose()
  completionDisposable = null
  editor?.dispose()
  model?.dispose()
  editor = null
  model = null
})
</script>

<template>
  <div
    class="print-shell nokey"
    @keydown="stopEditorKeys"
    @keyup="stopEditorKeys"
  >
    <div class="print-line print-fixed" aria-hidden="true">console.log(</div>
    <div
      ref="hostRef"
      class="print-editor"
      :style="{ height: `${editorHeight}px` }"
    />
    <div class="print-line print-fixed" aria-hidden="true">)</div>
  </div>
</template>

<style scoped>
.print-shell {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fafafa;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.45;
}

.print-line {
  padding: 6px 10px;
  color: #909399;
  user-select: none;
}

.print-fixed {
  background: #f0f2f5;
}

.print-editor {
  width: 100%;
  background: #fff;
  transition: height 0.08s ease;
}
</style>
