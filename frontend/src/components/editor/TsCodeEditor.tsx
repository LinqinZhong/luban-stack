import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { MethodParam, MethodReturnType } from '../../types/page-method'
import { monacoTsLang as tsLang } from '../../utils/monaco-languages'
import './TsCodeEditor.css'

export type TsCodeEditorHandle = { getBody: () => string }

type TsCodeEditorProps = {
  value: string
  onChange?: (value: string) => void
  readonly?: boolean
  language?: string
  functionName?: string
  params?: MethodParam[]
  ambientVars?: MethodParam[]
  ambientExtra?: string
  returnType?: MethodReturnType
  returnTypeTs?: string
}

export default forwardRef<TsCodeEditorHandle, TsCodeEditorProps>(
  function TsCodeEditor(props, ref) {
    const {
      value,
      onChange,
      readonly,
      language,
      functionName,
      params,
      ambientVars,
      ambientExtra,
      returnType,
      returnTypeTs,
    } = props

    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const modelRef = useRef<monaco.editor.ITextModel | null>(null)
    const ambientLibRef = useRef<monaco.IDisposable | null>(null)
    const syncingRef = useRef(false)
    const lastValidFullRef = useRef('')
    const lastSignatureRef = useRef('')
    const lastAmbientKeyRef = useRef('')
    const shellDecorationsRef = useRef<string[]>([])
    const ambientLibSeqRef = useRef(0)
    const propsRef = useRef(props)
    propsRef.current = props
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

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
        case 'map':
          return 'Map<string, unknown>'
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
      const p = propsRef.current
      const paramList = (p.params ?? [])
        .filter((item) => item.name.trim())
        .map((item) => {
          const name = item.name.trim()
          return `${name}: ${resolveTsType(item.type, item.tsType)}`
        })
        .join(', ')
      const ret = p.returnTypeTs?.trim() || mapTsType(p.returnType || 'void')
      return `function ${sanitizeName(p.functionName)}(${paramList}): ${ret} {`
    }

    function buildAmbientDts(): string {
      const p = propsRef.current
      const varLines = (p.ambientVars ?? [])
        .filter((item) => item.name.trim())
        .map(
          (item) =>
            `declare let ${item.name.trim()}: ${resolveTsType(item.type, item.tsType)};`,
        )
      const extra = (p.ambientExtra ?? '').trim()
      return [...varLines, ...(extra ? [extra] : [])]
        .filter((line) => line.trim().length > 0)
        .join('\n')
    }

    function ambientKey(): string {
      const p = propsRef.current
      return [
        (p.ambientVars ?? [])
          .map((item) => `${item.name}:${item.tsType || item.type}`)
          .join('|'),
        p.ambientExtra ?? '',
      ].join('##')
    }

    function syncAmbientLib() {
      const key = ambientKey()
      const dts = buildAmbientDts()
      if (key === lastAmbientKeyRef.current && ambientLibRef.current) return
      lastAmbientKeyRef.current = key
      ambientLibRef.current?.dispose()
      ambientLibRef.current = null
      if (!dts.trim()) return
      ambientLibSeqRef.current += 1
      ambientLibRef.current = tsLang.typescriptDefaults.addExtraLib(
        dts,
        `inmemory://luban/method-ambient-${ambientLibSeqRef.current}.d.ts`,
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
      const editor = editorRef.current
      const model = modelRef.current
      if (!editor || !model) return
      const last = model.getLineCount()
      const ranges: monaco.editor.IModelDeltaDecoration[] = [
        {
          range: new monaco.Range(1, 1, 1, Number.MAX_SAFE_INTEGER),
          options: {
            isWholeLine: true,
            className: 'ts-shell-readonly',
            marginClassName: 'ts-shell-readonly-margin',
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
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
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })
      }
      shellDecorationsRef.current = editor.deltaDecorations(
        shellDecorationsRef.current,
        ranges,
      )
    }

    function restoreShell(body?: string, preserveCursor = true) {
      const model = modelRef.current
      const editor = editorRef.current
      if (!model || !editor) return
      syncAmbientLib()
      const nextBody =
        body ??
        (extractBody(lastValidFullRef.current) ||
          propsRef.current.value ||
          '')
      const full = composeFull(nextBody)
      if (full === model.getValue()) {
        lastValidFullRef.current = full
        lastSignatureRef.current = buildSignature()
        return
      }

      const pos = preserveCursor ? editor.getPosition() : null
      const oldLine = pos?.lineNumber ?? 1

      syncingRef.current = true
      model.setValue(full)
      lastValidFullRef.current = full
      lastSignatureRef.current = buildSignature()
      syncingRef.current = false
      applyShellDecorations()

      if (pos) {
        const last = model.getLineCount()
        const bodyFirst = 2
        const bodyLast = Math.max(bodyFirst, last - 1)
        const rel = oldLine <= 1 ? 0 : oldLine - 2
        let line = bodyFirst + Math.max(0, rel)
        line = Math.min(Math.max(line, bodyFirst), bodyLast)
        const maxCol = model.getLineMaxColumn(line)
        editor.setPosition({
          lineNumber: line,
          column: Math.min(pos.column, maxCol),
        })
      }
    }

    function clampSelectionToBody() {
      const editor = editorRef.current
      const model = modelRef.current
      if (!editor || !model || propsRef.current.readonly || syncingRef.current)
        return
      const last = model.getLineCount()
      const bodyFirst = 2
      const bodyLast = last - 1
      if (bodyLast < bodyFirst) return
      const sel = editor.getSelection()
      if (!sel) return

      const startOut =
        sel.startLineNumber < bodyFirst || sel.startLineNumber > bodyLast
      const endOut =
        sel.endLineNumber < bodyFirst || sel.endLineNumber > bodyLast
      if (!startOut && !endOut) return

      const clampLine = (line: number) =>
        Math.min(Math.max(line, bodyFirst), bodyLast)
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

      editor.setSelection(
        new monaco.Selection(startLine, startCol, endLine, endCol),
      )
    }

    function getBody(): string {
      const model = modelRef.current
      if (!model) return propsRef.current.value ?? ''
      const full = model.getValue()
      if (!shellIntact(full))
        return extractBody(lastValidFullRef.current) || propsRef.current.value || ''
      return extractBody(full)
    }

    useImperativeHandle(ref, () => ({ getBody }))

    const handleMount: OnMount = (editor, monacoApi) => {
      editorRef.current = editor
      const model = editor.getModel()
      modelRef.current = model
      if (!model) return

      tsLang.typescriptDefaults.setCompilerOptions({
        target: tsLang.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
        module: tsLang.ModuleKind.ESNext,
        noEmit: true,
        esModuleInterop: true,
        strict: false,
      })

      tsLang.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      })

      syncAmbientLib()

      const initial = composeFull(propsRef.current.value ?? '')
      lastValidFullRef.current = initial
      lastSignatureRef.current = buildSignature()
      syncingRef.current = true
      model.setValue(initial)
      syncingRef.current = false

      editor.onKeyDown((e) => {
        if (
          e.keyCode === monacoApi.KeyCode.Tab ||
          e.keyCode === monacoApi.KeyCode.Space
        ) {
          e.browserEvent.stopPropagation()
        }
      })

      applyShellDecorations()

      model.onDidChangeContent(() => {
        if (syncingRef.current || !modelRef.current) return

        const full = modelRef.current.getValue()
        if (!shellIntact(full)) {
          restoreShell()
          return
        }

        lastValidFullRef.current = full
        applyShellDecorations()
        onChangeRef.current?.(extractBody(full))
      })

      editor.onDidChangeCursorSelection(() => {
        clampSelectionToBody()
      })
    }

    useEffect(() => {
      const model = modelRef.current
      if (!model || syncingRef.current) return
      if (extractBody(model.getValue()) === (value ?? '')) return
      restoreShell(value ?? '')
    }, [value])

    useEffect(() => {
      editorRef.current?.updateOptions({ readOnly: Boolean(readonly) })
    }, [readonly])

    useEffect(() => {
      const signature = buildSignature()
      const model = modelRef.current
      if (!model || signature === lastSignatureRef.current) return
      restoreShell(extractBody(model.getValue()))
    }, [functionName, params, returnType, returnTypeTs])

    useEffect(() => {
      if (!modelRef.current) return
      syncAmbientLib()
    }, [ambientVars, ambientExtra])

    useEffect(() => {
      return () => {
        ambientLibRef.current?.dispose()
        ambientLibRef.current = null
        editorRef.current = null
        modelRef.current = null
      }
    }, [])

    return (
      <div className="ts-editor nokey">
        <Editor
          height="100%"
          defaultLanguage={language || 'typescript'}
          path={`inmemory://luban/method-${Date.now()}.ts`}
          defaultValue={composeFull(value ?? '')}
          onMount={handleMount}
          options={{
            readOnly: Boolean(readonly),
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
            fixedOverflowWidgets: true,
            hover: { enabled: true, above: false },
            quickSuggestions: { other: true, comments: false, strings: false },
            suggestOnTriggerCharacters: true,
            snippetSuggestions: 'inline',
          }}
        />
      </div>
    )
  },
)
