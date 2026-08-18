import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Select, Switch } from 'antd'
import { ElMessage } from '../../ui/feedback'
import { getServiceProcessors } from '../../api/projects'
import {
  createEmptyProcessorTypeExpr,
  createEmptyServiceApiParam,
  createDefaultMethodFlow,
  HTTP_METHOD_OPTIONS,
  normalizeProcessorTypeExpr,
  PROCESSOR_METHOD_SCOPE_OPTIONS,
  type HttpMethod,
  type MethodFlow,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorMethodScope,
  type ProcessorTypeExpr,
  type ServiceApi,
  type ServiceApiParam,
  type ServiceApiParamLocation,
  type ServiceProcessor,
} from '../../types/backend-services'
import type { DataFieldType } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  dataFieldToMethodParamType,
  processorTypeExprToTs,
  type MethodParam,
} from '../../types/page-method'
import {
  buildApiBusinessFlow,
  extractApiBusinessBinding,
  findProcessorMethod,
} from '../../utils/api-business-binding'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import TypeGenericArgsDialog from './TypeGenericArgsDialog'
import ServiceApiParamsDialog from './ServiceApiParamsDialog'
import TypedBindingCascader from './method-flow/TypedBindingCascader'
import './EditServiceApiDialog.css'

export type ServiceApiEditPayload = {
  name: string
  path: string
  remark: string
  method: HttpMethod
  inputs: ServiceApiParam[]
  output: ProcessorTypeExpr
  requireAuth: boolean
  scope: ProcessorMethodScope
  flow: MethodFlow
}

