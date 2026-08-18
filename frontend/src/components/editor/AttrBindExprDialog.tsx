import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, InputNumber, Modal, Radio, Switch } from 'antd'
import * as monaco from 'monaco-editor'
import type { DataField, DataFieldType } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import type { DataTypeLibrary } from '../../types/data-types'
import { dataFieldToTsType } from '../../types/page-method'
import { buildDollarQueryAmbientDeclaration } from '../../types/page-query'
import {
  buildDollarColorAmbientDeclaration,
  isValidPaletteColorName,
} from '../../types/color-palette'
import { buildDollarPropsAmbientDeclaration } from '../../utils/component-props'
import { unwrapWholeBinding } from '../../utils/binding-expr'
import { monacoTsLang as tsLang } from '../../utils/monaco-languages'
import {
  getColorPaletteState,
  useColorPaletteState,
} from '../../composables/useColorPalette'
import ColorPicker from './ColorPicker'
import DateTimeValueInput from './DateTimeValueInput'
import IconValueSelect from './IconValueSelect'
import './AttrBindExprDialog.css'

export type AttrBindExprKind = 'literal' | 'expression'

const SHELL_OPEN = 'function get(){'
const RETURN_PREFIX = '  return '
const SHELL_CLOSE = '}'

type SuggestItem = {
  insert: string
  label: string
  group: string
}

