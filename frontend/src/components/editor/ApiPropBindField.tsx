import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Select } from 'antd'
import { ElMessage } from '../../ui/feedback'
import {
  getBackendServiceLibrary,
  getServiceControllers,
} from '../../api/projects'
import type {
  BackendService,
  ProcessorTypeExpr,
  ServiceApi,
  ServiceApiParam,
  ServiceController,
} from '../../types/backend-services'
import {
  createEmptyProcessorTypeExpr,
  normalizeProcessorTypeExpr,
} from '../../types/backend-services'
import type { DataField } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import type { PageQueryParamDef } from '../../types/page-query'
import type { ComponentPropDef } from '../../types/component'
import {
  dataFieldsToAmbientVars,
  type MethodParam,
} from '../../types/page-method'
import {
  API_PROP_LITERAL_SELECT,
  apiMatchesApiPropConstraint,
  createEmptyApiPropBinding,
  isApiPropParamBoundConfigured,
  parseApiPropBinding,
  serializeApiPropBinding,
  type ApiPropBinding,
  type ApiPropParamBinding,
} from '../../utils/api-prop'
import {
  buildFlatSelectableBindingOptions,
  buildPropsBindingRoot,
  buildQueryBindingRoot,
} from '../../utils/typed-binding-paths'
import './ApiPropBindField.css'

