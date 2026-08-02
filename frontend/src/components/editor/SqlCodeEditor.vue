<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
  {
    getWorker() {
      return new editorWorker()
    },
  }

/** 常用 SQL 关键字（补全一律大写） */
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'BETWEEN',
  'IS',
  'NULL',
  'AS',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'ON',
  'GROUP',
  'BY',
  'ORDER',
  'ASC',
  'DESC',
  'LIMIT',
  'OFFSET',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'DISTINCT',
  'COUNT',
  'SUM',
  'AVG',
  'MAX',
  'MIN',
  'CONCAT',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'HAVING',
  'UNION',
  'ALL',
  'EXISTS',
  'IFNULL',
  'COALESCE',
  'TRUE',
  'FALSE',
] as const

const PLACEHOLDERS = [{ label: '{TABLE_NAME}', insert: 'TABLE_NAME}' }] as const

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    /** 编辑器高度（迷你版默认 140） */
    height?: number
    placeholder?: string
    /** 入参名，用于 #{} / ${} 补全 */
    paramNames?: string[]
  }>(),
  {
    readonly: false,
    height: 140,
    placeholder: '',
    paramNames: () => [],
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let syncing = false
let completionDisposable: monaco.IDisposable | null = null
let paramNamesRef: string[] = []

function insertText(text: string) {
  if (!editor || !model || props.readonly) {
    emit('update:modelValue', `${props.modelValue || ''}${text}`)
    return
  }
  const selection = editor.getSelection()
  if (!selection) {
    const end = model.getFullModelRange().getEndPosition()
    editor.executeEdits('insert', [
      {
        range: new monaco.Range(
          end.lineNumber,
          end.column,
          end.lineNumber,
          end.column,
        ),
        text,
        forceMoveMarkers: true,
      },
    ])
  } else {
    editor.executeEdits('insert', [
      {
        range: selection,
        text,
        forceMoveMarkers: true,
      },
    ])
  }
  editor.focus()
}

defineExpose({ insertText })

function provideCompletions(
  textModel: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionList {
  if (textModel !== model) {
    return { suggestions: [] }
  }

  const line = textModel.getLineContent(position.lineNumber)
  const before = line.slice(0, position.column - 1)
  const suggestions: monaco.languages.CompletionItem[] = []

  /** 光标后已有 `}`（如自动补全成 {}）时纳入替换范围，避免变成 }} */
  function braceInnerRange(typed: string) {
    const startCol = position.column - typed.length
    const endCol =
      line[position.column - 1] === '}' ? position.column + 1 : position.column
    return new monaco.Range(
      position.lineNumber,
      startCol,
      position.lineNumber,
      endCol,
    )
  }

  // #{...} / ${...} → 入参
  const paramOpen = before.match(/([#$])\{([^}]*)$/)
  if (paramOpen) {
    const typed = paramOpen[2] ?? ''
    const range = braceInnerRange(typed)
    const names = paramNamesRef.filter(Boolean)
    for (const name of names) {
      if (typed && !name.toLowerCase().startsWith(typed.toLowerCase())) continue
      suggestions.push({
        label: name,
        kind: monaco.languages.CompletionItemKind.Variable,
        detail: '入参',
        insertText: `${name}}`,
        range,
        sortText: `0_${name}`,
      })
    }
    return { suggestions }
  }

  // {TABLE_NAME}（排除 #{ / ${）
  const braceOpen = before.match(/(?:^|[^#$])\{([^}]*)$/)
  if (braceOpen) {
    const typed = braceOpen[1] ?? ''
    const range = braceInnerRange(typed)
    for (const ph of PLACEHOLDERS) {
      const name = ph.insert.replace(/\}$/, '')
      if (typed && !name.toLowerCase().startsWith(typed.toLowerCase())) continue
      suggestions.push({
        label: ph.label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: '当前表名',
        insertText: ph.insert,
        range,
        sortText: `0_${ph.label}`,
      })
    }
    return { suggestions }
  }

  // SQL 关键字（大写）
  const word = textModel.getWordUntilPosition(position)
  const range = new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  )
  const prefix = (word.word || '').toUpperCase()
  for (const kw of SQL_KEYWORDS) {
    if (prefix && !kw.startsWith(prefix)) continue
    suggestions.push({
      label: kw,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: kw,
      range,
      sortText: `1_${kw}`,
    })
  }

  return { suggestions }
}

function mountEditor() {
  if (!hostRef.value || editor) return
  paramNamesRef = [...(props.paramNames || [])]
  model = monaco.editor.createModel(
    props.modelValue || '',
    'sql',
    monaco.Uri.parse(`inmemory://luban/sql-${Date.now()}.sql`),
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
    wordWrap: 'on',
    theme: 'vs',
    readOnly: props.readonly,
    renderLineHighlight: 'none',
    folding: false,
    glyphMargin: false,
    lineDecorationsWidth: 8,
    padding: { top: 8, bottom: 8 },
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    wordBasedSuggestions: 'off',
  })

  completionDisposable = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['{', '#', '$'],
    provideCompletionItems: (textModel, position) =>
      provideCompletions(textModel, position),
  })

  model.onDidChangeContent(() => {
    if (syncing) return
    emit('update:modelValue', model?.getValue() ?? '')
  })
}

onMounted(() => {
  mountEditor()
})

watch(
  () => props.modelValue,
  (value) => {
    if (!model || syncing) return
    if (model.getValue() === value) return
    syncing = true
    model.setValue(value || '')
    syncing = false
  },
)

watch(
  () => props.readonly,
  (ro) => {
    editor?.updateOptions({ readOnly: Boolean(ro) })
  },
)

watch(
  () => props.paramNames,
  (names) => {
    paramNamesRef = [...(names || [])]
  },
  { deep: true },
)

onBeforeUnmount(() => {
  completionDisposable?.dispose()
  completionDisposable = null
  editor?.dispose()
  model?.dispose()
  editor = null
  model = null
})
</script>

<template>
  <div class="sql-mini-wrap" :style="{ height: `${height}px` }">
    <div ref="hostRef" class="sql-mini-host" />
    <div
      v-if="placeholder && !modelValue"
      class="sql-mini-placeholder"
    >
      {{ placeholder }}
    </div>
  </div>
</template>

<style scoped>
.sql-mini-wrap {
  position: relative;
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
}

.sql-mini-host {
  width: 100%;
  height: 100%;
}

.sql-mini-placeholder {
  position: absolute;
  left: 48px;
  top: 10px;
  right: 12px;
  pointer-events: none;
  color: #a8abb2;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
