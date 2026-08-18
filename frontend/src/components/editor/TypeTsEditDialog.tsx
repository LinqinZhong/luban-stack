import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import * as monaco from 'monaco-editor'
import { ElMessage } from '../../ui/feedback'
import {
  buildAmbientDeclarations,
  buildDataTypeTsContext,
  collectReferencedTypeNames,
  dataTypeToTs,
  parseDataTypeFromTs,
  validateTypeScriptSyntax,
  type DataTypeTsContext,
} from '../../utils/data-type-ts'
import {
  isValidTypeName,
  type DataTypeDef,
  type DataTypeLibrary,
} from '../../types/data-types'
import { monacoTsLang } from '../../utils/monaco-languages'
import './TypeTsEditDialog.css'

export default function TypeTsEditDialog({
  open,
  onOpenChange,
  typeDef,
  library,
  readonly,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  typeDef: DataTypeDef | null
  library: DataTypeLibrary
  readonly?: boolean
  onSave?: (def: DataTypeDef) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const ambientLibRef = useRef<monaco.IDisposable | null>(null)
  const mountGenRef = useRef(0)
  const typeDefRef = useRef(typeDef)
  const libraryRef = useRef(library)
  const readonlyRef = useRef(readonly)
  typeDefRef.current = typeDef
  libraryRef.current = library
  readonlyRef.current = readonly
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null)
  const [errorText, setErrorText] = useState('')

  const title = useMemo(
    () =>
      `${readonly ? '查看' : '编辑'} TypeScript · ${typeDef?.name || '未命名'}`,
    [readonly, typeDef?.name],
  )

  function buildCtx(): DataTypeTsContext {
    return buildDataTypeTsContext(libraryRef.current)
  }

  function allTypeNames(): string[] {
    const names: string[] = []
    for (const g of libraryRef.current.groups) {
      for (const t of g.types) {
        if (t.name.trim()) names.push(t.name.trim())
      }
    }
    return names
  }

  function disposeEditor() {
    mountGenRef.current += 1
    ambientLibRef.current?.dispose()
    editorRef.current?.dispose()
    modelRef.current?.dispose()
    ambientLibRef.current = null
    editorRef.current = null
    modelRef.current = null
  }

  function setupEditor(): boolean {
    const host = hostRef.current ?? hostEl
    const def = typeDefRef.current
    if (!host || !def) return false
    if (editorRef.current) {
      editorRef.current.layout()
      return true
    }

    setErrorText('')
    const ctx = buildCtx()
    const initial = dataTypeToTs(def, ctx).replace(/\n$/, '')

    const ambient = buildAmbientDeclarations(allTypeNames(), def.name.trim())
    const tsLang = monacoTsLang
    tsLang.typescriptDefaults.setCompilerOptions({
      target: tsLang.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
      module: tsLang.ModuleKind.ESNext,
      noEmit: true,
      strict: true,
    })
    tsLang.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })

    const stamp = Date.now()
    if (ambient.trim()) {
      ambientLibRef.current = tsLang.typescriptDefaults.addExtraLib(
        ambient,
        `inmemory://luban/types-ambient-${stamp}.d.ts`,
      )
    }

    modelRef.current = monaco.editor.createModel(
      initial,
      'typescript',
      monaco.Uri.parse(`inmemory://luban/type-edit-${stamp}.ts`),
    )

    editorRef.current = monaco.editor.create(host, {
      model: modelRef.current,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      tabSize: 2,
      wordWrap: 'on',
      theme: 'vs',
      readOnly: Boolean(readonlyRef.current),
    })

    requestAnimationFrame(() => editorRef.current?.layout())

    modelRef.current.onDidChangeContent(() => {
      setErrorText('')
    })
    return true
  }

  function mountWhenReady() {
    const gen = ++mountGenRef.current
    let attempts = 0
    const tick = () => {
      if (gen !== mountGenRef.current) return
      if (setupEditor()) return
      if (attempts++ < 30) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  useEffect(() => {
    hostRef.current = hostEl
    if (!open) {
      disposeEditor()
      setErrorText('')
      return
    }
    if (!hostEl) return
    mountWhenReady()
  }, [open, hostEl])

  useEffect(() => () => disposeEditor(), [])

  function close() {
    onOpenChange?.(false)
  }

  async function save() {
    if (!typeDef || readonly) return
    const source = `${(modelRef.current?.getValue() ?? '').trim()}\n`
    if (!source.trim()) {
      setErrorText('代码不能为空')
      ElMessage.error('代码不能为空')
      return
    }

    const syntaxErrors = validateTypeScriptSyntax(source)
    if (syntaxErrors.length) {
      setErrorText(syntaxErrors.join('\n'))
      ElMessage.error('语法错误，无法保存')
      return
    }

    const ctx = buildCtx()
    const parsed = parseDataTypeFromTs(source, {
      existing: typeDef,
      ctx,
    })
    if (!parsed.ok) {
      setErrorText(parsed.errors.join('\n'))
      ElMessage.error('无法解析为类型结构')
      return
    }

    const newName = parsed.def.name.trim()
    if (!isValidTypeName(newName)) {
      const msg = `类型名不合法：${newName || '(空)'}`
      setErrorText(msg)
      ElMessage.error(msg)
      return
    }

    const dup = [...ctx.nameToId.entries()].some(
      ([name, id]) => name === newName && id !== typeDef.id,
    )
    if (dup) {
      const msg = `类型名「${newName}」已存在`
      setErrorText(msg)
      ElMessage.error(msg)
      return
    }

    const genericNames = parsed.def.generics.map((g) => g.name)
    const refs = collectReferencedTypeNames(source, genericNames)
    const known = new Set(allTypeNames())
    known.delete(typeDef.name.trim())
    known.add(newName)
    const missing = refs.filter((n) => !known.has(n))
    if (missing.length) {
      setErrorText(missing.map((n) => `类型「${n}」不存在`).join('\n'))
      ElMessage.error('存在未定义的类型引用')
      return
    }

    onSave?.(parsed.def)
    close()
    ElMessage.success('已保存并同步到结构')
  }

  return (
    <Modal
      open={open}
      title={title}
      width={720}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={close}
      afterOpenChange={(visible) => {
        if (visible) {
          mountWhenReady()
          requestAnimationFrame(() => editorRef.current?.layout())
        }
      }}
      footer={
        readonly ? (
          <Button onClick={close}>关闭</Button>
        ) : (
          <Button type="primary" onClick={save}>
            保存
          </Button>
        )
      }
    >
      <div className="hint">
        {readonly
          ? '系统预设类型，仅可查看 TypeScript 定义。'
          : '可直接修改类型名与成员。保存时解析回结构；语法错误、重名或引用不存在的类型将无法保存。'}
      </div>
      <div ref={setHostEl} className="ts-host" />
      {errorText ? <div className="errors">{errorText}</div> : null}
    </Modal>
  )
}