export default function ApiPropBindField({
  value,
  onChange,
  projectPath,
  apiParams,
  apiReturnType,
  dataFields,
  componentProps,
  pageQueryParams,
  typeLibrary,
}: {
  value: string
  onChange?: (value: string) => void
  projectPath: string
  apiParams?: MethodParam[] | null
  apiReturnType?: ProcessorTypeExpr | null
  dataFields?: DataField[] | null
  componentProps?: ComponentPropDef[] | null
  pageQueryParams?: PageQueryParamDef[] | null
  typeLibrary?: DataTypeLibrary | null
}) {
  const [dialogVisible, setDialogVisible] = useState(false)
  const [services, setServices] = useState<BackendService[]>([])
  const [controllers, setControllers] = useState<ServiceController[]>([])
  const [loadingServices, setLoadingServices] = useState(false)
  const [loadingControllers, setLoadingControllers] = useState(false)
  const [saved, setSaved] = useState<ApiPropBinding>(createEmptyApiPropBinding())
  const [draft, setDraft] = useState<ApiPropBinding>(createEmptyApiPropBinding())

  useEffect(() => {
    setSaved(parseApiPropBinding(value ?? '') ?? createEmptyApiPropBinding())
  }, [value])

  useEffect(() => {
    if (!projectPath) {
      setServices([])
      return
    }
    let cancelled = false
    setLoadingServices(true)
    getBackendServiceLibrary(projectPath)
      .then((lib) => {
        if (!cancelled) setServices(lib.services ?? [])
      })
      .catch(() => {
        if (!cancelled) setServices([])
      })
      .finally(() => {
        if (!cancelled) setLoadingServices(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  const serviceIdForControllers = dialogVisible ? draft.serviceId : ''

  useEffect(() => {
    if (!projectPath || !serviceIdForControllers) {
      setControllers([])
      return
    }
    let cancelled = false
    setLoadingControllers(true)
    getServiceControllers(projectPath, serviceIdForControllers)
      .then((res) => {
        if (!cancelled) setControllers(res.controllers ?? [])
      })
      .catch(() => {
        if (!cancelled) setControllers([])
      })
      .finally(() => {
        if (!cancelled) setLoadingControllers(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, serviceIdForControllers])

  const selectedController = useMemo(
    () => controllers.find((c) => c.id === draft.controllerId) ?? null,
    [controllers, draft.controllerId],
  )

  const matchingApis = useMemo(() => {
    const apis = selectedController?.apis ?? []
    return apis.filter((api) =>
      apiMatchesApiPropConstraint(api, {
        apiParams,
        apiReturnType,
      }),
    )
  }, [selectedController, apiParams, apiReturnType])

  const selectedApi = useMemo((): ServiceApi | null => {
    const id = draft.apiId
    if (!id) return null
    return matchingApis.find((a) => a.id === id) ?? null
  }, [draft.apiId, matchingApis])

  const formalParamNames = useMemo(() => {
    const set = new Set<string>()
    for (const p of apiParams ?? []) {
      const n = p.name.trim()
      if (n) set.add(n)
    }
    return set
  }, [apiParams])

  const allApiInputs = useMemo((): ServiceApiParam[] => {
    if (!selectedApi) return []
    return (selectedApi.inputs ?? []).filter((inp) =>
      Boolean(inp.varName.trim()),
    )
  }, [selectedApi])

  const extraApiInputs = useMemo(
    (): ServiceApiParam[] =>
      allApiInputs.filter(
        (inp) => !formalParamNames.has(inp.varName.trim()),
      ),
    [allApiInputs, formalParamNames],
  )

  function isFormalParam(inp: ServiceApiParam): boolean {
    return formalParamNames.has(inp.varName.trim())
  }

  function apiParamTypeExpr(inp: ServiceApiParam): ProcessorTypeExpr {
    return normalizeProcessorTypeExpr({
      ...createEmptyProcessorTypeExpr(
        inp.typeRef ? 'json' : inp.type || 'string',
      ),
      type: inp.typeRef ? 'json' : inp.type || 'string',
      typeRef: inp.typeRef || '',
      genericArgs: { ...(inp.genericArgs ?? {}) },
    })
  }

  function apiParamTypeLabel(inp: ServiceApiParam): string {
    if (inp.typeRef) return inp.typeRef
    return inp.type || 'string'
  }

  const bindingAmbientVars = useMemo(
    (): MethodParam[] => dataFieldsToAmbientVars(dataFields ?? [], typeLibrary),
    [dataFields, typeLibrary],
  )

  function bindingExtraRoots(targetType: ProcessorTypeExpr) {
    const roots = []
    const query = buildQueryBindingRoot(
      pageQueryParams,
      targetType,
      typeLibrary,
    )
    if (query) roots.push(query)
    const dollarProps = buildPropsBindingRoot(
      componentProps,
      targetType,
      typeLibrary,
      'scalar-loose',
    )
    if (dollarProps) roots.push(dollarProps)
    return roots
  }

  function bindingOptionsFor(inp: ServiceApiParam) {
    const target = apiParamTypeExpr(inp)
    return buildFlatSelectableBindingOptions(
      bindingAmbientVars,
      target,
      typeLibrary,
      bindingExtraRoots(target),
      'scalar-loose',
    )
  }

  function syncParamBindingsForApi(
    api: ServiceApi | null,
    current: ApiPropBinding,
  ): ApiPropBinding {
    const next: Record<string, ApiPropParamBinding> = {}
    const prev = current.paramBindings ?? {}
    for (const inp of api?.inputs ?? []) {
      const name = inp.varName.trim()
      if (!name || formalParamNames.has(name)) continue
      const old = prev[name]
      if (old?.source === 'literal') {
        next[name] = { source: 'literal', literal: old.literal ?? '' }
      } else if (old?.source === 'binding' && (old.binding ?? '').trim()) {
        next[name] = { source: 'binding', binding: old.binding!.trim() }
      } else {
        next[name] = { source: 'binding', binding: '' }
      }
    }
    return { ...current, paramBindings: next }
  }

  useEffect(() => {
    if (!dialogVisible) return
    if (!selectedApi) return
    if (draft.apiId === selectedApi.id) {
      setDraft((prev) => syncParamBindingsForApi(selectedApi, prev))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApi, dialogVisible])

  function openDialog() {
    setDraft({
      ...saved,
      paramBindings: { ...(saved.paramBindings ?? {}) },
    })
    setDialogVisible(true)
  }

  function onServiceChange(serviceId: string | null) {
    setDraft((prev) => ({
      ...prev,
      serviceId: serviceId?.trim() || '',
      controllerId: '',
      apiId: '',
      paramBindings: {},
    }))
  }

  function onControllerChange(controllerId: string | null) {
    setDraft((prev) => ({
      ...prev,
      controllerId: controllerId?.trim() || '',
      apiId: '',
      paramBindings: {},
    }))
  }

  function onApiChange(apiId: string | null) {
    setDraft((prev) => {
      const next = {
        ...prev,
        apiId: apiId?.trim() || '',
      }
      const api = matchingApis.find((a) => a.id === next.apiId) ?? null
      return syncParamBindingsForApi(api, next)
    })
  }

  function paramBindingOf(name: string): ApiPropParamBinding {
    return draft.paramBindings?.[name] ?? { source: 'binding', binding: '' }
  }

  function paramSelectValue(name: string): string | undefined {
    const cfg = paramBindingOf(name)
    if (cfg.source === 'literal') return API_PROP_LITERAL_SELECT
    const b = (cfg.binding ?? '').trim()
    return b || undefined
  }

  function onParamSelectChange(name: string, nextValue: string | null | undefined) {
    const v = String(nextValue ?? '').trim()
    const next: ApiPropParamBinding =
      v === API_PROP_LITERAL_SELECT
        ? {
            source: 'literal',
            literal:
              paramBindingOf(name).source === 'literal'
                ? paramBindingOf(name).literal ?? ''
                : '',
          }
        : { source: 'binding', binding: v }
    setDraft((prev) => ({
      ...prev,
      paramBindings: {
        ...(prev.paramBindings ?? {}),
        [name]: next,
      },
    }))
  }

  function onParamLiteralChange(name: string, nextValue: string) {
    setDraft((prev) => ({
      ...prev,
      paramBindings: {
        ...(prev.paramBindings ?? {}),
        [name]: { source: 'literal', literal: nextValue },
      },
    }))
  }

  function apiLabel(api: ServiceApi): string {
    const method = (api.method || 'GET').toUpperCase()
    const path = api.path?.trim() || '/'
    return `${api.name || api.id} · ${method} ${path}`.trim()
  }

  const unmatchedHint = useMemo(() => {
    const total = selectedController?.apis?.length ?? 0
    const matched = matchingApis.length
    if (!draft.controllerId || total === 0) return ''
    if (matched === total) return ''
    return `已按入参/出参过滤：${matched}/${total} 个接口可选`
  }, [selectedController, matchingApis.length, draft.controllerId])

  const summaryText = useMemo(() => {
    const b = saved
    if (!b.serviceId || !b.controllerId || !b.apiId) return '未配置'
    const svc = services.find((s) => s.id === b.serviceId)?.name || b.serviceId
    return `${svc} / ${b.controllerId} / ${b.apiId}`
  }, [saved, services])

  function clearBinding() {
    setSaved(createEmptyApiPropBinding())
    onChange?.('')
  }

  function handleSave() {
    if (!draft.serviceId || !draft.controllerId || !draft.apiId) {
      ElMessage.warning('请选择服务、控制器与 API')
      return
    }
    const unbound = extraApiInputs
      .filter((inp) => inp.required)
      .map((inp) => inp.varName.trim())
      .filter(
        (name) => !isApiPropParamBoundConfigured(draft.paramBindings?.[name]),
      )
    if (unbound.length) {
      ElMessage.warning(`请完成入参绑定：${unbound.join('、')}`)
      return
    }
    const next = serializeApiPropBinding(draft)
    setSaved(parseApiPropBinding(next) ?? draft)
    onChange?.(next)
    setDialogVisible(false)
  }

  function literalPlaceholder(inp: ServiceApiParam): string {
    if (inp.type === 'number') return '输入数字常量'
    if (inp.type === 'boolean') return 'true / false'
    if (inp.type === 'time') return 'HH:mm:ss'
    if (inp.type === 'date') return 'YYYY-MM-DD'
    if (inp.type === 'datetime') return 'YYYY-MM-DD HH:mm:ss'
    return '输入常量'
  }

  return (
    <div className="api-prop-bind">
      <div className="summary-row">
        <span className="summary-text" title={summaryText}>
          {summaryText}
        </span>
        <Button type="link" onClick={openDialog}>
          配置
        </Button>
        {saved.serviceId ? (
          <Button type="link" danger onClick={clearBinding}>
            清除
          </Button>
        ) : null}
      </div>

      <Modal
        open={dialogVisible}
        title="配置后端 API"
        width={560}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setDialogVisible(false)}
        footer={
          <>
            <Button onClick={() => setDialogVisible(false)}>取消</Button>
            <Button type="primary" onClick={handleSave}>
              确定
            </Button>
          </>
        }
      >
        <Form layout="vertical" className="bind-form">
          <Form.Item label="后端服务" required>
            <Select
              value={draft.serviceId || undefined}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择后端服务"
              loading={loadingServices}
              style={{ width: '100%' }}
              options={services.map((svc) => ({
                value: svc.id,
                label: svc.name || svc.id,
              }))}
              onChange={(next) => onServiceChange(next ?? null)}
            />
          </Form.Item>
          <Form.Item label="控制器" required>
            <Select
              value={draft.controllerId || undefined}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择控制器"
              loading={loadingControllers}
              disabled={!draft.serviceId}
              style={{ width: '100%' }}
              options={controllers.map((ctrl) => ({
                value: ctrl.id,
                label: `${ctrl.name || ctrl.id}${ctrl.path ? ` · ${ctrl.path}` : ''}`,
              }))}
              onChange={(next) => onControllerChange(next ?? null)}
            />
          </Form.Item>
          <Form.Item label="API" required>
            <Select
              value={draft.apiId || undefined}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择 API（组件形参与出参须匹配）"
              disabled={!draft.controllerId}
              style={{ width: '100%' }}
              options={matchingApis.map((api) => ({
                value: api.id,
                label: apiLabel(api),
              }))}
              onChange={(next) => onApiChange(next ?? null)}
            />
            {unmatchedHint ? <p className="hint">{unmatchedHint}</p> : null}
          </Form.Item>

          {selectedApi && allApiInputs.length ? (
            <Form.Item
              label="入参绑定"
              required={extraApiInputs.some((i) => i.required)}
            >
              <div className="param-bindings">
                {allApiInputs.map((inp) => (
                  <div
                    key={inp.id}
                    className={`param-row${isFormalParam(inp) ? ' is-formal' : ''}`}
                  >
                    <span
                      className="param-name"
                      title={`${inp.remark || inp.varName} · ${apiParamTypeLabel(inp)}`}
                    >
                      {inp.varName}
                      {inp.required && !isFormalParam(inp) ? (
                        <em className="req">*</em>
                      ) : null}
                      <em className="param-type">{apiParamTypeLabel(inp)}</em>
                    </span>
                    {isFormalParam(inp) ? (
                      <Input
                        className="param-bind"
                        value="由调用时传入（形参）"
                        disabled
                      />
                    ) : (
                      <div className="param-bind-row">
                        <Select
                          className="param-source"
                          value={paramSelectValue(inp.varName)}
                          showSearch
                          allowClear
                          optionFilterProp="label"
                          placeholder="选择数据池 / $query / $props"
                          options={[
                            { label: '常量', value: API_PROP_LITERAL_SELECT },
                            ...bindingOptionsFor(inp).map((opt) => ({
                              value: opt.value,
                              label: opt.label,
                            })),
                          ]}
                          onChange={(next) =>
                            onParamSelectChange(inp.varName, next ?? null)
                          }
                        />
                        {paramBindingOf(inp.varName).source === 'literal' ? (
                          <Input
                            className="param-literal"
                            value={paramBindingOf(inp.varName).literal ?? ''}
                            placeholder={literalPlaceholder(inp)}
                            onChange={(e) =>
                              onParamLiteralChange(inp.varName, e.target.value)
                            }
                          />
                        ) : null}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="hint">
                组件形参由调用时传入（置灰）；其余 API 入参在此绑定。
              </p>
            </Form.Item>
          ) : selectedApi ? (
            <Form.Item label="入参绑定">
              <span className="hint">该方法无入参</span>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  )
}
