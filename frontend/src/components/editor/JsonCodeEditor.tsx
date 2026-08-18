import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { JsonSchema } from '../../utils/json-type-schema'
import { monacoJsonLang as jsonLang } from '../../utils/monaco-languages'
import './JsonCodeEditor.css'

export type JsonCodeEditorHandle = {
  focus: () => void
  hasErrorMarkers: () => boolean
  getErrorMessages: () => string[]
}

type JsonCodeEditorProps = {
  value: string
  onChange?: (value: string) => void
  readonly?: boolean
  minHeight?: number
  schema?: JsonSchema | null
}

export default forwardRef<JsonCodeEditorHandle, JsonCodeEditorProps>(
  function JsonCodeEditor(
    {
      value,
      onChange,
      readonly = false,
      minHeight = 320,
      schema = null,
    },
    ref,
  ) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const modelRef = useRef<monaco.editor.ITextModel | null>(null)
    const syncingRef = useRef(false)
    const schemaUriRef = useRef(
      `inmemory://luban/schema-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    )
    const modelUriRef = useRef(
      monaco.Uri.parse(
        `inmemory://luban/json-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      ),
    )
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const propsRef = useRef({ value, schema })
    propsRef.current = { value, schema }

    function applySchema(nextSchema: JsonSchema | null | undefined) {
      const existing =
        jsonLang.jsonDefaults.diagnosticsOptions.schemas?.filter(
          (item: { uri: string }) => item.uri !== schemaUriRef.current,
        ) ?? []

      if (!nextSchema) {
        jsonLang.jsonDefaults.setDiagnosticsOptions({
          validate: true,
          allowComments: false,
          schemas: existing,
        })
        return
      }

      jsonLang.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: false,
        schemas: [
          ...existing,
          {
            uri: schemaUriRef.current,
            fileMatch: [modelUriRef.current.toString()],
            schema: nextSchema,
          },
        ],
      })
    }

    const handleMount: OnMount = (editor) => {
      editorRef.current = editor
      const model = editor.getModel()
      modelRef.current = model
      if (!model) return

      applySchema(propsRef.current.schema)

      editor.onDidChangeModelContent(() => {
        if (syncingRef.current || !modelRef.current) return
        onChangeRef.current?.(modelRef.current.getValue())
      })
    }

    useEffect(() => {
      const model = modelRef.current
      if (!model || syncingRef.current) return
      if (model.getValue() === value) return
      syncingRef.current = true
      model.setValue(value ?? '')
      syncingRef.current = false
    }, [value])

    useEffect(() => {
      applySchema(schema)
    }, [schema])

    useEffect(() => {
      editorRef.current?.updateOptions({ readOnly: Boolean(readonly) })
    }, [readonly])

    useEffect(() => {
      return () => {
        applySchema(null)
        editorRef.current = null
        modelRef.current = null
      }
    }, [])

    useImperativeHandle(ref, () => ({
      focus() {
        editorRef.current?.focus()
      },
      hasErrorMarkers() {
        const model = modelRef.current
        if (!model) return false
        return monaco.editor
          .getModelMarkers({ resource: model.uri })
          .some((m) => m.severity === monaco.MarkerSeverity.Error)
      },
      getErrorMessages() {
        const model = modelRef.current
        if (!model) return []
        return monaco.editor
          .getModelMarkers({ resource: model.uri })
          .filter((m) => m.severity === monaco.MarkerSeverity.Error)
          .map((m) => `第 ${m.startLineNumber} 行：${m.message}`)
      },
    }))

    return (
      <div className="json-code-editor" style={{ minHeight: `${minHeight}px` }}>
        <Editor
          height="100%"
          defaultLanguage="json"
          path={modelUriRef.current.toString()}
          defaultValue={value || ''}
          onMount={handleMount}
          options={{
            language: 'json',
            readOnly: readonly,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            renderLineHighlight: 'line',
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    )
  },
)
