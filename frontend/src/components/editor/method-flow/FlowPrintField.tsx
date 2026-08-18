import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { colorPrimary } from '../../../theme'
import './FlowPrintField.css'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
  {
    getWorker(_: string, label: string) {
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }
      return new editorWorker()
    },
  }

const tsLang = (monaco.languages as any).typescript

const PRINT_THEME = 'luban-print'
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
      'editorCursor.foreground': colorPrimary,
      'editor.selectionBackground': '#add6ff55',
    },
  })
}

export default function FlowPrintField({
  value,
  onChange,
  placeholder = '变量或表达式，如 goodsPage',
  ambientNames = [],
  minHeight = LINE_HEIGHT * MIN_LINES + VERTICAL_PAD,
  maxHeight = LINE_HEIGHT * MAX_LINES + VERTICAL_PAD,
}: {
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  ambientNames?: string[]
  minHeight?: number
  maxHeight?: number
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [editorHeight, setEditorHeight] = useState(minHeight)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const completionRef = useRef<monaco.IDisposable | null>(null)
  const contentSizeRef = useRef<monaco.IDisposable | null>(null)
  const syncingRef = useRef(false)
  const ambientNamesRef = useRef<string[]>([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const minHeightRef = useRef(minHeight)
  minHeightRef.current = minHeight
  const maxHeightRef = useRef(maxHeight)
  maxHeightRef.current = maxHeight

  function stopEditorKeys(event: React.KeyboardEvent) {
    if (event.key === ' ' || event.key === 'Tab' || event.code === 'Space') {
      event.stopPropagation()
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host || editorRef.current) return
    ambientNamesRef.current = [...(ambientNames || [])]
    ensurePrintTheme()

    tsLang.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    })

    const model = monaco.editor.createModel(
      value || '',
      'typescript',
      monaco.Uri.parse(`inmemory://luban/print-${Date.now()}.ts`),
    )
    modelRef.current = model

    const editor = monaco.editor.create(host, {
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
      placeholder,
    })
    editorRef.current = editor

    function syncHeight() {
      if (!editorRef.current || !hostRef.current) return
      const contentH = editorRef.current.getContentHeight()
      const next = Math.min(
        maxHeightRef.current,
        Math.max(minHeightRef.current, Math.ceil(contentH)),
      )
      setEditorHeight((prev) => {
        if (Math.abs(prev - next) < 1) {
          editorRef.current?.layout()
          return prev
        }
        return next
      })
      queueMicrotask(() => {
        editorRef.current?.layout()
      })
    }

    completionRef.current = monaco.languages.registerCompletionItemProvider(
      'typescript',
      {
        triggerCharacters: ['.'],
        provideCompletionItems: (textModel, position) => {
          if (textModel !== modelRef.current) return { suggestions: [] }
          const word = textModel.getWordUntilPosition(position)
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          )
          const prefix = (word.word || '').toLowerCase()
          const suggestions: monaco.languages.CompletionItem[] = []
          for (const name of ambientNamesRef.current) {
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

    contentSizeRef.current = editor.onDidContentSizeChange(() => {
      syncHeight()
    })

    model.onDidChangeContent(() => {
      if (syncingRef.current) return
      onChangeRef.current?.(model.getValue() ?? '')
      syncHeight()
    })

    queueMicrotask(() => syncHeight())

    return () => {
      contentSizeRef.current?.dispose()
      contentSizeRef.current = null
      completionRef.current?.dispose()
      completionRef.current = null
      editorRef.current?.dispose()
      modelRef.current?.dispose()
      editorRef.current = null
      modelRef.current = null
    }
    // mount once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const model = modelRef.current
    if (!model || syncingRef.current) return
    if (model.getValue() === value) return
    syncingRef.current = true
    model.setValue(value || '')
    syncingRef.current = false
    editorRef.current?.layout()
  }, [value])

  useEffect(() => {
    ambientNamesRef.current = [...(ambientNames || [])]
  }, [ambientNames])

  useEffect(() => {
    editorRef.current?.layout()
  }, [editorHeight])

  return (
    <div
      className="print-shell nokey"
      onKeyDown={stopEditorKeys}
      onKeyUp={stopEditorKeys}
    >
      <div className="print-line print-fixed" aria-hidden="true">
        console.log(
      </div>
      <div
        ref={hostRef}
        className="print-editor"
        style={{ height: `${editorHeight}px` }}
      />
      <div className="print-line print-fixed" aria-hidden="true">
        )
      </div>
    </div>
  )
}
