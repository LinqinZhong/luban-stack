import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tooltip,
} from 'antd'
import {
  CaretRightOutlined,
  EditOutlined,
  LeftOutlined,
  RightOutlined,
  AimOutlined,
} from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import type {
  MethodFlow,
  ProcessorMethod,
  ProcessorMethodParam,
  ProcessorTypeExpr,
  ServiceProcessor,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import type { DataTypeDef, InterfaceField, TypeExpr } from '../../types/data-types'
import {
  ambientTypeLabel,
  ambientVarsAtNode,
  BusinessException,
  findStartNode,
  formatAmbientValue,
  extractFlowReturnValue,
  runFlowNext,
  runFlowToEnd,
  runFlowToNode,
  type FlowAmbientVar,
  type FlowDebugSnapshot,
} from './method-flow/method-flow-debug'
import DateTimeValueInput from './DateTimeValueInput'
import './MethodFlowDebugPanel.css'

export type MethodFlowDebugTarget = {
  projectPath: string
  serviceId: string
  processorId: string
  processorName: string
  method: ProcessorMethod
  flow: MethodFlow
  selectedNodeId: string | null
  dataProcessors: ServiceProcessor[]
  businessProcessors?: ServiceProcessor[]
  mode?: 'list' | 'canvas'
}

type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'array'

type ObjectFieldForm = {
  name: string
  remark: string
  kind: FieldKind
  enumOptions: string[]
}

type ParamFormModel = {
  param: ProcessorMethodParam
  mode: 'scalar' | 'object' | 'json'
  typeLabel: string
  kind: FieldKind
  enumOptions: string[]
  fields: ObjectFieldForm[]
}

function useBag<T extends Record<string, unknown>>(initial: T) {
  const bag = useRef(initial)
  const [, bump] = useState(0)
  return {
    get current() {
      return bag.current
    },
    touch() {
      bump((n) => n + 1)
    },
    clear() {
      for (const key of Object.keys(bag.current)) delete bag.current[key]
      bump((n) => n + 1)
    },
  }
}

export default function MethodFlowDebugPanel({
  target,
  typeLibrary,
  onDebugParamsChange,
  onCursorChange,
}: {
  target: MethodFlowDebugTarget | null
  typeLibrary: DataTypeLibrary | null
  onDebugParamsChange?: (params: Record<string, unknown>) => void
  onCursorChange?: (state: {
    cursorNodeId: string | null
    visitedNodeIds: string[]
    printByNode?: Record<string, string>
  }) => void
}) {
  const draft = useBag<Record<string, unknown>>({})
  const paramEnabled = useBag<Record<string, boolean>>({})
  const paramStash = useBag<Record<string, unknown>>({})
  const [localScope, setLocalScope] = useState<Record<string, unknown>>({})
  const [dryRun, setDryRun] = useState(true)
  const [running, setRunning] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [history, setHistory] = useState<FlowDebugSnapshot[]>([])
  const [snapshot, setSnapshot] = useState<FlowDebugSnapshot | null>(null)
  const [listResult, setListResult] = useState<unknown>(undefined)
  const [listResultReady, setListResultReady] = useState(false)
  const [listResultError, setListResultError] = useState('')
  const [listResultFoldOpen, setListResultFoldOpen] = useState(false)
  const foldOpen = useBag<Record<string, boolean>>({})

  const isListMode = (target?.mode ?? 'canvas') === 'list'
  const FOLD_MAX_LINES = 10
  const FOLD_MAX_CHARS = 480

  function isLongText(text: string): boolean {
    if (!text || text === '—') return false
    if (text.length > FOLD_MAX_CHARS) return true
    return text.split('\n').length > FOLD_MAX_LINES
  }

  function isFoldExpanded(key: string): boolean {
    return foldOpen.current[key] === true
  }

  function toggleFold(key: string) {
    foldOpen.current[key] = !foldOpen.current[key]
    foldOpen.touch()
  }

  function previewValue(value: unknown): string {
    if (value === undefined) return '—'
    if (value === null) return 'null'
    if (typeof value === 'string') return value === '' ? '""' : value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      const text = JSON.stringify(value)
      return text.length > 120 ? `${text.slice(0, 120)}…` : text
    } catch {
      return String(value)
    }
  }

  function formatJson(value: unknown): string {
    if (value === undefined) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  function valueTextOf(value: unknown): string {
    return previewValue(value)
  }

  function ambientTextOf(item: { hasValue: boolean; value?: unknown }): string {
    return item.hasValue ? formatAmbientValue(item.value) : '未赋值'
  }

  const [paramDialogVisible, setParamDialogVisible] = useState(false)
  const [editingParamForm, setEditingParamForm] = useState<ParamFormModel | null>(null)
  const paramEditDraft = useBag<Record<string, unknown>>({})
  const [paramEditScalar, setParamEditScalar] = useState<unknown>('')
  const [paramEditJson, setParamEditJson] = useState('')

  const [ambientDialogVisible, setAmbientDialogVisible] = useState(false)
  const [editingAmbient, setEditingAmbient] = useState<FlowAmbientVar | null>(null)
  const [ambientEditJson, setAmbientEditJson] = useState('')
  const [ambientEditScalar, setAmbientEditScalar] = useState('')
  const [ambientEditIsJson, setAmbientEditIsJson] = useState(false)

  const ambientEditDateKind: 'time' | 'date' | 'datetime' | '' = (() => {
    const t = editingAmbient?.typeExpr?.type
    if (t === 'time' || t === 'date' || t === 'datetime') return t
    return ''
  })()

  const method = target?.method ?? null

  function defaultForKind(kind: FieldKind): unknown {
    switch (kind) {
      case 'number':
        return 0
      case 'boolean':
        return false
      case 'array':
        return []
      case 'json':
        return {}
      default:
        return ''
    }
  }

  function primaryAtom(expr: TypeExpr | undefined | null) {
    return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
  }

  function fieldKindFromTypeExpr(
    expr: TypeExpr,
    library: DataTypeLibrary | null,
  ): { kind: FieldKind; enumOptions: string[] } {
    const mapped = typeExprToDataFieldType(expr, library)
    if (mapped.type === 'number') return { kind: 'number', enumOptions: [] }
    if (mapped.type === 'boolean') return { kind: 'boolean', enumOptions: [] }
    if (mapped.type === 'array') return { kind: 'array', enumOptions: [] }
    if (mapped.typeRef) {
      const def = findDataTypeDef(library, mapped.typeRef)
      if (def?.kind === 'enum') {
        return {
          kind: 'enum',
          enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
        }
      }
      if (def?.kind === 'interface') {
        return { kind: 'json', enumOptions: [] }
      }
    }
    const atom = primaryAtom(expr)
    if (atom.kind === 'number') return { kind: 'number', enumOptions: [] }
    if (atom.kind === 'boolean') return { kind: 'boolean', enumOptions: [] }
    return { kind: 'string', enumOptions: [] }
  }

  function objectFieldsOf(def: DataTypeDef | null): ObjectFieldForm[] {
    if (!def || def.kind !== 'interface') return []
    return def.fields
      .map((f: InterfaceField) => {
        const name = f.name.trim()
        if (!name) return null
        const info = fieldKindFromTypeExpr(f.type, typeLibrary)
        return {
          name,
          remark: f.remark?.trim() || '',
          kind: info.kind,
          enumOptions: info.enumOptions,
        }
      })
      .filter((x): x is ObjectFieldForm => Boolean(x))
  }

  function namedTypeLabel(typeRef: string): string {
    if (!typeRef) return ''
    return findDataTypeDef(typeLibrary, typeRef)?.name || typeRef
  }

  function resolveParamForm(param: ProcessorMethodParam): ParamFormModel {
    const expr: ProcessorTypeExpr = param.typeExpr
    if (expr.type === 'array') {
      return {
        param,
        mode: 'json',
        typeLabel: '[]',
        kind: 'array',
        enumOptions: [],
        fields: [],
      }
    }
    const typeLabel = expr.typeRef
      ? namedTypeLabel(expr.typeRef)
      : expr.type === 'json'
        ? 'object'
        : expr.type || 'string'

    if (expr.typeRef || expr.type === 'json') {
      const def = findDataTypeDef(typeLibrary, expr.typeRef)
      if (def?.kind === 'interface') {
        const fields = objectFieldsOf(def)
        if (fields.length) {
          return {
            param,
            mode: 'object',
            typeLabel: def.name || typeLabel,
            kind: 'json',
            enumOptions: [],
            fields,
          }
        }
      }
      if (def?.kind === 'enum') {
        return {
          param,
          mode: 'scalar',
          typeLabel: def.name || typeLabel,
          kind: 'enum',
          enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
          fields: [],
        }
      }
    }

    const t = expr.type || 'string'
    if (t === 'number') {
      return {
        param,
        mode: 'scalar',
        typeLabel,
        kind: 'number',
        enumOptions: [],
        fields: [],
      }
    }
    if (t === 'boolean') {
      return {
        param,
        mode: 'scalar',
        typeLabel,
        kind: 'boolean',
        enumOptions: [],
        fields: [],
      }
    }
    return {
      param,
      mode: 'scalar',
      typeLabel,
      kind: 'string',
      enumOptions: [],
      fields: [],
    }
  }

  const paramForms = useMemo(
    () =>
      (method?.params ?? [])
        .filter((p) => p.name.trim())
        .map((p) => resolveParamForm(p)),
    [method, typeLibrary],
  )

  const paramNameSet = useMemo(
    () => new Set(paramForms.map((f) => f.param.name)),
    [paramForms],
  )

  function buildObjectDefault(fields: ObjectFieldForm[]): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const f of fields) out[f.name] = defaultForKind(f.kind)
    return out
  }

  function disabledParamValue(_form: ParamFormModel): unknown {
    return null
  }

  function defaultEnabledParamValue(form: ParamFormModel): unknown {
    if (form.mode === 'object') return buildObjectDefault(form.fields)
    if (form.mode === 'json') return form.kind === 'array' ? [] : {}
    if (form.kind === 'number') return 0
    if (form.kind === 'boolean') return false
    if (form.kind === 'enum') return form.enumOptions[0] ?? ''
    return ''
  }

  function disabledParamHint(_form: ParamFormModel): string {
    return 'null'
  }

  function isParamEnabled(form: ParamFormModel): boolean {
    return paramEnabled.current[form.param.name.trim()] !== false
  }

  function emitParams() {
    onDebugParamsChange?.({ ...draft.current })
  }

  function setParamEnabledFlag(form: ParamFormModel, enabled: boolean) {
    const name = form.param.name.trim()
    if (enabled) {
      const restored = paramStash.current[name]
      paramEnabled.current[name] = true
      draft.current[name] =
        restored !== undefined ? restored : defaultEnabledParamValue(form)
      delete paramStash.current[name]
    } else {
      if (paramEnabled.current[name] !== false) {
        paramStash.current[name] = draft.current[name]
      }
      paramEnabled.current[name] = false
      draft.current[name] = disabledParamValue(form)
    }
    draft.touch()
    paramEnabled.touch()
    emitParams()
  }

  function emitCursor(snap: FlowDebugSnapshot | null) {
    onCursorChange?.({
      cursorNodeId: snap?.cursorNodeId ?? null,
      visitedNodeIds: snap?.visitedNodeIds ?? [],
      printByNode: snap?.printByNode ?? {},
    })
  }

  function resetSession() {
    setHistory([])
    setSnapshot(null)
    setLocalScope({})
    setErrorText('')
    emitCursor(null)
  }

  function syncDraftFromMethod() {
    draft.clear()
    paramEnabled.clear()
    paramStash.clear()
    setListResult(undefined)
    setListResultReady(false)
    setListResultError('')
    if (!method) return
    const saved = method.debugParams ?? {}
    for (const form of paramForms) {
      const name = form.param.name.trim()
      const prev = saved[name]
      if (Object.prototype.hasOwnProperty.call(saved, name) && prev === null) {
        draft.current[name] = disabledParamValue(form)
        paramEnabled.current[name] = false
        continue
      }
      paramEnabled.current[name] = true
      if (Object.prototype.hasOwnProperty.call(saved, name)) {
        if (form.mode === 'object') {
          const base = buildObjectDefault(form.fields)
          draft.current[name] =
            prev && typeof prev === 'object' && !Array.isArray(prev)
              ? { ...base, ...(prev as Record<string, unknown>) }
              : base
        } else {
          draft.current[name] = prev
        }
        continue
      }
      draft.current[name] = defaultEnabledParamValue(form)
    }
    draft.touch()
    paramEnabled.touch()
  }

  function methodSyncKey(t: MethodFlowDebugTarget | null): string {
    if (!t) return ''
    return `${t.processorId}:${t.method.id}:${t.mode ?? 'canvas'}:${t.method.params
      .map((p) => p.id)
      .join(',')}`
  }

  const syncKey = methodSyncKey(target)
  useEffect(() => {
    syncDraftFromMethod()
    resetSession()
  }, [syncKey])

  const selectedNodeId = target?.selectedNodeId ?? null
  const kindMap: Record<string, string> = {
    start: '开始',
    input: '输入',
    define: '定义数据',
    pageMap: '分页映射',
    objectMap: '对象映射',
    branch: '判断',
    action: '操作',
    output: '输出',
    end: '终止',
    throw: '业务异常',
  }

  function nodeKindLabel(kind: string): string {
    return kindMap[kind] || kind
  }

  function nodeSummaryText(node: {
    kind: string
    data?: Record<string, unknown>
  } | null): string {
    if (!node) return ''
    const data = (node.data ?? {}) as Record<string, unknown>
    const description =
      typeof data.description === 'string' ? data.description.trim() : ''
    if (description) return description
    if (node.kind === 'input') {
      const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
      const methodLabel =
        typeof data.methodLabel === 'string' ? data.methodLabel.trim() : ''
      if (varName && methodLabel) return `${varName} ← ${methodLabel}`
      return varName || methodLabel || ''
    }
    if (node.kind === 'define') {
      const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
      const initExpr = typeof data.initExpr === 'string' ? data.initExpr.trim() : ''
      if (varName && initExpr) return `${varName} = ${initExpr}`
      return varName
    }
    if (node.kind === 'branch') {
      return typeof data.expression === 'string' ? data.expression.trim() : ''
    }
    if (node.kind === 'action') {
      const outputVar =
        typeof data.outputVarName === 'string' ? data.outputVarName.trim() : ''
      return outputVar ? `→ ${outputVar}` : ''
    }
    if (node.kind === 'output') {
      const methodLabel =
        typeof data.methodLabel === 'string' ? data.methodLabel.trim() : ''
      return methodLabel.replace(/（[^）]*）$/, '')
    }
    if (node.kind === 'pageMap') {
      const sourceKind = data.sourceKind === 'array' ? 'array' : 'page'
      const kindLabel = sourceKind === 'array' ? '[]' : '分页'
      const sourcePath =
        typeof data.sourcePath === 'string' ? data.sourcePath.trim() : ''
      const targetVarName =
        (typeof data.targetVarName === 'string' ? data.targetVarName.trim() : '') ||
        (typeof data.targetPath === 'string' ? data.targetPath.trim() : '')
      if (sourcePath && targetVarName) {
        return `${kindLabel} · ${sourcePath} → ${targetVarName}`
      }
      return sourcePath || targetVarName
    }
    if (node.kind === 'objectMap') {
      const sourcePath =
        typeof data.sourcePath === 'string' ? data.sourcePath.trim() : ''
      const targetVarName =
        (typeof data.targetVarName === 'string' ? data.targetVarName.trim() : '') ||
        (typeof data.targetPath === 'string' ? data.targetPath.trim() : '')
      if (sourcePath && targetVarName) {
        return `${sourcePath} → ${targetVarName}`
      }
      return sourcePath || targetVarName
    }
    if (node.kind === 'end') {
      return typeof data.returnExpr === 'string' ? data.returnExpr.trim() : ''
    }
    if (node.kind === 'throw') {
      return typeof data.messageExpr === 'string' ? data.messageExpr.trim() : ''
    }
    return ''
  }

  const selectedNode = (() => {
    const flow = target?.flow
    const id = selectedNodeId
    if (!flow || !id) return null
    return flow.nodes.find((n) => n.id === id) ?? null
  })()

  const viewNodeId = snapshot?.cursorNodeId || selectedNodeId
  const viewNode = (() => {
    const flow = target?.flow
    const id = viewNodeId
    if (!flow || !id) return null
    return flow.nodes.find((n) => n.id === id) ?? null
  })()

  const isStartSelected = (() => {
    const n = viewNode
    if (!n) return false
    return n.kind === 'start' || n.id === 'start'
  })()

  const selectedNodeLabel = selectedNode ? nodeKindLabel(selectedNode.kind) : '未选中节点'
  const cursorNodeTitle = (() => {
    const node = viewNode
    if (!snapshot?.cursorNodeId || !node) return ''
    const kind = nodeKindLabel(node.kind)
    const summary = nodeSummaryText(node)
    return summary ? `${kind} · ${summary}` : kind
  })()

  const effectiveScope = {
    ...draft.current,
    ...localScope,
    ...(snapshot?.scope ?? {}),
  }

  const ambientList = !target
    ? []
    : ambientVarsAtNode({
        flow: target.flow,
        nodeId: viewNodeId,
        methodParams: target.method.params,
        dataProcessors: target.dataProcessors,
        businessProcessors: target.businessProcessors,
        typeLibrary,
        scope: effectiveScope,
      })

  const ambientListView = isStartSelected
    ? ambientList.filter((a) => !paramNameSet.has(a.name))
    : ambientList

  function stepContext() {
    const t = target
    if (!t) throw new Error('无调试目标')
    return {
      projectPath: t.projectPath,
      serviceId: t.serviceId,
      flow: t.flow,
      dataProcessors: t.dataProcessors,
      businessProcessors: t.businessProcessors ?? [],
      dryRun,
    }
  }

  function initialScope(): Record<string, unknown> {
    return { ...draft.current, ...localScope }
  }

  function assertRequiredParams(scope: Record<string, unknown>) {
    for (const form of paramForms) {
      const name = form.param.name.trim()
      if (!name || !form.param.required) continue
      if (!isParamEnabled(form)) {
        throw new BusinessException(`${name}不能为空`)
      }
      const value = scope[name]
      const jsonLike = form.mode === 'object' || form.mode === 'json'
      const missing =
        value === undefined || value === null || (!jsonLike && value === '')
      if (missing) {
        throw new BusinessException(`${name}不能为空`)
      }
    }
  }

  function resultOk<T>(data: T) {
    return { code: 200, message: 'ok', error: '', data }
  }

  function resultFail(message: string, code = 500) {
    return { code, message, error: message, data: null }
  }

  function applyBusinessFail(err: BusinessException) {
    setListResult(resultFail(err.message, err.code))
    setListResultReady(true)
    setListResultFoldOpen(false)
    setListResultError('')
  }

  function setScalar(name: string, value: unknown) {
    draft.current[name] = value
    draft.touch()
    emitParams()
  }

  function setObjectField(paramName: string, fieldName: string, value: unknown) {
    const prev = draft.current[paramName]
    const obj =
      prev && typeof prev === 'object' && !Array.isArray(prev)
        ? { ...(prev as Record<string, unknown>) }
        : {}
    obj[fieldName] = value
    draft.current[paramName] = obj
    draft.touch()
    emitParams()
  }

  function objectFieldValue(paramName: string, fieldName: string): unknown {
    const prev = draft.current[paramName]
    if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
      return (prev as Record<string, unknown>)[fieldName]
    }
    return undefined
  }

  function onJsonBlur(paramName: string, text: string, asArray: boolean) {
    try {
      const parsed = JSON.parse(text || (asArray ? '[]' : '{}'))
      draft.current[paramName] = parsed
      draft.touch()
      emitParams()
    } catch {
      ElMessage.warning('JSON 格式不正确')
    }
  }

  function onNestedJsonBlur(
    paramName: string,
    fieldName: string,
    text: string,
    asArray: boolean,
  ) {
    try {
      const parsed = JSON.parse(text || (asArray ? '[]' : '{}'))
      setObjectField(paramName, fieldName, parsed)
    } catch {
      ElMessage.warning('JSON 格式不正确')
    }
  }

  const listResultText = formatJson(listResult) || '—'

  async function handleRunAll() {
    const t = target
    if (!t) return
    setRunning(true)
    setListResultError('')
    setListResult(undefined)
    setListResultReady(false)
    setErrorText('')
    try {
      const scope = initialScope()
      assertRequiredParams(scope)
      const snap = await runFlowToEnd(stepContext(), scope)
      setSnapshot(snap)
      setHistory([])
      setLocalScope({})
      if (snap.businessError) {
        setListResult(resultFail(snap.businessError.message, snap.businessError.code))
      } else {
        setListResult(
          resultOk(extractFlowReturnValue(t.flow, snap, t.method.output, typeLibrary)),
        )
      }
      setListResultReady(true)
      setListResultFoldOpen(false)
      emitCursor(snap)
    } catch (err) {
      if (err instanceof BusinessException) {
        applyBusinessFail(err)
        emitCursor(null)
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      setListResult(resultFail(msg))
      setListResultReady(true)
      setListResultFoldOpen(false)
      setListResultError('')
      ElMessage.error(msg)
      emitCursor(null)
    } finally {
      setRunning(false)
    }
  }

  function openParamEdit(form: ParamFormModel) {
    setEditingParamForm(form)
    const name = form.param.name
    const cur = draft.current[name]
    if (form.mode === 'object') {
      const base = buildObjectDefault(form.fields)
      const obj =
        cur && typeof cur === 'object' && !Array.isArray(cur)
          ? { ...base, ...(cur as Record<string, unknown>) }
          : base
      paramEditDraft.clear()
      for (const [k, v] of Object.entries(obj)) paramEditDraft.current[k] = v
      paramEditDraft.touch()
    } else if (form.mode === 'json') {
      setParamEditJson(
        typeof cur === 'string'
          ? cur
          : JSON.stringify(cur ?? (form.kind === 'array' ? [] : {}), null, 2),
      )
    } else {
      setParamEditScalar(cur ?? defaultForKind(form.kind))
    }
    setParamDialogVisible(true)
  }

  function saveParamEdit() {
    const form = editingParamForm
    if (!form) return
    const name = form.param.name
    if (form.mode === 'object') {
      draft.current[name] = { ...paramEditDraft.current }
    } else if (form.mode === 'json') {
      try {
        draft.current[name] = JSON.parse(paramEditJson || 'null')
      } catch {
        ElMessage.warning('JSON 格式不正确')
        return
      }
    } else if (form.kind === 'number') {
      draft.current[name] = Number(paramEditScalar ?? 0)
    } else if (form.kind === 'boolean') {
      draft.current[name] = paramEditScalar === true
    } else {
      draft.current[name] = paramEditScalar ?? ''
    }
    draft.touch()
    emitParams()
    if (snapshot) {
      setSnapshot({
        ...snapshot,
        scope: { ...snapshot.scope, [name]: draft.current[name] },
      })
    }
    setParamDialogVisible(false)
  }

  function openAmbientEdit(item: FlowAmbientVar) {
    setEditingAmbient(item)
    const value = item.hasValue
      ? item.value
      : paramNameSet.has(item.name)
        ? draft.current[item.name]
        : undefined
    const isComplex =
      value !== null &&
      value !== undefined &&
      (typeof value === 'object' ||
        item.type === 'object' ||
        item.type === 'array' ||
        item.type === 'any' ||
        Boolean(item.tsType))
    setAmbientEditIsJson(isComplex)
    if (isComplex) {
      let json = formatAmbientValue(
        value === undefined ? (item.type === 'array' ? [] : {}) : value,
      )
      if (json === '—') json = item.type === 'array' ? '[]' : '{}'
      setAmbientEditJson(json)
    } else if (typeof value === 'boolean') {
      setAmbientEditScalar(value ? 'true' : 'false')
    } else if (value === undefined || value === null) {
      setAmbientEditScalar('')
    } else {
      setAmbientEditScalar(String(value))
    }
    setAmbientDialogVisible(true)
  }

  function applyScopeValue(name: string, value: unknown) {
    if (paramNameSet.has(name)) {
      draft.current[name] = value
      draft.touch()
      emitParams()
    }
    if (snapshot) {
      setSnapshot({
        ...snapshot,
        scope: { ...snapshot.scope, [name]: value },
      })
    } else {
      setLocalScope((prev) => ({ ...prev, [name]: value }))
    }
  }

  function saveAmbientEdit() {
    const item = editingAmbient
    if (!item) return
    let value: unknown
    if (ambientEditIsJson) {
      try {
        value = JSON.parse(ambientEditJson || 'null')
      } catch {
        ElMessage.warning('JSON 格式不正确')
        return
      }
    } else if (item.type === 'number') {
      value = Number(ambientEditScalar || 0)
    } else if (item.type === 'boolean') {
      value = ambientEditScalar === 'true' || ambientEditScalar === '1'
    } else {
      value = ambientEditScalar
    }
    applyScopeValue(item.name, value)
    setAmbientDialogVisible(false)
  }

  async function handleRunToCurrent() {
    const t = target
    if (!t) return
    const targetId = selectedNodeId
    if (!targetId) {
      ElMessage.warning('请先选中一个节点')
      return
    }
    setRunning(true)
    setErrorText('')
    try {
      const scope = initialScope()
      assertRequiredParams(scope)
      const snap = await runFlowToNode(stepContext(), targetId, scope)
      if (snapshot) setHistory((h) => [...h, snapshot])
      setSnapshot(snap)
      setLocalScope({})
      if (snap.businessError) {
        setListResult(resultFail(snap.businessError.message, snap.businessError.code))
        setListResultReady(true)
        setListResultFoldOpen(false)
        setListResultError('')
      }
      emitCursor(snap)
    } catch (err) {
      if (err instanceof BusinessException) {
        applyBusinessFail(err)
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      setErrorText(msg)
      ElMessage.error(msg)
    } finally {
      setRunning(false)
    }
  }

  async function handleRunNext() {
    const t = target
    if (!t) return
    setRunning(true)
    setErrorText('')
    try {
      const start = findStartNode(t.flow)
      if (!start) throw new Error('工作流缺少开始节点')
      const scope = initialScope()
      if (!snapshot) assertRequiredParams(scope)
      const base: FlowDebugSnapshot =
        snapshot ??
        ({
          cursorNodeId: start.id,
          scope,
          visitedNodeIds: [],
          printByNode: {},
        } satisfies FlowDebugSnapshot)
      const snap = await runFlowNext(stepContext(), base)
      if (snapshot) setHistory((h) => [...h, snapshot])
      setSnapshot(snap)
      setLocalScope({})
      if (snap.businessError) {
        setListResult(resultFail(snap.businessError.message, snap.businessError.code))
        setListResultReady(true)
        setListResultFoldOpen(false)
        setListResultError('')
      }
      emitCursor(snap)
    } catch (err) {
      if (err instanceof BusinessException) {
        applyBusinessFail(err)
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      setErrorText(msg)
      ElMessage.error(msg)
    } finally {
      setRunning(false)
    }
  }

  function handleStepBack() {
    const prev = history[history.length - 1]
    if (!prev) {
      resetSession()
      ElMessage.info('已回到初始状态')
      return
    }
    setHistory((h) => h.slice(0, -1))
    setSnapshot(prev)
    setLocalScope({})
    emitCursor(prev)
    setErrorText('')
  }

  const canStepBack = history.length > 0 || snapshot != null
  const stickyTitle = (() => {
    const parts: string[] = []
    if (cursorNodeTitle) parts.push(`执行到 ${cursorNodeTitle}`)
    else parts.push(`选中 ${selectedNodeLabel}`)
    if (errorText) parts.push(errorText)
    return parts.join(' · ')
  })()

  useEffect(() => {
    if (!isStartSelected && paramDialogVisible) setParamDialogVisible(false)
  }, [isStartSelected, paramDialogVisible])

  function renderFold(text: string, key: string, extraClass = '') {
    return (
      <div className="fold-code">
        <div className="fold-body">
          <pre
            className={`code-box${isLongText(text) && !isFoldExpanded(key) ? ' is-collapsed' : ''}${extraClass ? ` ${extraClass}` : ''}`}
          >
            {text}
          </pre>
          {isLongText(text) && !isFoldExpanded(key) ? <div className="fold-fade" /> : null}
        </div>
        {isLongText(text) ? (
          <button type="button" className="fold-toggle" onClick={() => toggleFold(key)}>
            {isFoldExpanded(key) ? '收起' : '展开全部'}
          </button>
        ) : null}
      </div>
    )
  }

  function renderListScalar(form: ParamFormModel) {
    if (form.kind === 'boolean') {
      return (
        <Switch
          checked={draft.current[form.param.name] === true}
          onChange={(v) => setScalar(form.param.name, v === true)}
        />
      )
    }
    if (form.kind === 'number') {
      return (
        <InputNumber
          value={Number(draft.current[form.param.name] ?? 0)}
          style={{ width: '100%' }}
          onChange={(v) => setScalar(form.param.name, v ?? 0)}
        />
      )
    }
    if (form.kind === 'enum') {
      return (
        <Select
          value={String(draft.current[form.param.name] ?? '')}
          allowClear
          placeholder="选择"
          style={{ width: '100%' }}
          options={form.enumOptions.map((opt) => ({ label: opt, value: opt }))}
          onChange={(v) => setScalar(form.param.name, v ?? '')}
        />
      )
    }
    return (
      <Input
        value={String(draft.current[form.param.name] ?? '')}
        onChange={(e) => setScalar(form.param.name, String(e.target.value ?? ''))}
      />
    )
  }

  return (
    <aside className="debug-panel">
      <div className="panel-header">
        <span>调试</span>
        {target && !isListMode ? (
          <div className="action-icons">
            <Tooltip title="执行到当前节点" placement="bottom">
              <Button
                type="primary"
                size="small"
                shape="circle"
                icon={<AimOutlined />}
                loading={running}
                onClick={() => void handleRunToCurrent()}
              />
            </Tooltip>
            <Tooltip title="返回上个节点" placement="bottom">
              <Button
                size="small"
                shape="circle"
                icon={<LeftOutlined />}
                disabled={!canStepBack || running}
                onClick={handleStepBack}
              />
            </Tooltip>
            <Tooltip title="执行到下一个节点" placement="bottom">
              <Button
                size="small"
                shape="circle"
                icon={<RightOutlined />}
                loading={running}
                onClick={() => void handleRunNext()}
              />
            </Tooltip>
          </div>
        ) : null}
      </div>
      {!target ? (
        <div className="panel-empty">
          <Empty description="选中业务方法或 API 后可调试" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : isListMode ? (
        <div className="panel-body">
          <div className="section">
            <div className="section-title row">
              <div className="method-title method-title--list">
                <span className="proc">{target.processorName}</span>
                <span className="sep">/</span>
                <span className="name">{method?.name || method?.id}</span>
              </div>
              <Button
                type="primary"
                size="small"
                icon={<CaretRightOutlined />}
                loading={running}
                onClick={() => void handleRunAll()}
              >
                执行
              </Button>
            </div>
            <div className="dry-run-row dry-run-row--list">
              <div className="dry-run-label">
                <span>试运行</span>
                <span className="dry-run-hint">开启后写入会回滚，不落库</span>
              </div>
              <Switch checked={dryRun} size="small" onChange={setDryRun} />
            </div>
          </div>

          <div className="section">
            <div className="section-title">入参</div>
            {!paramForms.length ? (
              <Empty description="该方法无入参" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="param-list">
                {paramForms.map((form) => (
                  <div key={form.param.id} className="param-block">
                    <div className="prop-label">
                      <Checkbox
                        checked={isParamEnabled(form)}
                        onChange={(e) => setParamEnabledFlag(form, e.target.checked)}
                      />
                      <span className="prop-name">{form.param.name}</span>
                      <span className="prop-type">{form.typeLabel}</span>
                    </div>
                    {!isParamEnabled(form) ? (
                      <div className="null-hint">{disabledParamHint(form)}</div>
                    ) : form.mode === 'scalar' ? (
                      renderListScalar(form)
                    ) : form.mode === 'object' ? (
                      <div className="object-fields">
                        {form.fields.map((field) => (
                          <div key={field.name} className="prop-row">
                            <div className="prop-label nested">
                              <span className="prop-name">{field.name}</span>
                              {field.remark ? (
                                <span className="prop-type">{field.remark}</span>
                              ) : null}
                            </div>
                            {field.kind === 'boolean' ? (
                              <Switch
                                checked={
                                  objectFieldValue(form.param.name, field.name) === true
                                }
                                onChange={(v) =>
                                  setObjectField(form.param.name, field.name, v === true)
                                }
                              />
                            ) : field.kind === 'number' ? (
                              <InputNumber
                                value={Number(
                                  objectFieldValue(form.param.name, field.name) ?? 0,
                                )}
                                style={{ width: '100%' }}
                                onChange={(v) =>
                                  setObjectField(form.param.name, field.name, v ?? 0)
                                }
                              />
                            ) : field.kind === 'enum' ? (
                              <Select
                                value={String(
                                  objectFieldValue(form.param.name, field.name) ?? '',
                                )}
                                allowClear
                                placeholder="选择"
                                style={{ width: '100%' }}
                                options={field.enumOptions.map((opt) => ({
                                  label: opt,
                                  value: opt,
                                }))}
                                onChange={(v) =>
                                  setObjectField(form.param.name, field.name, v ?? '')
                                }
                              />
                            ) : field.kind === 'json' || field.kind === 'array' ? (
                              <Input.TextArea
                                rows={2}
                                value={formatJson(
                                  objectFieldValue(form.param.name, field.name),
                                )}
                                onBlur={(e) =>
                                  onNestedJsonBlur(
                                    form.param.name,
                                    field.name,
                                    e.target.value,
                                    field.kind === 'array',
                                  )
                                }
                              />
                            ) : (
                              <Input
                                value={String(
                                  objectFieldValue(form.param.name, field.name) ?? '',
                                )}
                                onChange={(e) =>
                                  setObjectField(
                                    form.param.name,
                                    field.name,
                                    String(e.target.value ?? ''),
                                  )
                                }
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Input.TextArea
                        rows={3}
                        value={formatJson(draft.current[form.param.name])}
                        onBlur={(e) =>
                          onJsonBlur(
                            form.param.name,
                            e.target.value,
                            form.kind === 'array',
                          )
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {listResultError ? (
            <p className="error-box">{listResultError}</p>
          ) : dryRun && listResultReady ? (
            <p className="dry-run-box">试运行已回滚，数据未写入数据库</p>
          ) : null}

          {listResultReady ? (
            <div className="section">
              <div className="section-title">执行结果</div>
              <div className="fold-code">
                <div className="fold-body">
                  <pre
                    className={`code-box${isLongText(listResultText) && !listResultFoldOpen ? ' is-collapsed' : ''}`}
                  >
                    {listResultText}
                  </pre>
                  {isLongText(listResultText) && !listResultFoldOpen ? (
                    <div className="fold-fade" />
                  ) : null}
                </div>
                {isLongText(listResultText) ? (
                  <button
                    type="button"
                    className="fold-toggle"
                    onClick={() => setListResultFoldOpen((v) => !v)}
                  >
                    {listResultFoldOpen ? '收起' : '展开全部'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="panel-sticky">
            <div className="sticky-row" title={stickyTitle}>
              <div className="method-title">
                <span className="proc">{target.processorName}</span>
                <span className="sep">/</span>
                <span className="name">{method?.name || method?.id}</span>
              </div>
              <div className="summary-scroll">
                {cursorNodeTitle ? (
                  <span className="summary-item summary-cursor">执行到 {cursorNodeTitle}</span>
                ) : (
                  <span className="summary-item">选中 {selectedNodeLabel}</span>
                )}
                {errorText ? (
                  <>
                    <span className="summary-sep">·</span>
                    <span className="summary-error">{errorText}</span>
                  </>
                ) : null}
              </div>
            </div>
            <div className="dry-run-row">
              <div className="dry-run-label">
                <span>试运行</span>
                <span className="dry-run-hint">开启后写入会回滚，不落库</span>
              </div>
              <Switch checked={dryRun} size="small" onChange={setDryRun} />
            </div>
          </div>

          <div className="panel-scroll">
            {isStartSelected ? (
              <div className="section">
                <div className="section-title">
                  入参
                  <span className="section-hint">点击编辑可修改调试入参</span>
                </div>
                {!paramForms.length ? (
                  <Empty description="该方法无入参" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <div className="data-list">
                    {paramForms.map((form) => (
                      <div key={form.param.id} className="data-row">
                        <div className="data-head">
                          <div className="prop-label">
                            <span className="prop-name">{form.param.name}</span>
                            <span className="prop-type">{form.typeLabel}</span>
                          </div>
                          <Button
                            type="link"
                            icon={<EditOutlined />}
                            onClick={() => openParamEdit(form)}
                          >
                            编辑
                          </Button>
                        </div>
                        {renderFold(
                          valueTextOf(draft.current[form.param.name]),
                          `param:${form.param.name}`,
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="section">
                <div className="section-title">
                  当前可访问数据
                  <span className="section-hint">执行到节点处的工作流变量</span>
                </div>
                {!ambientListView.length ? (
                  <Empty description="暂无变量" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <div className="data-list">
                    {ambientListView.map((item) => (
                      <div key={item.name} className="data-row">
                        <div className="data-head">
                          <div className="prop-label">
                            <span className="prop-name">{item.name}</span>
                            <span className="prop-type">{ambientTypeLabel(item)}</span>
                          </div>
                          <Button
                            type="link"
                            icon={<EditOutlined />}
                            onClick={() => openAmbientEdit(item)}
                          >
                            编辑
                          </Button>
                        </div>
                        {renderFold(
                          ambientTextOf(item),
                          `var:${item.name}`,
                          !item.hasValue ? 'is-unset' : '',
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        open={paramDialogVisible}
        title={`编辑入参 · ${editingParamForm?.param.name || ''}`}
        width={440}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => {
          setParamDialogVisible(false)
          setEditingParamForm(null)
        }}
        footer={
          <Button type="primary" onClick={saveParamEdit}>
            确定
          </Button>
        }
      >
        {editingParamForm ? (
          editingParamForm.mode === 'object' ? (
            <div className="object-fields">
              {editingParamForm.fields.map((f) => (
                <div key={f.name} className="prop-row">
                  <div className="prop-label nested">
                    <span className="prop-name">{f.name}</span>
                    {f.remark ? <span className="prop-type">{f.remark}</span> : null}
                  </div>
                  {f.kind === 'boolean' ? (
                    <Switch
                      checked={paramEditDraft.current[f.name] === true}
                      onChange={(v) => {
                        paramEditDraft.current[f.name] = v
                        paramEditDraft.touch()
                      }}
                    />
                  ) : f.kind === 'number' ? (
                    <InputNumber
                      value={Number(paramEditDraft.current[f.name] ?? 0)}
                      style={{ width: '100%' }}
                      onChange={(v) => {
                        paramEditDraft.current[f.name] = v ?? 0
                        paramEditDraft.touch()
                      }}
                    />
                  ) : (
                    <Input
                      value={String(paramEditDraft.current[f.name] ?? '')}
                      onChange={(e) => {
                        paramEditDraft.current[f.name] = e.target.value
                        paramEditDraft.touch()
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : editingParamForm.mode === 'json' ? (
            <Input.TextArea
              value={paramEditJson}
              rows={10}
              onChange={(e) => setParamEditJson(e.target.value)}
            />
          ) : editingParamForm.kind === 'boolean' ? (
            <Switch
              checked={paramEditScalar === true}
              onChange={(v) => setParamEditScalar(v === true)}
            />
          ) : editingParamForm.kind === 'number' ? (
            <InputNumber
              value={Number(paramEditScalar ?? 0)}
              style={{ width: '100%' }}
              onChange={(v) => setParamEditScalar(v ?? 0)}
            />
          ) : editingParamForm.kind === 'enum' ? (
            <Select
              value={String(paramEditScalar ?? '')}
              allowClear
              style={{ width: '100%' }}
              options={editingParamForm.enumOptions.map((opt) => ({
                label: opt,
                value: opt,
              }))}
              onChange={(v) => setParamEditScalar(v ?? '')}
            />
          ) : (
            <Input
              value={String(paramEditScalar ?? '')}
              onChange={(e) => setParamEditScalar(String(e.target.value ?? ''))}
            />
          )
        ) : null}
      </Modal>

      <Modal
        open={ambientDialogVisible}
        title={`编辑变量 · ${editingAmbient?.name || ''}`}
        width={440}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => {
          setAmbientDialogVisible(false)
          setEditingAmbient(null)
        }}
        footer={
          <Button type="primary" onClick={saveAmbientEdit}>
            确定
          </Button>
        }
      >
        {editingAmbient ? (
          <div className="ambient-edit">
            <div className="prop-label">
              <span className="prop-name">{editingAmbient.name}</span>
              <span className="prop-type">{ambientTypeLabel(editingAmbient)}</span>
            </div>
            {ambientEditIsJson ? (
              <Input.TextArea
                value={ambientEditJson}
                rows={12}
                onChange={(e) => setAmbientEditJson(e.target.value)}
              />
            ) : editingAmbient.type === 'boolean' ? (
              <Switch
                checked={ambientEditScalar === 'true'}
                onChange={(v) => setAmbientEditScalar(v === true ? 'true' : 'false')}
              />
            ) : editingAmbient.type === 'number' ? (
              <InputNumber
                value={Number(ambientEditScalar || 0)}
                style={{ width: '100%' }}
                onChange={(v) => setAmbientEditScalar(String(v ?? 0))}
              />
            ) : ambientEditDateKind === 'time' ||
              ambientEditDateKind === 'date' ||
              ambientEditDateKind === 'datetime' ? (
              <DateTimeValueInput
                kind={ambientEditDateKind}
                size="small"
                value={ambientEditScalar}
                onChange={setAmbientEditScalar}
              />
            ) : (
              <Input
                value={ambientEditScalar}
                onChange={(e) => setAmbientEditScalar(e.target.value)}
              />
            )}
          </div>
        ) : null}
      </Modal>
    </aside>
  )
}
