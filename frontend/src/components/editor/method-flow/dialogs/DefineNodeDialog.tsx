import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Input, Modal } from 'antd'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { DataFieldType } from '../../../../types/page-data'
import type { MethodParamType } from '../../../../types/page-method'
import {
  buildTypeLibraryAmbientDeclarations,
  processorTypeExprToTs,
} from '../../../../types/page-method'
import { findDataTypeDef } from '../../../../utils/named-type-fields'
import {
  applyPayloadToGenericArgs,
  dataFieldToMethodParamType,
  FLOW_TYPE_EXCLUDE,
  flowDraftToTypeExpr,
  leafNamedRefFromDraft,
  leafNamedRefFromPayload,
  methodTypeToDataField,
  type FlowTypeSelectPayload,
} from '../../../../utils/flow-type-select'
import {
  composeSingleLetDeclaration,
  parseSingleLetDeclaration,
} from '../../../../utils/parse-single-let-decl'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect'
import TypeGenericArgsDialog from '../../TypeGenericArgsDialog'
import FlowPrintField from '../FlowPrintField'
import './DefineNodeDialog.css'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
  {
    getWorker(_: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }

const tsLang = (monaco.languages as any).typescript

export type DefineNodeForm = {
  varName: string
  valueType: MethodParamType
  valueTypeRef: string
  valueItemType: string
  valueItemTypeRef: string
  valueItemItemType: string
  valueItemItemTypeRef: string
  valueGenericArgs: Record<string, string>
  initExpr: string
  description: string
  printExpr: string
}

const EMPTY_FORM: DefineNodeForm = {
  varName: '',
  valueType: 'any',
  valueTypeRef: '',
  valueItemType: '',
  valueItemTypeRef: '',
  valueItemItemType: '',
  valueItemItemTypeRef: '',
  valueGenericArgs: {},
  initExpr: '',
  description: '',
  printExpr: '',
}

function readGenericArgs(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export default function DefineNodeDialog({
  open,
  onOpenChange,
  form,
  typeLibrary,
  reservedNames,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: DefineNodeForm
  typeLibrary?: DataTypeLibrary | null
  reservedNames: string[]
  onSave?: (form: DefineNodeForm) => void
}) {
  const [draft, setDraft] = useState<DefineNodeForm>({ ...EMPTY_FORM })
  const [codeError, setCodeError] = useState('')
  const [genericDialogVisible, setGenericDialogVisible] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const ambientLibRef = useRef<monaco.IDisposable | null>(null)
  const syncingRef = useRef(false)
  const suppressVarNameWatchRef = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const typeLibraryRef = useRef(typeLibrary)
  typeLibraryRef.current = typeLibrary

  function genericNamesOf(typeRef: string): string[] {
    return (findDataTypeDef(typeLibrary, typeRef)?.generics ?? [])
      .map((g) => g.name.trim())
      .filter(Boolean)
  }

  const treeType = useMemo(
    (): DataFieldType | 'void' =>
      methodTypeToDataField(draft.valueType, draft.valueTypeRef),
    [draft.valueType, draft.valueTypeRef],
  )

  const treeItemType = (draft.valueItemType || undefined) as
    | DataFieldType
    | undefined
  const treeItemItemType = (draft.valueItemItemType || undefined) as
    | DataFieldType
    | undefined

  const leafNamed = useMemo(
    () =>
      leafNamedRefFromDraft({
        type: draft.valueType,
        typeRef: draft.valueTypeRef,
        itemType: draft.valueItemType,
        itemTypeRef: draft.valueItemTypeRef,
        itemItemType: draft.valueItemItemType,
        itemItemTypeRef: draft.valueItemItemTypeRef,
      }),
    [
      draft.valueType,
      draft.valueTypeRef,
      draft.valueItemType,
      draft.valueItemTypeRef,
      draft.valueItemItemType,
      draft.valueItemItemTypeRef,
    ],
  )

  const valueGenericNames = useMemo(
    () => genericNamesOf(leafNamed),
    [leafNamed, typeLibrary],
  )
  const hasValueGenerics = valueGenericNames.length > 0

  const valueTypeName = useMemo(() => {
    if (!leafNamed) return ''
    return findDataTypeDef(typeLibrary, leafNamed)?.name?.trim() || ''
  }, [leafNamed, typeLibrary])

  const genericTypeOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        const name = t.name.trim()
        if (!name) continue
        opts.push({
          id: t.id,
          label: t.remark ? `${name} · ${t.remark}` : name,
        })
      }
    }
    return opts
  }, [typeLibrary])

  const valueTypeTs = useMemo(
    () =>
      processorTypeExprToTs(
        flowDraftToTypeExpr({
          type: draft.valueType,
          typeRef: draft.valueTypeRef,
          itemType: draft.valueItemType,
          itemTypeRef: draft.valueItemTypeRef,
          itemItemType: draft.valueItemItemType,
          itemItemTypeRef: draft.valueItemItemTypeRef,
          genericArgs: draft.valueGenericArgs,
        }),
        typeLibrary,
      ),
    [
      draft.valueType,
      draft.valueTypeRef,
      draft.valueItemType,
      draft.valueItemTypeRef,
      draft.valueItemItemType,
      draft.valueItemItemTypeRef,
      draft.valueGenericArgs,
      typeLibrary,
    ],
  )
  const valueTypeTsRef = useRef(valueTypeTs)
  valueTypeTsRef.current = valueTypeTs

  function handleValueTypeChange(payload: FlowTypeSelectPayload) {
    if (payload.type === 'void') return
    const prevNamed = leafNamed
    const named = leafNamedRefFromPayload(payload)
    const names = genericNamesOf(named)
    setDraft((d) => ({
      ...d,
      valueType: dataFieldToMethodParamType(payload.type),
      valueTypeRef: payload.typeRef ?? '',
      valueItemType: payload.itemType ?? '',
      valueItemTypeRef: payload.itemTypeRef ?? '',
      valueItemItemType: payload.itemItemType ?? '',
      valueItemItemTypeRef: payload.itemItemTypeRef ?? '',
      valueGenericArgs: applyPayloadToGenericArgs(
        payload,
        prevNamed,
        d.valueGenericArgs,
        names,
      ),
    }))
    if (named && names.length && named !== prevNamed) {
      setGenericDialogVisible(true)
    }
  }

  const varNameError = useMemo(() => {
    const name = draft.varName.trim()
    if (!name) return '请填写变量名'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return '变量名须为合法标识符'
    }
    if (reservedNames.includes(name)) {
      return '与方法入参或其他节点变量重名'
    }
    return ''
  }, [draft.varName, reservedNames])

  function readEditorSource(): string {
    return modelRef.current?.getValue() ?? ''
  }

  function writeEditorSource(source: string) {
    const model = modelRef.current
    if (!model) return
    if (model.getValue() === source) return
    syncingRef.current = true
    model.setValue(source)
    syncingRef.current = false
  }

  function rebuildLetSource() {
    const parsed = parseSingleLetDeclaration(readEditorSource())
    const d = draftRef.current
    const init = parsed.ok ? parsed.initExpr : d.initExpr || 'null'
    writeEditorSource(
      composeSingleLetDeclaration(d.varName, init, valueTypeTsRef.current),
    )
  }

  function syncAmbientLib() {
    ambientLibRef.current?.dispose()
    ambientLibRef.current = null
    const dts = buildTypeLibraryAmbientDeclarations(typeLibraryRef.current).trim()
    if (!dts) return
    ambientLibRef.current = tsLang.typescriptDefaults.addExtraLib(
      dts,
      `inmemory://luban/define-ambient-${Date.now()}.d.ts`,
    )
  }

  function disposeEditor() {
    ambientLibRef.current?.dispose()
    ambientLibRef.current = null
    editorRef.current?.dispose()
    modelRef.current?.dispose()
    editorRef.current = null
    modelRef.current = null
  }

  function setupEditor() {
    disposeEditor()
    if (!hostRef.current) return

    tsLang.typescriptDefaults.setCompilerOptions({
      target: tsLang.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
      module: tsLang.ModuleKind.ESNext,
      noEmit: true,
      strict: false,
    })
    tsLang.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })

    syncAmbientLib()

    const d = draftRef.current
    const initial = composeSingleLetDeclaration(
      d.varName,
      d.initExpr,
      valueTypeTsRef.current,
    )
    const model = monaco.editor.createModel(
      initial,
      'typescript',
      monaco.Uri.parse(`inmemory://luban/define-${Date.now()}.ts`),
    )
    modelRef.current = model
    const editor = monaco.editor.create(hostRef.current, {
      model,
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
    })
    editorRef.current = editor

    editor.onKeyDown((e) => {
      if (
        e.keyCode === monaco.KeyCode.Tab ||
        e.keyCode === monaco.KeyCode.Space
      ) {
        e.browserEvent.stopPropagation()
      }
    })

    model.onDidChangeContent(() => {
      if (syncingRef.current) return
      setCodeError('')
      const parsed = parseSingleLetDeclaration(readEditorSource())
      if (!parsed.ok) return
      if (parsed.varName !== draftRef.current.varName.trim()) {
        suppressVarNameWatchRef.current = true
        setDraft((cur) => ({ ...cur, varName: parsed.varName }))
        queueMicrotask(() => {
          suppressVarNameWatchRef.current = false
        })
      }
    })
  }

  useEffect(() => {
    if (!open) {
      disposeEditor()
      setCodeError('')
      return
    }
    const next: DefineNodeForm = {
      ...form,
      valueItemType: form.valueItemType ?? '',
      valueItemTypeRef: form.valueItemTypeRef ?? '',
      valueItemItemType: form.valueItemItemType ?? '',
      valueItemItemTypeRef: form.valueItemItemTypeRef ?? '',
      valueGenericArgs: { ...readGenericArgs(form.valueGenericArgs) },
    }
    if (!next.initExpr.trim()) next.initExpr = 'null'
    setDraft(next)
    draftRef.current = next
  }, [open, form])

  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => setupEditor())
    return () => {
      window.cancelAnimationFrame(id)
      disposeEditor()
    }
  }, [open])

  useEffect(() => {
    if (!modelRef.current || suppressVarNameWatchRef.current) return
    rebuildLetSource()
  }, [draft.varName])

  useEffect(() => {
    if (!modelRef.current) return
    rebuildLetSource()
  }, [
    draft.valueType,
    draft.valueTypeRef,
    draft.valueItemType,
    draft.valueItemTypeRef,
    draft.valueItemItemType,
    draft.valueItemItemTypeRef,
    draft.valueGenericArgs,
  ])

  useEffect(() => () => disposeEditor(), [])

  function openGenerics() {
    if (!hasValueGenerics) return
    setGenericDialogVisible(true)
  }

  function saveGenericArgs(args: Record<string, string>) {
    setDraft((d) => ({ ...d, valueGenericArgs: { ...args } }))
  }

  function handleSave() {
    setCodeError('')
    if (varNameError) return

    const parsed = parseSingleLetDeclaration(readEditorSource())
    if (!parsed.ok) {
      setCodeError(parsed.errors[0] || '语法错误')
      return
    }

    if (parsed.varName !== draft.varName.trim()) {
      setCodeError(`代码中的变量名「${parsed.varName}」与上方变量名不一致`)
      return
    }

    if (reservedNames.includes(parsed.varName)) {
      setCodeError('与方法入参或其他节点变量重名')
      return
    }

    onSave?.({
      varName: parsed.varName,
      valueType: draft.valueTypeRef ? 'object' : draft.valueType || 'any',
      valueTypeRef: draft.valueTypeRef,
      valueItemType: draft.valueItemType,
      valueItemTypeRef: draft.valueItemTypeRef,
      valueItemItemType: draft.valueItemItemType,
      valueItemItemTypeRef: draft.valueItemItemTypeRef,
      valueGenericArgs: leafNamed ? { ...(draft.valueGenericArgs ?? {}) } : {},
      initExpr: parsed.initExpr,
      description: draft.description.trim(),
      printExpr: draft.printExpr.trim(),
    })
    onOpenChange?.(false)
  }

  function stopEditorKeys(event: React.KeyboardEvent) {
    if (event.key === ' ' || event.key === 'Tab' || event.code === 'Space') {
      event.stopPropagation()
    }
  }

  return (
    <>
      <Modal
        open={open}
        title="编辑定义数据节点"
        width={560}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => onOpenChange?.(false)}
        footer={
          <Button
            type="primary"
            disabled={Boolean(varNameError)}
            onClick={handleSave}
          >
            确定
          </Button>
        }
      >
        <Form
          className="flow-node-form"
          labelAlign="right"
          labelCol={{ flex: '110px' }}
          wrapperCol={{ flex: 1 }}
        >
          <Form.Item
            label="变量名"
            required
            validateStatus={varNameError ? 'error' : undefined}
            help={varNameError || undefined}
          >
            <Input
              value={draft.varName}
              placeholder="如 goodsPage"
              maxLength={64}
              onChange={(e) =>
                setDraft((d) => ({ ...d, varName: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="类型" required>
            <div className="type-row">
              <DataFieldTypeTreeSelect
                className="type-select"
                type={treeType === 'void' ? 'any' : treeType}
                typeRef={draft.valueTypeRef || undefined}
                itemType={treeItemType}
                itemTypeRef={draft.valueItemTypeRef || undefined}
                itemItemType={treeItemItemType}
                itemItemTypeRef={draft.valueItemItemTypeRef || undefined}
                library={typeLibrary}
                excludeTypes={FLOW_TYPE_EXCLUDE}
                allowRef={false}
                placeholder="选择类型"
                onChange={handleValueTypeChange}
              />
              {hasValueGenerics ? (
                <>
                  <Button type="link" onClick={openGenerics}>
                    泛型
                  </Button>
                  <span className="type-preview" title={valueTypeTs}>
                    {valueTypeTs}
                  </span>
                </>
              ) : null}
            </div>
          </Form.Item>
          <Form.Item
            label="初始值"
            required
            validateStatus={codeError ? 'error' : undefined}
            help={codeError || undefined}
          >
            <div
              className="editor-wrap nokey"
              onKeyDown={stopEditorKeys}
              onKeyUp={stopEditorKeys}
            >
              {open ? <div ref={hostRef} className="let-editor" /> : null}
            </div>
          </Form.Item>
          <Form.Item label="说明">
            <Input
              value={draft.description}
              maxLength={80}
              showCount
              placeholder="显示在流程节点上"
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="打印">
            <FlowPrintField
              value={draft.printExpr}
              onChange={(printExpr) => setDraft((d) => ({ ...d, printExpr }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <TypeGenericArgsDialog
        open={genericDialogVisible}
        onOpenChange={setGenericDialogVisible}
        typeName={valueTypeName}
        genericNames={valueGenericNames}
        args={draft.valueGenericArgs}
        typeOptions={genericTypeOptions}
        onSave={saveGenericArgs}
      />
    </>
  )
}
