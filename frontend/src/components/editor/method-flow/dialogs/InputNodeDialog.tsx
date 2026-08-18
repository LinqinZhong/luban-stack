import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Select } from 'antd'
import { getServiceProcessors } from '../../../../api/projects'
import type {
  ProcessorMethodParam,
  ServiceProcessor,
} from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import TypedBindingCascader from '../TypedBindingCascader'
import FlowPrintField from '../FlowPrintField'
import DataMethodConditionsEditor from '../../DataMethodConditionsEditor'
import {
  buildConditionFieldOptions,
  serializeConditionGroups,
} from '../../../../utils/data-method-conditions'
import {
  INPUT_HEADER_CUSTOM,
  INPUT_HEADER_FIELD_OPTIONS,
  INPUT_HEADER_PRESET_FIELDS,
  createEmptyInputNodeForm,
  normalizeInputDataSource,
  type InputDataSource,
  type InputModuleOption,
  type InputNodeForm,
} from './input-node'
import './InputNodeDialog.css'

type MethodOpt = {
  value: string
  label: string
  processorId: string
  methodId: string
}

export default function InputNodeDialog({
  open,
  onOpenChange,
  form,
  projectPath,
  currentServiceId,
  moduleOptions,
  businessProcessors,
  dataProcessors,
  currentProcessorId,
  currentMethodId,
  sourceMode = 'all',
  reservedNames,
  ambientVars,
  typeLibrary,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: InputNodeForm
  projectPath: string
  currentServiceId: string
  moduleOptions: InputModuleOption[]
  businessProcessors: ServiceProcessor[]
  dataProcessors: ServiceProcessor[]
  currentProcessorId: string
  currentMethodId: string
  sourceMode?: 'all' | 'business'
  reservedNames: string[]
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
  onSave?: (form: InputNodeForm) => void
}) {
  const [draft, setDraft] = useState<InputNodeForm>(createEmptyInputNodeForm())
  const [headerKind, setHeaderKind] = useState('user-id')
  const [customHeaderName, setCustomHeaderName] = useState('')
  const [remoteBusiness, setRemoteBusiness] = useState<ServiceProcessor[]>([])
  const [remoteData, setRemoteData] = useState<ServiceProcessor[]>([])
  const [loadingProcessors, setLoadingProcessors] = useState(false)
  const hydratingFormRef = useRef(false)
  const processorCacheRef = useRef(
    new Map<string, { business: ServiceProcessor[]; data: ServiceProcessor[] }>(),
  )
  const prevSourceRef = useRef<InputDataSource>(draft.dataSource)
  const prevServiceRef = useRef(draft.serviceId)
  const propsRef = useRef({
    projectPath,
    currentServiceId,
    businessProcessors,
    dataProcessors,
  })
  propsRef.current = {
    projectPath,
    currentServiceId,
    businessProcessors,
    dataProcessors,
  }

  const businessOnly = sourceMode === 'business'
  const isHeaderSource = draft.dataSource === 'request_header'
  const isBusinessSource = draft.dataSource === 'business'

  const layerOptions = useMemo(() => {
    const opts: Array<{ value: InputDataSource; label: string }> = [
      { value: 'business', label: '业务层' },
    ]
    if (!businessOnly) {
      opts.push({ value: 'data', label: '数据层' })
      opts.push({ value: 'request_header', label: '请求头' })
    }
    return opts
  }, [businessOnly])

  const methodFieldLabel = isHeaderSource
    ? '请求头字段'
    : isBusinessSource || businessOnly
      ? '业务方法'
      : '数据层方法'

  function isPresetHeader(field: string): boolean {
    return (INPUT_HEADER_PRESET_FIELDS as readonly string[]).includes(field)
  }

  function syncHeaderUiFromField(field: string) {
    if (!field) {
      setHeaderKind('user-id')
      setCustomHeaderName('')
      return
    }
    if (isPresetHeader(field)) {
      setHeaderKind(field)
      setCustomHeaderName('')
      return
    }
    setHeaderKind(INPUT_HEADER_CUSTOM)
    setCustomHeaderName(field)
  }

  function resolvedHeaderField(): string {
    if (headerKind === INPUT_HEADER_CUSTOM) {
      return customHeaderName.trim()
    }
    return headerKind.trim()
  }

  function coerceLayer(source: InputDataSource): InputDataSource {
    if (businessOnly) return 'business'
    if (source === 'request_header') return 'request_header'
    if (source === 'business' || source === 'data') return source
    return 'data'
  }

  function clearMethodSelection(current: InputNodeForm): InputNodeForm {
    return {
      ...current,
      dataProcessorId: '',
      dataMethodId: '',
      methodLabel: '',
      paramBindings: {},
      conditionGroups: [],
    }
  }

  async function ensureProcessorsForModule(serviceId: string) {
    const sid = serviceId.trim()
    const {
      projectPath: path,
      currentServiceId: curSid,
      businessProcessors: biz,
      dataProcessors: data,
    } = propsRef.current
    if (!sid || !path) {
      setRemoteBusiness([])
      setRemoteData([])
      return
    }
    if (sid === curSid) {
      setRemoteBusiness(biz)
      setRemoteData(data)
      return
    }
    const cached = processorCacheRef.current.get(sid)
    if (cached) {
      setRemoteBusiness(cached.business)
      setRemoteData(cached.data)
      return
    }
    setLoadingProcessors(true)
    try {
      const [bizRes, dataRes] = await Promise.all([
        getServiceProcessors(path, sid, 'business'),
        getServiceProcessors(path, sid, 'data'),
      ])
      const next = {
        business: bizRes.processors ?? [],
        data: dataRes.processors ?? [],
      }
      processorCacheRef.current.set(sid, next)
      setRemoteBusiness(next.business)
      setRemoteData(next.data)
    } catch {
      setRemoteBusiness([])
      setRemoteData([])
    } finally {
      setLoadingProcessors(false)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    hydratingFormRef.current = true
    ;(async () => {
      const next: InputNodeForm = createEmptyInputNodeForm({
        ...form,
        paramBindings: { ...(form.paramBindings ?? {}) },
        conditionGroups: (form.conditionGroups ?? []).map((g) => ({
          ...g,
          conditions: (g.conditions ?? []).map((c) => ({ ...c })),
        })),
        network: form.network,
      })
      next.dataSource = coerceLayer(
        normalizeInputDataSource(next.dataSource, { businessOnly }),
      )
      if (!next.serviceId.trim()) {
        next.serviceId = currentServiceId
      }
      prevSourceRef.current = next.dataSource
      prevServiceRef.current = next.serviceId
      setDraft(next)
      syncHeaderUiFromField(next.headerField)
      if (next.dataSource !== 'request_header') {
        await ensureProcessorsForModule(next.serviceId)
      }
      if (!cancelled) hydratingFormRef.current = false
    })()
    return () => {
      cancelled = true
    }
  }, [open, form])

  useEffect(() => {
    if (!open || hydratingFormRef.current) return
    if (draft.dataSource === prevSourceRef.current) return
    prevSourceRef.current = draft.dataSource
    setDraft((d) => {
      let next = clearMethodSelection(d)
      if (d.dataSource === 'request_header') {
        setHeaderKind('user-id')
        setCustomHeaderName('')
        next = { ...next, headerField: 'user-id' }
        return next
      }
      if (!next.serviceId.trim()) {
        next = { ...next, serviceId: currentServiceId }
      }
      void ensureProcessorsForModule(next.serviceId)
      return next
    })
  }, [draft.dataSource, open, currentServiceId])

  useEffect(() => {
    if (!open || hydratingFormRef.current || isHeaderSource) return
    if (draft.serviceId === prevServiceRef.current) return
    prevServiceRef.current = draft.serviceId
    setDraft((d) => clearMethodSelection(d))
    void ensureProcessorsForModule(draft.serviceId)
  }, [draft.serviceId, open, isHeaderSource])

  useEffect(() => {
    if (!open || !isHeaderSource) return
    if (headerKind === INPUT_HEADER_CUSTOM) {
      setDraft((d) => ({ ...d, headerField: customHeaderName.trim() }))
    } else {
      setDraft((d) => ({ ...d, headerField: headerKind }))
      setCustomHeaderName('')
    }
  }, [headerKind, open, isHeaderSource])

  useEffect(() => {
    if (!open || headerKind !== INPUT_HEADER_CUSTOM) return
    setDraft((d) => ({ ...d, headerField: customHeaderName.trim() }))
  }, [customHeaderName, open, headerKind])

  function collectMethods(
    processors: ServiceProcessor[],
    filter?: (proc: ServiceProcessor, methodId: string) => boolean,
  ): MethodOpt[] {
    const opts: MethodOpt[] = []
    for (const proc of processors) {
      for (const m of proc.methods) {
        if (filter && !filter(proc, m.id)) continue
        const name = m.name.trim() || m.id
        opts.push({
          value: `${proc.id}::${m.id}`,
          label: `${proc.name || proc.id}.${name}`,
          processorId: proc.id,
          methodId: m.id,
        })
      }
    }
    return opts
  }

  const activeProcessors = isHeaderSource
    ? ([] as ServiceProcessor[])
    : isBusinessSource
      ? remoteBusiness
      : remoteData

  const methodOptions = useMemo((): MethodOpt[] => {
    if (isHeaderSource) return []
    const sameModule = draft.serviceId.trim() === currentServiceId
    if (isBusinessSource) {
      return collectMethods(remoteBusiness, (proc, methodId) => {
        if (
          sameModule &&
          currentProcessorId &&
          proc.id === currentProcessorId &&
          methodId === currentMethodId
        ) {
          return false
        }
        return true
      })
    }
    return collectMethods(remoteData)
  }, [
    isHeaderSource,
    isBusinessSource,
    draft.serviceId,
    currentServiceId,
    currentProcessorId,
    currentMethodId,
    remoteBusiness,
    remoteData,
  ])

  const selectedMethod = useMemo(() => {
    for (const proc of activeProcessors) {
      if (proc.id !== draft.dataProcessorId) continue
      const method = proc.methods.find((m) => m.id === draft.dataMethodId)
      if (method) return method
    }
    return null
  }, [activeProcessors, draft.dataProcessorId, draft.dataMethodId])

  const methodParams = useMemo(
    (): ProcessorMethodParam[] =>
      (selectedMethod?.params ?? []).filter((p) => p.name.trim()),
    [selectedMethod],
  )

  const selectedProcessor =
    activeProcessors.find((p) => p.id === draft.dataProcessorId) ?? null

  const showCallsiteConditions = useMemo(() => {
    if (isHeaderSource || isBusinessSource) {
      return false
    }
    if (!draft.dataProcessorId || !draft.dataMethodId) return false
    if (selectedMethod?.dataConfig?.source === 'http') return false
    const op = selectedMethod?.dataConfig?.operation
    if (op === 'query' || op === 'delete' || op === 'update') return true
    if (op === 'insert' || op === 'batchInsert' || op === 'custom') return false
    const id = draft.dataMethodId
    if (/save|insert|batch/i.test(id)) return false
    return /^(preset_)?(one|page|count|find|list|get|delete|hardDelete|update)/i.test(
      id,
    )
  }, [
    isHeaderSource,
    isBusinessSource,
    draft.dataProcessorId,
    draft.dataMethodId,
    selectedMethod,
  ])

  const callsiteConditionFieldOptions = useMemo(
    () =>
      buildConditionFieldOptions(
        typeLibrary,
        selectedProcessor?.entityRef ?? '',
      ),
    [typeLibrary, selectedProcessor],
  )

  const ambientHint = ambientVars.map((v) => v.name).filter(Boolean).join(', ')

  function syncParamBindings(
    params: ProcessorMethodParam[],
    current: Record<string, string>,
  ): Record<string, string> {
    const next: Record<string, string> = {}
    for (const p of params) {
      const name = p.name.trim()
      if (!name) continue
      next[name] = current[name] ?? ''
    }
    return next
  }

  const selectedMethodKey =
    draft.dataProcessorId && draft.dataMethodId
      ? `${draft.dataProcessorId}::${draft.dataMethodId}`
      : ''

  function setSelectedMethodKey(key: string | null) {
    const opt = methodOptions.find((o) => o.value === key)
    if (!opt) {
      setDraft((d) => clearMethodSelection(d))
      return
    }
    const method = activeProcessors
      .find((p) => p.id === opt.processorId)
      ?.methods.find((m) => m.id === opt.methodId)
    const op = method?.dataConfig?.operation
    setDraft((d) => ({
      ...d,
      dataProcessorId: opt.processorId,
      dataMethodId: opt.methodId,
      methodLabel: opt.label,
      paramBindings: syncParamBindings(method?.params ?? [], d.paramBindings),
      conditionGroups:
        op !== 'query' && op !== 'delete' && op !== 'update'
          ? []
          : d.conditionGroups,
    }))
  }

  useEffect(() => {
    if (isHeaderSource) return
    if (!methodParams.length && !Object.keys(draft.paramBindings).length) return
    const next = syncParamBindings(methodParams, draft.paramBindings)
    const same =
      Object.keys(next).length === Object.keys(draft.paramBindings).length &&
      Object.keys(next).every((k) => next[k] === draft.paramBindings[k])
    if (same) return
    setDraft((d) => ({ ...d, paramBindings: next }))
  }, [methodParams, isHeaderSource])

  function identError(name: string, label: string, required: boolean): string {
    const n = name.trim()
    if (!n) return required ? `请填写${label}` : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
      return `${label}须为合法标识符`
    }
    if (reservedNames.includes(n)) {
      return `${label}与已有名称冲突`
    }
    return ''
  }

  const varNameError = identError(draft.varName, '变量名', true)

  const bindingError = useMemo(() => {
    if (isHeaderSource) return ''
    for (const p of methodParams) {
      const name = p.name.trim()
      if (!name) continue
      if (!(draft.paramBindings[name] ?? '').trim()) {
        return `请绑定入参「${name}」`
      }
    }
    return ''
  }, [isHeaderSource, methodParams, draft.paramBindings])

  const headerError = useMemo(() => {
    if (!isHeaderSource) return ''
    if (headerKind === INPUT_HEADER_CUSTOM) {
      if (!customHeaderName.trim()) return '请填写自定义请求头名'
      return ''
    }
    if (!headerKind.trim()) return '请选择请求头字段'
    return ''
  }, [isHeaderSource, headerKind, customHeaderName])

  const moduleError =
    isHeaderSource ? '' : draft.serviceId.trim() ? '' : '请选择模块'

  function paramTypeLabel(p: ProcessorMethodParam): string {
    return processorTypeExprToTs(p.typeExpr, typeLibrary)
  }

  const canSave = (() => {
    if (varNameError) return false
    if (isHeaderSource) return !headerError
    return (
      !moduleError &&
      !bindingError &&
      Boolean(draft.dataProcessorId && draft.dataMethodId)
    )
  })()

  function handleSave() {
    if (!canSave) return
    if (isHeaderSource) {
      const field = resolvedHeaderField()
      onSave?.({
        ...createEmptyInputNodeForm(),
        channel: 'local',
        serviceId: '',
        dataSource: 'request_header',
        headerField: field,
        varName: draft.varName.trim(),
        methodLabel: `请求头.${field}`,
        printExpr: draft.printExpr.trim(),
      })
      onOpenChange?.(false)
      return
    }
    const paramBindings: Record<string, string> = {}
    for (const p of methodParams) {
      const name = p.name.trim()
      if (!name) continue
      paramBindings[name] = (draft.paramBindings[name] ?? '').trim()
    }
    onSave?.({
      ...createEmptyInputNodeForm(),
      channel: 'local',
      serviceId: draft.serviceId.trim() || currentServiceId,
      dataSource: draft.dataSource,
      dataProcessorId: draft.dataProcessorId,
      dataMethodId: draft.dataMethodId,
      headerField: '',
      varName: draft.varName.trim(),
      methodLabel: draft.methodLabel,
      paramBindings,
      conditionGroups: showCallsiteConditions
        ? serializeConditionGroups(draft.conditionGroups)
        : [],
      printExpr: draft.printExpr.trim(),
      outputTypeExpr: selectedMethod?.output
        ? { ...selectedMethod.output }
        : null,
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑输入节点"
      width={560}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button type="primary" disabled={!canSave} onClick={handleSave}>
          确定
        </Button>
      }
    >
      <Form
        className="flow-node-form"
        size="small"
        labelAlign="right"
        labelCol={{ flex: '110px' }}
        wrapperCol={{ flex: 1 }}
      >
        {!isHeaderSource ? (
          <Form.Item
            label="模块"
            required
            validateStatus={moduleError ? 'error' : undefined}
            help={moduleError || undefined}
          >
            <Select
              value={draft.serviceId || undefined}
              showSearch
              placeholder="选择模块"
              style={{ width: '100%' }}
              options={moduleOptions.map((opt) => ({
                value: opt.id,
                label: opt.name ? `${opt.name}（${opt.id}）` : opt.id,
              }))}
              onChange={(serviceId) =>
                setDraft((d) => ({ ...d, serviceId: serviceId ?? '' }))
              }
            />
          </Form.Item>
        ) : null}

        {layerOptions.length > 1 ? (
          <Form.Item label="层" required>
            <Select
              value={draft.dataSource}
              placeholder="选择层"
              style={{ width: '100%' }}
              options={layerOptions}
              onChange={(dataSource) => setDraft((d) => ({ ...d, dataSource }))}
            />
          </Form.Item>
        ) : null}

        {isHeaderSource ? (
          <Form.Item
            label="请求头字段"
            required
            validateStatus={headerError ? 'error' : undefined}
            help={headerError || undefined}
          >
            <div className="header-field-block">
              <Select
                value={headerKind}
                placeholder="选择请求头字段"
                style={{ width: '100%' }}
                options={INPUT_HEADER_FIELD_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                onChange={setHeaderKind}
              />
              {headerKind === INPUT_HEADER_CUSTOM ? (
                <Input
                  className="custom-header-input"
                  value={customHeaderName}
                  placeholder="自定义请求头名，如 X-Request-Id"
                  maxLength={128}
                  onChange={(e) => setCustomHeaderName(e.target.value)}
                />
              ) : null}
            </div>
          </Form.Item>
        ) : (
          <>
            <Form.Item label={methodFieldLabel} required>
              <Select
                value={selectedMethodKey || undefined}
                showSearch
                allowClear
                loading={loadingProcessors}
                placeholder={
                  isBusinessSource || businessOnly
                    ? '选择业务层方法'
                    : '选择数据层方法'
                }
                style={{ width: '100%' }}
                options={methodOptions.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                onChange={(key) => setSelectedMethodKey(key ?? null)}
              />
              {!loadingProcessors && !methodOptions.length ? (
                <p className="hint">
                  {isBusinessSource || businessOnly
                    ? '该模块暂无业务层方法'
                    : '该模块暂无数据层方法'}
                </p>
              ) : null}
            </Form.Item>

            {methodParams.length ? (
              <Form.Item
                label="绑定入参"
                required
                validateStatus={bindingError ? 'error' : undefined}
                help={bindingError || undefined}
              >
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
                        value={draft.paramBindings[p.name] ?? ''}
                        onChange={(expr) =>
                          setDraft((d) => ({
                            ...d,
                            paramBindings: {
                              ...d.paramBindings,
                              [p.name]: expr,
                            },
                          }))
                        }
                        ambientVars={ambientVars}
                        targetType={p.typeExpr}
                        typeLibrary={typeLibrary}
                      />
                    </div>
                  ))}
                </div>
              </Form.Item>
            ) : selectedMethodKey ? (
              <Form.Item label="绑定入参">
                <span className="hint-inline">该方法无入参</span>
              </Form.Item>
            ) : null}

            {showCallsiteConditions ? (
              <Form.Item label="查询条件" className="conditions-item">
                <p className="hint" style={{ marginTop: 0 }}>
                  与方法内条件同时成立（AND）；组内 AND，组间 OR
                </p>
                <DataMethodConditionsEditor
                  value={draft.conditionGroups}
                  onChange={(conditionGroups) =>
                    setDraft((d) => ({ ...d, conditionGroups }))
                  }
                  fieldOptions={callsiteConditionFieldOptions}
                  ambientVars={ambientVars}
                  typeLibrary={typeLibrary}
                  paramLabel="变量"
                  pickParamLabel="选择变量"
                  pickParamToLabel="上界变量"
                  ambientHint={ambientHint}
                />
              </Form.Item>
            ) : null}
          </>
        )}

        <Form.Item
          label="结果变量名"
          required
          validateStatus={draft.varName && varNameError ? 'error' : undefined}
          help={draft.varName ? varNameError : ''}
        >
          <Input
            value={draft.varName}
            placeholder="如 goodsList"
            maxLength={64}
            onChange={(e) =>
              setDraft((d) => ({ ...d, varName: e.target.value }))
            }
          />
        </Form.Item>
        <Form.Item label="打印">
          <FlowPrintField
            value={draft.printExpr}
            onChange={(printExpr) => setDraft((d) => ({ ...d, printExpr }))}
            ambientNames={ambientVars.map((v) => v.name).filter(Boolean)}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