export default function EditServiceApiDialog({
  open,
  onOpenChange,
  api,
  dtoOptions,
  typeLibrary,
  reservedNames,
  projectPath,
  serviceId,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  api: ServiceApi | null
  dtoOptions: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  reservedNames?: string[]
  projectPath?: string
  serviceId?: string
  onSave?: (payload: ServiceApiEditPayload) => void
}) {
  const [draftName, setDraftName] = useState('')
  const [draftPath, setDraftPath] = useState('')
  const [draftRemark, setDraftRemark] = useState('')
  const [draftMethod, setDraftMethod] = useState<HttpMethod>('GET')
  const [draftInputs, setDraftInputs] = useState<ServiceApiParam[]>([])
  const draftInputsRef = useRef(draftInputs)
  draftInputsRef.current = draftInputs
  const [draftOutput, setDraftOutput] = useState<ProcessorTypeExpr>(
    createEmptyProcessorTypeExpr('any'),
  )
  const draftOutputRef = useRef(draftOutput)
  draftOutputRef.current = draftOutput
  const [draftRequireAuth, setDraftRequireAuth] = useState(false)
  const [draftScope, setDraftScope] = useState<ProcessorMethodScope>('public')
  const [draftProcessorId, setDraftProcessorId] = useState('')
  const draftProcessorIdRef = useRef(draftProcessorId)
  draftProcessorIdRef.current = draftProcessorId
  const [draftMethodId, setDraftMethodId] = useState('')
  const draftMethodIdRef = useRef(draftMethodId)
  draftMethodIdRef.current = draftMethodId
  const [draftParamBindings, setDraftParamBindings] = useState<
    Record<string, string>
  >({})
  const draftParamBindingsRef = useRef(draftParamBindings)
  draftParamBindingsRef.current = draftParamBindings

  const [businessProcessors, setBusinessProcessors] = useState<ServiceProcessor[]>(
    [],
  )
  const businessProcessorsRef = useRef(businessProcessors)
  businessProcessorsRef.current = businessProcessors
  const [processorsLoading, setProcessorsLoading] = useState(false)

  const [inputsDialogVisible, setInputsDialogVisible] = useState(false)
  const [genericVisible, setGenericVisible] = useState(false)
  const [genericNames, setGenericNames] = useState<string[]>([])
  const [genericTypeName, setGenericTypeName] = useState('')
  const [genericArgs, setGenericArgs] = useState<Record<string, string>>({})

  const title = useMemo(() => {
    const name = api?.name?.trim()
    return name ? `编辑 API · ${name}` : '编辑 API'
  }, [api?.name])

  function processorTypeExprsEqual(
    a: ProcessorTypeExpr | null | undefined,
    b: ProcessorTypeExpr | null | undefined,
  ): boolean {
    const x = normalizeProcessorTypeExpr(a)
    const y = normalizeProcessorTypeExpr(b)
    if (x.type !== y.type) return false
    if (x.typeRef !== y.typeRef) return false
    if (x.itemType !== y.itemType) return false
    if (x.itemTypeRef !== y.itemTypeRef) return false
    if (x.itemItemType !== y.itemItemType) return false
    if (x.itemItemTypeRef !== y.itemItemTypeRef) return false
    if ((x.keyType || '') !== (y.keyType || '')) return false
    const ax = x.genericArgs ?? {}
    const ay = y.genericArgs ?? {}
    const keys = new Set([...Object.keys(ax), ...Object.keys(ay)])
    for (const k of keys) {
      if ((ax[k] ?? '') !== (ay[k] ?? '')) return false
    }
    return true
  }

  function isOutputConfigured(expr: ProcessorTypeExpr): boolean {
    const o = normalizeProcessorTypeExpr(expr)
    if (!o.type.trim()) return false
    if (o.type === 'json' && !o.typeRef.trim()) return false
    if (o.type === 'map') {
      if (!o.itemType.trim()) return false
      if (o.itemType === 'json' && !o.itemTypeRef.trim()) return false
      if (o.itemType === 'array') {
        if (!o.itemItemType.trim()) return false
        if (o.itemItemType === 'json' && !o.itemItemTypeRef.trim()) return false
      }
      return true
    }
    if (o.type === 'array') {
      if (!o.itemType.trim()) return false
      if (o.itemType === 'json' && !o.itemTypeRef.trim()) return false
      if (o.itemType === 'array') {
        if (!o.itemItemType.trim()) return false
        if (o.itemItemType === 'json' && !o.itemItemTypeRef.trim()) return false
      }
    }
    return true
  }

  const outputReady = isOutputConfigured(draftOutput)

  const methodOptions = useMemo((): ProcessorMethod[] => {
    const proc = businessProcessors.find((p) => p.id === draftProcessorId)
    return (proc?.methods ?? []).filter((m) => !m.disabled)
  }, [businessProcessors, draftProcessorId])

  function isMethodSelectable(method: ProcessorMethod): boolean {
    return (
      outputReady && processorTypeExprsEqual(method.output, draftOutput)
    )
  }

  const matchingMethodOptions = useMemo(
    () => methodOptions.filter((m) => isMethodSelectable(m)),
    [methodOptions, outputReady, draftOutput],
  )

  const selectedBizMethod = useMemo(() => {
    const hit = findProcessorMethod(
      businessProcessors,
      draftProcessorId,
      draftMethodId,
    )
    return hit?.method ?? null
  }, [businessProcessors, draftProcessorId, draftMethodId])

  const methodParams = useMemo(
    (): ProcessorMethodParam[] =>
      (selectedBizMethod?.params ?? []).filter((p) => p.name.trim()),
    [selectedBizMethod],
  )

  const bindingAmbientVars = useMemo((): MethodParam[] => {
    const out: MethodParam[] = []
    for (const p of draftInputs) {
      const name = p.varName.trim()
      if (!name) continue
      const fieldType = (p.typeRef ? 'json' : p.type || 'string') as DataFieldType
      const typeExpr = normalizeProcessorTypeExpr({
        type: fieldType,
        typeRef: p.typeRef || '',
        genericArgs: p.genericArgs ?? {},
      })
      out.push({
        name,
        type: dataFieldToMethodParamType(fieldType),
        typeExpr,
        typeRef: p.typeRef || undefined,
      })
    }
    return out
  }, [draftInputs])

  function paramTypeLabel(p: ProcessorMethodParam): string {
    return processorTypeExprToTs(p.typeExpr, typeLibrary)
  }

  function syncParamBindings(
    method: ProcessorMethod | null | undefined,
    opts?: { preferSameName?: boolean; seed?: Record<string, string> },
  ) {
    const seed = opts?.seed ?? {}
    const names = new Set(
      draftInputsRef.current.map((p) => p.varName.trim()).filter(Boolean),
    )
    const next: Record<string, string> = {}
    for (const p of method?.params ?? []) {
      const name = p.name.trim()
      if (!name) continue
      const prev = (
        seed[name] ??
        draftParamBindingsRef.current[name] ??
        ''
      ).trim()
      if (prev) {
        next[name] = prev
      } else if (opts?.preferSameName && names.has(name)) {
        next[name] = name
      } else {
        next[name] = ''
      }
    }
    draftParamBindingsRef.current = next
    setDraftParamBindings(next)
  }

  function updateParamBinding(paramName: string, value: string) {
    const next = {
      ...draftParamBindingsRef.current,
      [paramName]: value,
    }
    draftParamBindingsRef.current = next
    setDraftParamBindings(next)
  }

  const namedTypeOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        if (!t.name.trim()) continue
        opts.push({ id: t.id, label: `${group.name} / ${t.name}` })
      }
    }
    if (!opts.length) {
      for (const o of dtoOptions) {
        opts.push({ id: o.id, label: o.label })
      }
    }
    return opts
  }, [typeLibrary, dtoOptions])

  function typeDefById(id: string) {
    if (!id) return null
    for (const group of typeLibrary?.groups ?? []) {
      const hit = group.types.find((t) => t.id === id)
      if (hit) return hit
    }
    return null
  }

  function genericNamesOf(typeRef: string): string[] {
    return (typeDefById(typeRef)?.generics ?? [])
      .map((g) => g.name.trim())
      .filter(Boolean)
  }

  function formatTypeWithGenerics(
    typeRef: string,
    args: Record<string, string>,
  ): string {
    const def = typeDefById(typeRef)
    if (!def?.name) return typeRef || '—'
    const names = genericNamesOf(typeRef)
    if (!names.length) return def.name
    const inner = names
      .map((n) => {
        const ref = args[n] ?? ''
        if (!ref) return 'any'
        return typeDefById(ref)?.name || ref
      })
      .join(', ')
    return `${def.name}<${inner}>`
  }

  function namedTypeRefOf(output: ProcessorTypeExpr): string {
    return output.type === 'array'
      ? output.itemType === 'array'
        ? output.itemItemTypeRef
        : output.itemTypeRef
      : output.typeRef
  }

  async function loadBusinessProcessors() {
    const path = projectPath?.trim()
    const sid = serviceId?.trim()
    if (!path || !sid) {
      businessProcessorsRef.current = []
      setBusinessProcessors([])
      return
    }
    setProcessorsLoading(true)
    try {
      const res = await getServiceProcessors(path, sid, 'business')
      const list = res.processors ?? []
      businessProcessorsRef.current = list
      setBusinessProcessors(list)
    } catch (err) {
      console.error(err)
      businessProcessorsRef.current = []
      setBusinessProcessors([])
    } finally {
      setProcessorsLoading(false)
    }
  }

  function syncInputsFromMethod(method: ProcessorMethod) {
    const location: ServiceApiParamLocation =
      draftMethod === 'GET' || draftMethod === 'DELETE' ? 'query' : 'body'
    const next = (method.params ?? [])
      .map((p) => {
        const name = p.name.trim()
        if (!name) return null
        const te = p.typeExpr
        return createEmptyServiceApiParam({
          varName: name,
          location,
          type: te?.typeRef ? 'json' : (te?.type as DataFieldType) || 'string',
          typeRef: te?.typeRef ?? '',
          genericArgs: { ...(te?.genericArgs ?? {}) },
          required: Boolean(p.required),
          remark: p.remark ?? '',
        })
      })
      .filter((x): x is ServiceApiParam => Boolean(x))
    draftInputsRef.current = next
    setDraftInputs(next)
    syncParamBindings(method, { preferSameName: true })
  }

  function inputsSummary(inputs: ServiceApiParam[]): string {
    const named = inputs.filter((p) => p.varName.trim())
    if (!named.length) return '无入参，点击编辑'
    return named
      .map((p) => {
        const typeLabel = p.typeRef
          ? typeDefById(p.typeRef)?.name || p.typeRef
          : p.type || 'string'
        return `${p.varName}: ${typeLabel}`
      })
      .join(', ')
  }

  function openInputsDialog() {
    setInputsDialogVisible(true)
  }

  function saveInputsFromDialog(inputs: ServiceApiParam[]) {
    draftInputsRef.current = inputs
    setDraftInputs(inputs)
    syncParamBindings(selectedBizMethod, { preferSameName: true })
  }

  function handleSyncInputsInDialog() {
    if (!selectedBizMethod) return
    syncInputsFromMethod(selectedBizMethod)
  }

  function applyMethodSelection(
    methodId: string,
    opts?: { forceSyncInputs?: boolean },
  ) {
    draftMethodIdRef.current = methodId
    setDraftMethodId(methodId)
    if (!methodId) {
      draftParamBindingsRef.current = {}
      setDraftParamBindings({})
      return
    }
    const hit = findProcessorMethod(
      businessProcessorsRef.current,
      draftProcessorIdRef.current,
      methodId,
    )
    if (!hit) return
    if (!processorTypeExprsEqual(hit.method.output, draftOutputRef.current)) {
      draftMethodIdRef.current = ''
      setDraftMethodId('')
      draftParamBindingsRef.current = {}
      setDraftParamBindings({})
      ElMessage.warning('该方法出参与当前 API 出参不一致')
      return
    }
    const force =
      Boolean(opts?.forceSyncInputs) || draftInputsRef.current.length === 0
    if (force) syncInputsFromMethod(hit.method)
    else syncParamBindings(hit.method, { preferSameName: true })
  }

  function clearMethodIfMismatched() {
    if (!draftMethodIdRef.current) {
      draftParamBindingsRef.current = {}
      setDraftParamBindings({})
      return
    }
    const hit = findProcessorMethod(
      businessProcessorsRef.current,
      draftProcessorIdRef.current,
      draftMethodIdRef.current,
    )
    const selectable =
      hit &&
      isOutputConfigured(draftOutputRef.current) &&
      processorTypeExprsEqual(hit.method.output, draftOutputRef.current)
    if (!hit || !selectable) {
      draftMethodIdRef.current = ''
      setDraftMethodId('')
      draftParamBindingsRef.current = {}
      setDraftParamBindings({})
    }
  }

  useEffect(() => {
    if (!open || !api) return
    let cancelled = false
    setDraftName(api.name ?? '')
    setDraftPath(api.path ?? '')
    setDraftRemark(api.remark ?? '')
    setDraftMethod(api.method ?? 'GET')
    const nextInputs = (api.inputs ?? []).map((p) => ({
      ...p,
      genericArgs: { ...(p.genericArgs ?? {}) },
    }))
    draftInputsRef.current = nextInputs
    setDraftInputs(nextInputs)
    const nextOutput = normalizeProcessorTypeExpr(api.output)
    draftOutputRef.current = nextOutput
    setDraftOutput(nextOutput)
    setDraftRequireAuth(Boolean(api.requireAuth))
    setDraftScope(api.scope === 'private' ? 'private' : 'public')

    void (async () => {
      await loadBusinessProcessors()
      if (cancelled) return
      const binding = extractApiBusinessBinding(api.flow)
      const processorId = binding?.processorId ?? ''
      const methodId = binding?.methodId ?? ''
      draftProcessorIdRef.current = processorId
      setDraftProcessorId(processorId)
      draftMethodIdRef.current = methodId
      setDraftMethodId(methodId)
      clearMethodIfMismatched()
      const hit = findProcessorMethod(
        businessProcessorsRef.current,
        draftProcessorIdRef.current,
        draftMethodIdRef.current,
      )
      if (hit) {
        syncParamBindings(hit.method, {
          preferSameName: true,
          seed: binding?.paramBindings ?? {},
        })
      } else {
        draftParamBindingsRef.current = {}
        setDraftParamBindings({})
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api])

  const prevProcessorIdRef = useRef(draftProcessorId)
  useEffect(() => {
    if (!open) return
    if (draftProcessorId === prevProcessorIdRef.current) return
    prevProcessorIdRef.current = draftProcessorId
    clearMethodIfMismatched()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftProcessorId])

  useEffect(() => {
    if (!open) return
    clearMethodIfMismatched()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftOutput])

  function handleOutputChange(payload: TypeSelectPayload) {
    if (payload.type === 'void' || payload.type === 'generic') return
    const prev = draftOutputRef.current
    const next: ProcessorTypeExpr = {
      ...createEmptyProcessorTypeExpr(payload.type),
      type: payload.type,
      typeRef: payload.typeRef ?? '',
      itemType: payload.itemType ?? '',
      itemTypeRef: payload.itemTypeRef ?? '',
      itemItemType: payload.itemItemType ?? '',
      itemItemTypeRef: payload.itemItemTypeRef ?? '',
      genericArgs: {},
    }
    const named =
      next.type === 'array'
        ? next.itemType === 'array'
          ? next.itemItemTypeRef
          : next.itemTypeRef
        : next.typeRef
    const prevNamed =
      prev.type === 'array'
        ? prev.itemType === 'array'
          ? prev.itemItemTypeRef
          : prev.itemTypeRef
        : prev.typeRef
    if (named && named === prevNamed) {
      next.genericArgs = { ...(prev.genericArgs ?? {}) }
    } else {
      for (const n of genericNamesOf(named)) next.genericArgs[n] = ''
    }
    draftOutputRef.current = next
    setDraftOutput(next)
    clearMethodIfMismatched()
    if (genericNamesOf(named).length) {
      openOutputGenerics(next)
    }
  }

  function openOutputGenerics(expr?: ProcessorTypeExpr) {
    const output = expr ?? draftOutputRef.current
    const named = namedTypeRefOf(output)
    const names = genericNamesOf(named)
    if (!names.length) return
    setGenericNames(names)
    setGenericTypeName(typeDefById(named)?.name ?? '')
    setGenericArgs({ ...(output.genericArgs ?? {}) })
    setGenericVisible(true)
  }

  function handleGenericSave(args: Record<string, string>) {
    const next = {
      ...draftOutputRef.current,
      genericArgs: { ...args },
    }
    draftOutputRef.current = next
    setDraftOutput(next)
    setGenericVisible(false)
  }

  function handleSave() {
    const name = draftName.trim()
    if (!name) {
      ElMessage.warning('请填写名称')
      return
    }
    const reserved = reservedNames ?? []
    if (reserved.some((n) => n.toLowerCase() === name.toLowerCase())) {
      ElMessage.warning(`API 名称「${name}」已存在`)
      return
    }
    if (!draftProcessorIdRef.current) {
      ElMessage.warning('请选择业务')
      return
    }
    if (!draftMethodIdRef.current) {
      ElMessage.warning('请选择方法')
      return
    }
    const hit = findProcessorMethod(
      businessProcessorsRef.current,
      draftProcessorIdRef.current,
      draftMethodIdRef.current,
    )
    if (!hit) {
      ElMessage.warning('所选业务方法无效')
      return
    }
    if (!isOutputConfigured(draftOutputRef.current)) {
      ElMessage.warning('请先选择出参')
      return
    }
    if (!processorTypeExprsEqual(hit.method.output, draftOutputRef.current)) {
      ElMessage.warning('业务方法出参须与 API 出参一致')
      return
    }
    const inputs = draftInputsRef.current
      .map((p) => ({
        ...p,
        varName: p.varName.trim(),
        remark: p.remark.trim(),
        type: p.typeRef ? 'json' : p.type.trim() || 'string',
        typeRef: p.typeRef.trim(),
        genericArgs: { ...(p.genericArgs ?? {}) },
      }))
      .filter((p) => p.varName)
    for (const p of inputs) {
      if (!p.varName) {
        ElMessage.warning('请填写变量名')
        return
      }
    }
    const output = normalizeProcessorTypeExpr(draftOutputRef.current)
    const paramBindings: Record<string, string> = {}
    for (const p of hit.method.params ?? []) {
      const pname = p.name.trim()
      if (!pname) continue
      paramBindings[pname] = (draftParamBindingsRef.current[pname] ?? '').trim()
    }
    const unbound = Object.entries(paramBindings)
      .filter(([, v]) => !String(v).trim())
      .map(([k]) => k)
    if (unbound.length) {
      ElMessage.warning(`请完成业务方法入参绑定：${unbound.join('、')}`)
      return
    }
    const methodLabel = `${hit.processor.name || hit.processor.id}.${hit.method.name}`
    const flow = buildApiBusinessFlow({
      serviceId: serviceId?.trim() || '',
      processorId: hit.processor.id,
      methodId: hit.method.id,
      methodLabel,
      varName: 'result',
      paramBindings,
      outputTypeExpr: output,
    })
    onSave?.({
      name,
      path: draftPath.trim() || '/',
      remark: draftRemark.trim(),
      method: draftMethod,
      inputs,
      output,
      requireAuth: draftRequireAuth,
      scope: draftScope,
      flow: flow.nodes.length ? flow : createDefaultMethodFlow(),
    })
    onOpenChange?.(false)
  }

  const outputNamedRef = namedTypeRefOf(draftOutput)
  const outputHasGenerics = genericNamesOf(outputNamedRef).length > 0

  return (
    <>
      <Modal
        open={open}
        title={title}
        width={900}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        className="service-api-dialog"
        onCancel={() => onOpenChange?.(false)}
        footer={
          <Button type="primary" onClick={handleSave}>
            保存
          </Button>
        }
      >
        <Form
          className="api-form"
          labelCol={{ style: { width: 88 } }}
          onFinish={() => undefined}
        >
          <Form.Item label="名称" required>
            <Input
              value={draftName}
              placeholder="如 list"
              maxLength={64}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="路径">
            <Input
              value={draftPath}
              placeholder="如 / 或 /list"
              maxLength={128}
              onChange={(e) => setDraftPath(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="说明">
            <Input.TextArea
              value={draftRemark}
              rows={2}
              placeholder="可选说明"
              maxLength={200}
              onChange={(e) => setDraftRemark(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="请求方法">
            <Select
              value={draftMethod}
              style={{ width: 160 }}
              options={HTTP_METHOD_OPTIONS.map((opt) => ({
                value: opt.value,
                label: opt.label,
              }))}
              onChange={(value) => setDraftMethod(value)}
            />
          </Form.Item>
          <Form.Item label="需要鉴权">
            <Switch
              checked={draftRequireAuth}
              onChange={setDraftRequireAuth}
            />
          </Form.Item>
          <Form.Item label="作用域">
            <Select
              value={draftScope}
              style={{ width: 160 }}
              options={PROCESSOR_METHOD_SCOPE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: opt.label,
              }))}
              onChange={(value) => setDraftScope(value)}
            />
          </Form.Item>

          <Form.Item label="出参">
            <div className="output-row">
              <DataFieldTypeTreeSelect
                className="type-select"
                type={(draftOutput.type || 'any') as DataFieldType}
                typeRef={draftOutput.typeRef}
                itemType={
                  (draftOutput.itemType || undefined) as DataFieldType | undefined
                }
                itemTypeRef={draftOutput.itemTypeRef}
                itemItemType={
                  (draftOutput.itemItemType || undefined) as
                    | DataFieldType
                    | undefined
                }
                itemItemTypeRef={draftOutput.itemItemTypeRef}
                library={typeLibrary}
                composable
                excludeTypes={['api', 'icon', 'color', 'ref', 'resource']}
                onChange={handleOutputChange}
              />
              {outputHasGenerics ? (
                <Button type="link" onClick={() => openOutputGenerics()}>
                  泛型
                </Button>
              ) : null}
            </div>
            {outputHasGenerics ? (
              <p className="generic-preview">
                {formatTypeWithGenerics(
                  outputNamedRef,
                  draftOutput.genericArgs ?? {},
                )}
              </p>
            ) : null}
          </Form.Item>

          <Form.Item label="选择业务" required>
            <Select
              value={draftProcessorId || undefined}
              showSearch
              allowClear
              loading={processorsLoading}
              placeholder="选择业务处理器"
              style={{ width: '100%' }}
              optionFilterProp="label"
              options={businessProcessors.map((proc) => ({
                value: proc.id,
                label: proc.name || proc.id,
              }))}
              onChange={(value) => setDraftProcessorId(value ?? '')}
            />
          </Form.Item>
          <Form.Item label="选择方法" required>
            <Select
              value={draftMethodId || undefined}
              showSearch
              allowClear
              disabled={!draftProcessorId}
              placeholder={
                !draftProcessorId
                  ? '请先选择业务'
                  : !outputReady
                    ? '请先选择出参后再选方法'
                    : matchingMethodOptions.length
                      ? '选择与出参匹配的业务方法'
                      : '无匹配出参的业务方法（灰色项不可选）'
              }
              style={{ width: '100%' }}
              optionFilterProp="label"
              options={methodOptions.map((m) => ({
                value: m.id,
                label: m.remark ? `${m.name} · ${m.remark}` : m.name,
                disabled: !isMethodSelectable(m),
              }))}
              onChange={(id) =>
                applyMethodSelection(String(id ?? ''), {
                  forceSyncInputs: !draftInputs.length,
                })
              }
            />
            {draftProcessorId && outputReady && !matchingMethodOptions.length ? (
              <p className="method-hint">
                当前业务下没有出参与「出参」一致的方法（灰色项仅供对照，不可选）
              </p>
            ) : selectedBizMethod ? (
              <p className="method-hint">
                将调用
                {businessProcessors.find((p) => p.id === draftProcessorId)
                  ?.name || draftProcessorId}
                .{selectedBizMethod.name}
              </p>
            ) : null}
          </Form.Item>

          <Form.Item label="入参" className="inputs-item">
            <div className="inputs-trigger-row">
              <button
                type="button"
                className="inputs-trigger"
                onClick={openInputsDialog}
              >
                {inputsSummary(draftInputs)}
              </button>
              <Button type="link" onClick={openInputsDialog}>
                编辑
              </Button>
            </div>
          </Form.Item>

          {selectedBizMethod && methodParams.length ? (
            <Form.Item label="入参绑定" required className="bindings-item">
              <div className="param-bindings">
                {methodParams.map((p) => (
                  <div key={p.id} className="param-row">
                    <span
                      className="param-name"
                      title={`${p.remark || p.name} · ${paramTypeLabel(p)}`}
                    >
                      {p.name}
                      <em className="param-type">{paramTypeLabel(p)}</em>
                    </span>
                    <TypedBindingCascader
                      className="param-bind"
                      value={draftParamBindings[p.name] ?? ''}
                      ambientVars={bindingAmbientVars}
                      targetType={p.typeExpr}
                      typeLibrary={typeLibrary}
                      placeholder="选择 API 入参"
                      onChange={(value) => updateParamBinding(p.name, value)}
                    />
                  </div>
                ))}
              </div>
            </Form.Item>
          ) : selectedBizMethod ? (
            <Form.Item label="入参绑定">
              <span className="method-hint">该方法无入参，无需绑定</span>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <ServiceApiParamsDialog
        open={inputsDialogVisible}
        onOpenChange={setInputsDialogVisible}
        inputs={draftInputs}
        typeLibrary={typeLibrary}
        typeOptions={namedTypeOptions}
        canSyncFromMethod={Boolean(selectedBizMethod)}
        onSave={saveInputsFromDialog}
        onSyncFromMethod={handleSyncInputsInDialog}
      />

      <TypeGenericArgsDialog
        open={genericVisible}
        onOpenChange={setGenericVisible}
        typeName={genericTypeName}
        genericNames={genericNames}
        args={genericArgs}
        typeOptions={namedTypeOptions}
        onSave={handleGenericSave}
      />
    </>
  )
}
