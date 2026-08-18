import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import './SqlCodeEditor.css'

export type SqlCodeEditorHandle = { insertText: (text: string) => void }

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

type SqlCodeEditorProps = {
  value: string
  onChange?: (value: string) => void
  readonly?: boolean
  height?: number
  placeholder?: string
  paramNames?: string[]
}

export default forwardRef<SqlCodeEditorHandle, SqlCodeEditorProps>(
  function SqlCodeEditor(
    {
      value,
      onChange,
      readonly = false,
      height = 140,
      placeholder = '',
      paramNames = [],
    },
    ref,
  ) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const modelRef = useRef<monaco.editor.ITextModel | null>(null)
    const syncingRef = useRef(false)
    const completionDisposableRef = useRef<monaco.IDisposable | null>(null)
    const paramNamesRef = useRef<string[]>([])
    const propsRef = useRef({ value, readonly, onChange, paramNames })
    propsRef.current = { value, readonly, onChange, paramNames }

    function insertText(text: string) {
      const editor = editorRef.current
      const model = modelRef.current
      if (!editor || !model || propsRef.current.readonly) {
        propsRef.current.onChange?.(
          `${propsRef.current.value || ''}${text}`,
        )
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

    useImperativeHandle(ref, () => ({ insertText }))

    function provideCompletions(
      textModel: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.CompletionList {
      if (textModel !== modelRef.current) {
        return { suggestions: [] }
      }

      const line = textModel.getLineContent(position.lineNumber)
      const before = line.slice(0, position.column - 1)
      const suggestions: monaco.languages.CompletionItem[] = []

      function braceInnerRange(typed: string) {
        const startCol = position.column - typed.length
        const endCol =
          line[position.column - 1] === '}'
            ? position.column + 1
            : position.column
        return new monaco.Range(
          position.lineNumber,
          startCol,
          position.lineNumber,
          endCol,
        )
      }

      const paramOpen = before.match(/([#$])\{([^}]*)$/)
      if (paramOpen) {
        const typed = paramOpen[2] ?? ''
        const range = braceInnerRange(typed)
        const names = paramNamesRef.current.filter(Boolean)
        for (const name of names) {
          if (typed && !name.toLowerCase().startsWith(typed.toLowerCase()))
            continue
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

      const braceOpen = before.match(/(?:^|[^#$])\{([^}]*)$/)
      if (braceOpen) {
        const typed = braceOpen[1] ?? ''
        const range = braceInnerRange(typed)
        for (const ph of PLACEHOLDERS) {
          const name = ph.insert.replace(/\}$/, '')
          if (typed && !name.toLowerCase().startsWith(typed.toLowerCase()))
            continue
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

    const handleMount: OnMount = (editor) => {
      editorRef.current = editor
      const model = editor.getModel()
      modelRef.current = model
      if (!model) return
      paramNamesRef.current = [...(propsRef.current.paramNames || [])]

      completionDisposableRef.current =
        monaco.languages.registerCompletionItemProvider('sql', {
          triggerCharacters: ['{', '#', '$'],
          provideCompletionItems: (textModel, position) =>
            provideCompletions(textModel, position),
        })

      model.onDidChangeContent(() => {
        if (syncingRef.current) return
        propsRef.current.onChange?.(modelRef.current?.getValue() ?? '')
      })
    }

    useEffect(() => {
      const model = modelRef.current
      if (!model || syncingRef.current) return
      if (model.getValue() === value) return
      syncingRef.current = true
      model.setValue(value || '')
      syncingRef.current = false
    }, [value])

    useEffect(() => {
      editorRef.current?.updateOptions({ readOnly: Boolean(readonly) })
    }, [readonly])

    useEffect(() => {
      paramNamesRef.current = [...(paramNames || [])]
    }, [paramNames])

    useEffect(() => {
      return () => {
        completionDisposableRef.current?.dispose()
        completionDisposableRef.current = null
        editorRef.current = null
        modelRef.current = null
      }
    }, [])

    return (
      <div className="sql-mini-wrap" style={{ height: `${height}px` }}>
        <div className="sql-mini-host">
          <Editor
            height="100%"
            defaultLanguage="sql"
            path={`inmemory://luban/sql-${Date.now()}.sql`}
            defaultValue={value || ''}
            onMount={handleMount}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              tabSize: 2,
              insertSpaces: true,
              wordWrap: 'on',
              theme: 'vs',
              readOnly: readonly,
              renderLineHighlight: 'none',
              folding: false,
              glyphMargin: false,
              lineDecorationsWidth: 8,
              padding: { top: 8, bottom: 8 },
              quickSuggestions: { other: true, comments: false, strings: true },
              suggestOnTriggerCharacters: true,
              wordBasedSuggestions: 'off',
            }}
          />
        </div>
        {placeholder && !value ? (
          <div className="sql-mini-placeholder">{placeholder}</div>
        ) : null}
      </div>
    )
  },
)