export default function AttrBindExprDialog({
  open,
  onOpenChange,
  attrValue,
  initialKind,
  title,
  valueType = 'string',
  typeRef: _typeRef,
  itemType: _itemType,
  itemTypeRef: _itemTypeRef,
  dataFields,
  componentProps,
  routeParams,
  pageQueryParams,
  repeatListName,
  iconOptions,
  typeLibrary: _typeLibrary,
  projectPath: _projectPath,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  attrValue: string
  initialKind?: AttrBindExprKind
  title?: string
  valueType?: DataFieldType
  typeRef?: string | null
  itemType?: DataFieldType
  itemTypeRef?: string | null
  dataFields?: DataField[]
  componentProps?: ComponentPropDef[] | null
  routeParams?: Record<string, unknown> | null
  pageQueryParams?: PageQueryParamDef[] | null
  repeatListName?: string | null
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  projectPath?: string | null
  onSave?: (serialized: string) => void
}) {
  const colorPalette = useColorPaletteState()
  const [kind, setKind] = useState<AttrBindExprKind>('literal')
  const [literalDraft, setLiteralDraft] = useState('')
  const [exprDraft, setExprDraft] = useState('')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const ambientLibRef = useRef<monaco.IDisposable | null>(null)
  const shellDecorationsRef = useRef<string[]>([])
  const syncingRef = useRef(false)
  const lastValidFullRef = useRef('')
  const ambientLibSeqRef = useRef(0)
  const kindRef = useRef(kind)
  kindRef.current = kind
  const exprDraftRef = useRef(exprDraft)
  exprDraftRef.current = exprDraft
  const propsRef = useRef({
    dataFields,
    componentProps,
    routeParams,
    pageQueryParams,
    repeatListName,
  })
  propsRef.current = {
    dataFields,
    componentProps,
    routeParams,
    pageQueryParams,
    repeatListName,
  }

  function isValidIdent(name: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(name)
  }

  const suggestItems = useMemo((): SuggestItem[] => {
    const items: SuggestItem[] = []
    const seen = new Set<string>()

    function push(group: string, insert: string, label?: string) {
      const key = insert.trim()
      if (!key || seen.has(key)) return
      seen.add(key)
      items.push({ group, insert: key, label: label || key })
    }

    for (const field of dataFields ?? []) {
      const name = field.name.trim()
      if (!name || !isValidIdent(name)) continue
      if (name === '$props' || name === '$query' || name === '$route') continue
      const remark = field.remark?.trim()
      push('数据池', name, remark ? `${name} · ${remark}` : name)
    }

    if (componentProps != null) {
      push('$props', '$props')
      for (const def of componentProps) {
        const name = def.name?.trim()
        if (!name || !isValidIdent(name)) continue
        push('$props', `$props.${name}`)
      }
    }

    const queryNames = new Set<string>()
    for (const q of pageQueryParams ?? []) {
      const name = q.name?.trim()
      if (name) queryNames.add(name)
    }
    for (const key of Object.keys(routeParams ?? {})) {
      if (key.trim()) queryNames.add(key.trim())
    }
    if (queryNames.size) {
      push('$query', '$query')
      for (const name of queryNames) {
        if (!isValidIdent(name)) continue
        push('$query', `$query.${name}`)
      }
    } else {
      push('$query', '$query')
      push('$query', '$query.id')
    }

    if (repeatListName?.trim()) {
      push('重复项', 'index', 'index · 索引')
      push('重复项', 'item')
      const repeat = repeatListName.trim()
      const field = (dataFields ?? []).find((f) => f.name.trim() === repeat)
      const sample =
        field?.type === 'array' && Array.isArray(field.value) ? field.value[0] : null
      if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
        for (const key of Object.keys(sample as Record<string, unknown>)) {
          if (!isValidIdent(key)) continue
          push('重复项', `item.${key}`)
        }
      }
    }

    const palette = colorPalette
    push('$color', '$color')
    for (const c of palette.colors ?? []) {
      const name = c.name.trim()
      if (!name || !isValidPaletteColorName(name)) continue
      const tip = c.description?.trim() || c.value || ''
      const insert = isValidIdent(name)
        ? `$color.${name}`
        : `$color[${JSON.stringify(name)}]`
      push('$color', insert, tip ? `${insert} · ${tip}` : insert)
    }

    return items
  }, [
    dataFields,
    componentProps,
    pageQueryParams,
    routeParams,
    repeatListName,
    colorPalette,
  ])

  const suggestGroups = useMemo(() => {
    const map = new Map<string, SuggestItem[]>()
    for (const item of suggestItems) {
      const list = map.get(item.group) ?? []
      list.push(item)
      map.set(item.group, list)
    }
    return [...map.entries()].map(([group, items]) => ({ group, items }))
  }, [suggestItems])

  function clampSelectionToEditable() {
    const editor = editorRef.current
    const model = modelRef.current
    if (!editor || !model || syncingRef.current) return
    const last = model.getLineCount()
    const bodyFirst = 2
    const bodyLast = last - 1
    if (bodyLast < bodyFirst) return
    const sel = editor.getSelection()
    if (!sel) return

    const clampLine = (line: number) =>
      Math.min(Math.max(line, bodyFirst), bodyLast)
    let startLine = clampLine(sel.startLineNumber)
    let endLine = clampLine(sel.endLineNumber)
    let startCol = sel.startColumn
    let endCol = sel.endColumn

    if (startLine === 2 && startCol < RETURN_PREFIX.length + 1) {
      startCol = RETURN_PREFIX.length + 1
    }
    if (endLine === 2 && endCol < RETURN_PREFIX.length + 1) {
      endCol = RETURN_PREFIX.length + 1
    }
    if (sel.startLineNumber < bodyFirst) startCol = RETURN_PREFIX.length + 1
    if (sel.endLineNumber < bodyFirst) endCol = RETURN_PREFIX.length + 1
    if (sel.startLineNumber > bodyLast) {
      startCol = model.getLineMaxColumn(startLine)
    }
    if (sel.endLineNumber > bodyLast) {
      endCol = model.getLineMaxColumn(endLine)
    }

    if (
      startLine !== sel.startLineNumber ||
      endLine !== sel.endLineNumber ||
      startCol !== sel.startColumn ||
      endCol !== sel.endColumn
    ) {
      editor.setSelection(
        new monaco.Selection(startLine, startCol, endLine, endCol),
      )
    }
  }

  function insertAtCursor(text: string) {
    const editor = editorRef.current
    const model = modelRef.current
    if (!editor || !model || kindRef.current !== 'expression') return
    editor.focus()
    clampSelectionToEditable()
    const sel = editor.getSelection()
    if (!sel) return
    editor.executeEdits('attr-bind-suggest', [
      {
        range: sel,
        text,
        forceMoveMarkers: true,
      },
    ])
    const pos = editor.getPosition()
    if (pos) {
      editor.setPosition({
        lineNumber: pos.lineNumber,
        column: pos.column,
      })
    }
    editor.focus()
  }

  function buildAmbientDts(): string {
    const p = propsRef.current
    const parts: string[] = []

    for (const field of p.dataFields ?? []) {
      const name = field.name.trim()
      if (!name || !isValidIdent(name)) continue
      if (name === '$props' || name === '$query' || name === '$route') continue
      parts.push(`declare const ${name}: ${dataFieldToTsType(field)};`)
    }

    if (p.componentProps != null) {
      parts.push(buildDollarPropsAmbientDeclaration(p.componentProps))
    }

    const queryDefs =
      p.pageQueryParams ??
      Object.keys(p.routeParams ?? {}).map(
        (name): PageQueryParamDef => ({
          name,
          type: 'string',
          remark: '',
        }),
      )
    parts.push(buildDollarQueryAmbientDeclaration(queryDefs))

    if (p.repeatListName?.trim()) {
      const repeat = p.repeatListName.trim()
      const field = (p.dataFields ?? []).find((f) => f.name.trim() === repeat)
      let itemTs = 'any'
      if (field?.type === 'array') {
        const arrTs = dataFieldToTsType(field)
        const m = arrTs.match(/^(.*)\[]$/)
        itemTs = m?.[1]?.trim() || 'any'
      }
      parts.push(`declare const index: number;`)
      parts.push(`declare const item: ${itemTs};`)
    }

    parts.push(buildDollarColorAmbientDeclaration(getColorPaletteState()))

    return parts.filter((line) => line.trim()).join('\n')
  }

  function indentExpr(expr: string): string {
    const lines = (expr ?? '').replace(/\r\n/g, '\n').split('\n')
    if (!lines.length) return ''
    return lines
      .map((line, i) => {
        if (i === 0) return line
        return line.length ? `    ${line}` : ''
      })
      .join('\n')
  }

  function composeFull(expr: string): string {
    const body = indentExpr(expr)
    return `${SHELL_OPEN}\n${RETURN_PREFIX}${body}\n${SHELL_CLOSE}`
  }

  function extractExpr(full: string): string {
    const lines = full.replace(/\r\n/g, '\n').split('\n')
    if (lines.length < 3) return ''
    const mid = lines.slice(1, -1)
    if (!mid.length) return ''
    const first = mid[0] ?? ''
    if (!first.startsWith(RETURN_PREFIX)) {
      return mid.map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n')
    }
    const head = first.slice(RETURN_PREFIX.length)
    const rest = mid.slice(1).map((l) => (l.startsWith('    ') ? l.slice(4) : l))
    return [head, ...rest].join('\n')
  }

  function shellIntact(full: string): boolean {
    const lines = full.replace(/\r\n/g, '\n').split('\n')
    if (lines.length < 3) return false
    if (lines[0] !== SHELL_OPEN) return false
    if (lines[lines.length - 1] !== SHELL_CLOSE) return false
    return (lines[1] ?? '').startsWith(RETURN_PREFIX)
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
          className: 'attr-shell-readonly',
          marginClassName: 'attr-shell-readonly-margin',
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
      {
        range: new monaco.Range(2, 1, 2, RETURN_PREFIX.length + 1),
        options: {
          className: 'attr-shell-readonly',
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
    ]
    if (last >= 3) {
      ranges.push({
        range: new monaco.Range(last, 1, last, Number.MAX_SAFE_INTEGER),
        options: {
          isWholeLine: true,
          className: 'attr-shell-readonly',
          marginClassName: 'attr-shell-readonly-margin',
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

  function syncAmbientLib() {
    ambientLibRef.current?.dispose()
    ambientLibRef.current = null
    const dts = buildAmbientDts()
    if (!dts.trim()) return
    ambientLibSeqRef.current += 1
    ambientLibRef.current = tsLang.typescriptDefaults.addExtraLib(
      dts,
      `inmemory://luban/attr-bind-ambient-${ambientLibSeqRef.current}.d.ts`,
    )
  }

  function restoreShell(expr?: string, preserveCursor = true) {
    const model = modelRef.current
    const editor = editorRef.current
    if (!model || !editor) return
    syncAmbientLib()
    const nextExpr =
      expr ?? (extractExpr(lastValidFullRef.current) || exprDraftRef.current || '')
    const full = composeFull(nextExpr)
    if (full === model.getValue()) {
      lastValidFullRef.current = full
      applyShellDecorations()
      return
    }
    const pos = preserveCursor ? editor.getPosition() : null
    syncingRef.current = true
    model.setValue(full)
    lastValidFullRef.current = full
    syncingRef.current = false
    applyShellDecorations()
    if (pos) {
      const last = model.getLineCount()
      const line = Math.min(Math.max(pos.lineNumber, 2), Math.max(2, last - 1))
      const minCol = line === 2 ? RETURN_PREFIX.length + 1 : 1
      const maxCol = model.getLineMaxColumn(line)
      editor.setPosition({
        lineNumber: line,
        column: Math.min(Math.max(pos.column, minCol), maxCol),
      })
    }
  }

  function disposeEditor() {
    ambientLibRef.current?.dispose()
    ambientLibRef.current = null
    editorRef.current?.dispose()
    modelRef.current?.dispose()
    editorRef.current = null
    modelRef.current = null
    shellDecorationsRef.current = []
  }

  function createEditor() {
    if (!hostRef.current || editorRef.current) return

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
    const initial = composeFull(exprDraftRef.current)
    lastValidFullRef.current = initial

    modelRef.current = monaco.editor.createModel(
      initial,
      'typescript',
      monaco.Uri.parse(`inmemory://luban/attr-bind-${Date.now()}.ts`),
    )
    editorRef.current = monaco.editor.create(hostRef.current, {
      model: modelRef.current,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'on',
      theme: 'vs',
      fixedOverflowWidgets: true,
      hover: { enabled: true, above: false },
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
      snippetSuggestions: 'inline',
    })

    applyShellDecorations()

    modelRef.current.onDidChangeContent(() => {
      const model = modelRef.current
      if (syncingRef.current || !model) return
      const full = model.getValue()
      if (!shellIntact(full)) {
        restoreShell()
        return
      }
      lastValidFullRef.current = full
      applyShellDecorations()
      setExprDraft(extractExpr(full))
    })

    editorRef.current.onDidChangeCursorSelection(() => {
      clampSelectionToEditable()
    })

    editorRef.current.onKeyDown((e) => {
      if (
        e.keyCode === monaco.KeyCode.Tab ||
        e.keyCode === monaco.KeyCode.Space
      ) {
        e.browserEvent.stopPropagation()
      }
    })
  }

  function resetFromAttr() {
    const raw = String(attrValue ?? '')
    const inner = unwrapWholeBinding(raw)

    if (initialKind === 'literal' && inner == null) {
      setKind('literal')
      setLiteralDraft(raw)
      setExprDraft('')
      return 'literal'
    }

    if (inner != null) {
      setKind('expression')
      setLiteralDraft('')
      setExprDraft(inner)
      return 'expression'
    }

    const nextKind = initialKind === 'expression' ? 'expression' : 'literal'
    setKind(nextKind)
    if (nextKind === 'literal') {
      setLiteralDraft(raw)
      setExprDraft('')
    } else {
      setLiteralDraft('')
      setExprDraft(raw)
    }
    return nextKind
  }

  useEffect(() => {
    if (!open) {
      disposeEditor()
      return
    }
    const nextKind = resetFromAttr()
    const id = requestAnimationFrame(() => {
      if (nextKind === 'expression') createEditor()
    })
    return () => {
      cancelAnimationFrame(id)
      disposeEditor()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    if (kind === 'expression') {
      const id = requestAnimationFrame(() => {
        if (!editorRef.current) createEditor()
        else restoreShell(exprDraftRef.current, false)
      })
      return () => cancelAnimationFrame(id)
    }
    if (editorRef.current && modelRef.current) {
      setExprDraft(extractExpr(modelRef.current.getValue()))
    }
    disposeEditor()
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const effectiveType: DataFieldType = valueType || 'string'

  const literalNumberModel = useMemo(() => {
    const raw = literalDraft.trim()
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }, [literalDraft])

  const literalBoolModel = useMemo(() => {
    const raw = literalDraft.trim().toLowerCase()
    return raw === 'true' || raw === '1'
  }, [literalDraft])

  function handleSave() {
    if (kind === 'literal') {
      onSave?.(literalDraft.trim())
    } else {
      const expr =
        editorRef.current && modelRef.current
          ? extractExpr(modelRef.current.getValue()).trim()
          : exprDraft.trim()
      onSave?.(expr ? `{${expr}}` : '')
    }
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={title || '编辑属性值'}
      width={860}
      destroyOnHidden
      maskClosable={false}
      className="attr-bind-expr-dialog"
      onCancel={() => onOpenChange?.(false)}
      footer={
        <>
          <Button onClick={() => onOpenChange?.(false)}>取消</Button>
          <Button type="primary" onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <div className="form-rows">
        <div className="form-row">
          <span className="row-label">类型</span>
          <div className="row-value">
            <Radio.Group
              value={kind}
              size="small"
              optionType="button"
              onChange={(e) => setKind(e.target.value)}
            >
              <Radio.Button value="literal">常量</Radio.Button>
              <Radio.Button value="expression">自定义</Radio.Button>
            </Radio.Group>
          </div>
        </div>

        <div className="form-row form-row--editor">
          <span className="row-label">值</span>
          <div className="row-value">
            {kind === 'literal' ? (
              effectiveType === 'color' ? (
                <ColorPicker
                  value={literalDraft}
                  compact
                  placeholder="选择颜色"
                  onChange={setLiteralDraft}
                />
              ) : effectiveType === 'number' ? (
                <InputNumber
                  value={literalNumberModel}
                  className="literal-input"
                  size="small"
                  placeholder="数字"
                  onChange={(next) =>
                    setLiteralDraft(
                      next == null || Number.isNaN(Number(next))
                        ? ''
                        : String(next),
                    )
                  }
                />
              ) : effectiveType === 'boolean' ? (
                <Switch
                  size="small"
                  checked={literalBoolModel}
                  onChange={(checked) =>
                    setLiteralDraft(checked ? 'true' : 'false')
                  }
                />
              ) : effectiveType === 'time' ||
                effectiveType === 'date' ||
                effectiveType === 'datetime' ? (
                <DateTimeValueInput
                  value={literalDraft}
                  kind={effectiveType}
                  size="small"
                  onChange={setLiteralDraft}
                />
              ) : effectiveType === 'icon' ? (
                <IconValueSelect
                  value={literalDraft}
                  size="small"
                  options={iconOptions ?? []}
                  allowCreate
                  placeholder="选择图标"
                  onChange={setLiteralDraft}
                />
              ) : effectiveType === 'json' ||
                effectiveType === 'map' ||
                effectiveType === 'array' ? (
                <Input.TextArea
                  value={literalDraft}
                  size="small"
                  rows={8}
                  className="literal-input"
                  placeholder={
                    effectiveType === 'array'
                      ? 'JSON 数组，如 []'
                      : 'JSON 对象，如 {}'
                  }
                  spellCheck={false}
                  onChange={(e) => setLiteralDraft(e.target.value)}
                />
              ) : (
                <Input
                  value={literalDraft}
                  className="literal-input"
                  size="small"
                  placeholder="常量值"
                  spellCheck={false}
                  onChange={(e) => setLiteralDraft(e.target.value)}
                />
              )
            ) : null}
            <div
              className="expr-split"
              style={{ display: kind === 'expression' ? undefined : 'none' }}
            >
              <div ref={hostRef} className="expr-editor nokey" />
              <aside className="suggest-pane">
                <div className="suggest-title">变量</div>
                {!suggestGroups.length ? (
                  <div className="suggest-empty">暂无可用变量</div>
                ) : (
                  <div className="suggest-scroll">
                    {suggestGroups.map((group) => (
                      <div key={group.group} className="suggest-group">
                        <div className="suggest-group-name">{group.group}</div>
                        {group.items.map((item) => (
                          <button
                            key={item.insert}
                            type="button"
                            className="suggest-item"
                            title={item.insert}
                            onClick={() => insertAtCursor(item.insert)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
