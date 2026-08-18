import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
} from 'antd'
import { ElMessage } from '../../ui/feedback'
import {
  getBackendServiceLibrary,
  getServiceControllers,
  getServiceProcessors,
} from '../../api/projects'
import type {
  BackendService,
  ProcessorTypeExpr,
  ServiceApi,
  ServiceApiParam,
  ServiceApiParamLocation,
  ServiceController,
  ServiceProcessor,
} from '../../types/backend-services'
import { createEmptyProcessorTypeExpr } from '../../types/backend-services'
import {
  createEmptyControllerBinding,
  type ControllerBindingConfig,
  type ControllerInputParamConfig,
  type ControllerInputSource,
  type DataField,
} from '../../types/page-data'
import {
  buildTypeLibraryAmbientDeclarations,
  countEventBindings,
  dataFieldToMethodParamType,
  dataFieldToTsType,
  dataFieldsToAmbientVars,
  type MethodParam,
  type MethodReturnType,
  type PageMethod,
} from '../../types/page-method'
import type { ComponentEventDef, ComponentPropDef } from '../../types/component'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import type { DataTypeDef, DataTypeLibrary, TypeExpr } from '../../types/data-types'
import { buildDollarPropsAmbientDeclaration } from '../../utils/component-props'
import { buildGetDeviceInfoAmbientDeclaration } from '../../utils/device-info'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import { resolveFlowReturnMethodParam } from './method-flow/method-flow-debug'
import TypedBindingCascader from './method-flow/TypedBindingCascader'
import TsCodeEditor, { type TsCodeEditorHandle } from './TsCodeEditor'
import EventBindDialog from './EventBindDialog'
import type { PageQueryParamDef } from '../../types/page-query'
import { buildQueryBindingRoot } from '../../utils/typed-binding-paths'
import './ControllerBindingDialog.css'

type EventKind = 'onLoading' | 'onSuccess' | 'onError' | 'onFinally'
type LiteralMode = 'scalar' | 'object' | 'json'
type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'array'

type ObjectFieldForm = {
  name: string
  remark: string
  kind: FieldKind
  enumOptions: string[]
}

export default function ControllerBindingDialog({
  open,
  onOpenChange,
  field,
  projectPath,
  methods,
  dataFields,
  xml,
  componentMap,
  componentMethodsMap,
  iconOptions,
  componentProps,
  emitEvents,
  typeLibrary,
  pageQueryParams,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  field: DataField | null
  projectPath: string
  methods?: PageMethod[]
  dataFields?: DataField[]
  xml?: string
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  iconOptions?: Array<{ id: string; label: string }>
  componentProps?: ComponentPropDef[] | null
  emitEvents?: ComponentEventDef[]
  typeLibrary?: DataTypeLibrary | null
  pageQueryParams?: PageQueryParamDef[] | null
  onSave?: (config: ControllerBindingConfig) => void
}) {
  const [draft, setDraftState] = useState<ControllerBindingConfig>(
    createEmptyControllerBinding(),
  )
  const draftRef = useRef(draft)
  draftRef.current = draft

  function setDraft(next: ControllerBindingConfig) {
    draftRef.current = next
    setDraftState(next)
  }

  const editorRef = useRef<TsCodeEditorHandle | null>(null)
  const [jsonTextDraft, setJsonTextDraftState] = useState<Record<string, string>>(
    {},
  )
  const jsonTextDraftRef = useRef(jsonTextDraft)
  jsonTextDraftRef.current = jsonTextDraft

  function setJsonTextDraft(next: Record<string, string>) {
    jsonTextDraftRef.current = next
    setJsonTextDraftState(next)
  }

  const [services, setServices] = useState<BackendService[]>([])
  const [controllers, setControllersState] = useState<ServiceController[]>([])
  const controllersRef = useRef(controllers)
  controllersRef.current = controllers

  function setControllers(next: ServiceController[]) {
    controllersRef.current = next
    setControllersState(next)
  }

  const [businessProcessors, setBusinessProcessors] = useState<ServiceProcessor[]>(
    [],
  )
  const [dataProcessors, setDataProcessors] = useState<ServiceProcessor[]>([])
  const [loadingServices, setLoadingServices] = useState(false)
  const [loadingControllers, setLoadingControllers] = useState(false)

  const [eventBindVisible, setEventBindVisible] = useState(false)
  const [eventBindKind, setEventBindKind] = useState<EventKind>('onLoading')

  const fieldName = field?.name.trim() || '未命名字段'

  const returnType = useMemo<MethodReturnType>(
    () => dataFieldToMethodParamType(field?.type ?? 'string'),
    [field?.type],
  )

  const returnTypeTs = field ? dataFieldToTsType(field, typeLibrary) : 'any'

  const selectedApi = useMemo<ServiceApi | null>(() => {
    const ctrl = controllers.find((c) => c.id === draft.controllerId)
    return ctrl?.apis.find((a) => a.id === draft.apiId) ?? null
  }, [controllers, draft.controllerId, draft.apiId])

  const apiDataParam = useMemo<MethodParam>(
    () =>
      resolveFlowReturnMethodParam({
        flow: selectedApi?.flow,
        dataProcessors,
        businessProcessors,
        typeLibrary,
      }),
    [selectedApi?.flow, dataProcessors, businessProcessors, typeLibrary],
  )

  const parseParams = useMemo<MethodParam[]>(() => [apiDataParam], [apiDataParam])

  const ambientExtra = useMemo(
    () =>
      [
        buildTypeLibraryAmbientDeclarations(typeLibrary),
        buildGetDeviceInfoAmbientDeclaration(),
        buildDollarPropsAmbientDeclaration(componentProps, typeLibrary),
      ]
        .filter(Boolean)
        .join('\n'),
    [typeLibrary, componentProps],
  )

  const functionName =
    fieldName === '未命名字段' ? 'parse' : `parse_${fieldName}`

  const apiOptions = useMemo(() => {
    const ctrl = controllers.find((c) => c.id === draft.controllerId)
    return ctrl?.apis ?? []
  }, [controllers, draft.controllerId])

  const bindingAmbientVars = useMemo(
    () =>
      dataFieldsToAmbientVars(
        (dataFields ?? []).filter(
          (f) => f.name.trim() && f.name.trim() !== fieldName,
        ),
        typeLibrary,
      ),
    [dataFields, fieldName, typeLibrary],
  )

  function queryExtraRoots(targetType: ProcessorTypeExpr | null | undefined) {
    const root = buildQueryBindingRoot(
      pageQueryParams,
      targetType,
      typeLibrary,
    )
    return root ? [root] : []
  }

  const eventRows = useMemo(
    () => [
      {
        kind: 'onLoading' as const,
        label: '开始加载',
        raw: draft.onLoading,
      },
      {
        kind: 'onSuccess' as const,
        label: '加载成功',
        raw: draft.onSuccess,
      },
      {
        kind: 'onError' as const,
        label: '加载失败',
        raw: draft.onError,
      },
      {
        kind: 'onFinally' as const,
        label: '加载结束',
        raw: draft.onFinally,
      },
    ],
    [draft.onLoading, draft.onSuccess, draft.onError, draft.onFinally],
  )

  const eventBindLabel =
    eventRows.find((r) => r.kind === eventBindKind)?.label ?? '事件'

  const eventBindRaw = draft[eventBindKind] ?? ''

  const controllerEventParams = useMemo<MethodParam[]>(() => {
    if (eventBindKind === 'onLoading' || eventBindKind === 'onFinally') {
      return []
    }
    if (eventBindKind === 'onError') {
      return [{ name: 'res', type: 'any', tsType: 'unknown' }]
    }
    if (!field) return [{ name: 'res', type: 'any', tsType: 'any' }]
    return [
      {
        name: 'res',
        type: dataFieldToMethodParamType(field.type),
        tsType: dataFieldToTsType(field, typeLibrary),
      },
    ]
  }, [eventBindKind, field, typeLibrary])

  function formatApiLabel(api: ServiceApi): string {
    const name = api.name.trim() || api.id
    const path = api.path.trim() || '/'
    return `${name} (${path}) · ${api.method}`
  }

  function formatControllerLabel(ctrl: ServiceController): string {
    const name = ctrl.name.trim() || ctrl.id
    return ctrl.path.trim() ? `${name} (${ctrl.path})` : name
  }

  function locationLabel(loc: ServiceApiParamLocation): string {
    switch (loc) {
      case 'query':
        return 'query'
      case 'param':
        return 'param'
      case 'body':
        return 'body'
      case 'httpHeader':
        return 'header'
      default:
        return loc
    }
  }

  function locationClass(loc: ServiceApiParamLocation): string {
    return `loc-${loc === 'httpHeader' ? 'header' : loc}`
  }

  function namedTypeLabel(typeRef: string): string {
    if (!typeRef) return ''
    return findDataTypeDef(typeLibrary, typeRef)?.name || typeRef
  }

  function apiParamTypeLabel(p: ServiceApiParam): string {
    if (p.typeRef) return namedTypeLabel(p.typeRef) || p.typeRef
    return p.type || 'string'
  }

  function apiParamToTypeExpr(p: ServiceApiParam): ProcessorTypeExpr {
    if (p.typeRef) {
      return {
        ...createEmptyProcessorTypeExpr('json'),
        typeRef: p.typeRef,
      }
    }
    return createEmptyProcessorTypeExpr(p.type || 'string')
  }

  function primaryAtom(expr: TypeExpr | undefined | null) {
    return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
  }

  function fieldKindFromTypeExpr(
    expr: TypeExpr,
    library: DataTypeLibrary | null | undefined,
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
      .map((f) => {
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

  function literalModeOf(p: ServiceApiParam): LiteralMode {
    if (p.type === 'array') return 'json'
    if (p.typeRef) {
      const def = findDataTypeDef(typeLibrary, p.typeRef)
      if (def?.kind === 'interface' && objectFieldsOf(def).length) return 'object'
      if (def?.kind === 'enum') return 'scalar'
      return 'json'
    }
    if (p.type === 'json') return 'json'
    return 'scalar'
  }

  function defaultLiteralForParam(p: ServiceApiParam): unknown {
    if (p.typeRef) {
      const def = findDataTypeDef(typeLibrary, p.typeRef)
      if (def?.kind === 'enum') return def.enumMembers[0]?.name ?? ''
      if (def?.kind === 'interface') {
        const obj: Record<string, unknown> = {}
        for (const f of objectFieldsOf(def)) {
          if (f.kind === 'number') obj[f.name] = 0
          else if (f.kind === 'boolean') obj[f.name] = false
          else if (f.kind === 'enum') obj[f.name] = f.enumOptions[0] ?? ''
          else if (f.kind === 'array') obj[f.name] = []
          else if (f.kind === 'json') obj[f.name] = {}
          else obj[f.name] = ''
        }
        return obj
      }
    }
    if (p.type === 'number') return 0
    if (p.type === 'boolean') return false
    if (p.type === 'array') return []
    if (p.type === 'json') return {}
    return ''
  }

  function syncInputsForApi(
    api: ServiceApi | null,
    prev: Record<string, ControllerInputParamConfig> | undefined,
  ): Record<string, ControllerInputParamConfig> {
    if (!api?.inputs?.length) return {}
    const next: Record<string, ControllerInputParamConfig> = {}
    const debug = api.debugParams ?? {}
    for (const inp of api.inputs) {
      const name = inp.varName.trim()
      if (!name) continue
      const old = prev?.[name]
      if (old) {
        next[name] = {
          source: old.source === 'binding' ? 'binding' : 'literal',
          ...(old.source === 'binding'
            ? { binding: old.binding ?? '' }
            : { literal: old.literal }),
        }
        continue
      }
      next[name] = {
        source: 'literal',
        literal: name in debug ? debug[name] : defaultLiteralForParam(inp),
      }
    }
    return next
  }

  function inputCfg(varName: string): ControllerInputParamConfig {
    return (
      draft.inputs?.[varName] ?? {
        source: 'literal' as const,
        literal: '',
      }
    )
  }

  function stringifyLiteral(literal: unknown): string {
    try {
      return literal === undefined ? '' : JSON.stringify(literal, null, 2)
    } catch {
      return ''
    }
  }

  function setInputSource(varName: string, source: ControllerInputSource) {
    const apiInp = selectedApi?.inputs.find((i) => i.varName.trim() === varName)
    const prev = inputCfg(varName)
    const next: ControllerInputParamConfig =
      source === 'binding'
        ? { source: 'binding', binding: prev.binding ?? '' }
        : {
            source: 'literal',
            literal:
              prev.literal !== undefined
                ? prev.literal
                : apiInp
                  ? defaultLiteralForParam(apiInp)
                  : '',
          }
    setDraft({
      ...draftRef.current,
      inputs: { ...(draftRef.current.inputs ?? {}), [varName]: next },
    })
    if (source === 'literal' && apiInp && literalModeOf(apiInp) === 'json') {
      syncJsonText(varName, next.literal)
    }
  }

  function setInputBinding(varName: string, binding: string) {
    setDraft({
      ...draftRef.current,
      inputs: {
        ...(draftRef.current.inputs ?? {}),
        [varName]: { source: 'binding', binding },
      },
    })
  }

  function setScalarLiteral(varName: string, value: unknown) {
    setDraft({
      ...draftRef.current,
      inputs: {
        ...(draftRef.current.inputs ?? {}),
        [varName]: { source: 'literal', literal: value },
      },
    })
  }

  function objectLiteral(varName: string): Record<string, unknown> {
    const lit = inputCfg(varName).literal
    if (lit && typeof lit === 'object' && !Array.isArray(lit)) {
      return { ...(lit as Record<string, unknown>) }
    }
    return {}
  }

  function setObjectField(varName: string, fieldName: string, value: unknown) {
    const obj = objectLiteral(varName)
    obj[fieldName] = value
    setScalarLiteral(varName, obj)
  }

  function syncJsonText(varName: string, literal: unknown) {
    setJsonTextDraft({
      ...jsonTextDraftRef.current,
      [varName]: stringifyLiteral(literal),
    })
  }

  function onJsonTextChange(varName: string, text: string) {
    setJsonTextDraft({ ...jsonTextDraftRef.current, [varName]: text })
    try {
      const parsed = text.trim() ? JSON.parse(text) : null
      setScalarLiteral(varName, parsed)
    } catch {
      // 编辑中允许非法 JSON，保存时再校验
    }
  }

  function objectFieldsForParam(p: ServiceApiParam): ObjectFieldForm[] {
    if (!p.typeRef) return []
    const def = findDataTypeDef(typeLibrary, p.typeRef)
    return objectFieldsOf(def)
  }

  function scalarKind(p: ServiceApiParam): FieldKind {
    if (p.typeRef) {
      const def = findDataTypeDef(typeLibrary, p.typeRef)
      if (def?.kind === 'enum') return 'enum'
    }
    if (p.type === 'number') return 'number'
    if (p.type === 'boolean') return 'boolean'
    return 'string'
  }

  function enumOptionsOf(p: ServiceApiParam): string[] {
    if (!p.typeRef) return []
    const def = findDataTypeDef(typeLibrary, p.typeRef)
    if (def?.kind !== 'enum') return []
    return def.enumMembers.map((m) => m.name).filter(Boolean)
  }

  async function loadServices() {
    if (!projectPath) {
      setServices([])
      return
    }
    setLoadingServices(true)
    try {
      const lib = await getBackendServiceLibrary(projectPath)
      setServices(lib.services ?? [])
    } catch (err) {
      setServices([])
      console.error(err)
      ElMessage.error('加载服务列表失败')
    } finally {
      setLoadingServices(false)
    }
  }

  async function loadControllers(serviceId: string) {
    if (!projectPath || !serviceId) {
      setControllers([])
      return
    }
    setLoadingControllers(true)
    try {
      const res = await getServiceControllers(projectPath, serviceId)
      setControllers(res.controllers ?? [])
    } catch (err) {
      setControllers([])
      console.error(err)
      ElMessage.error('加载控制器列表失败')
    } finally {
      setLoadingControllers(false)
    }
  }

  async function loadProcessors(serviceId: string) {
    if (!projectPath || !serviceId) {
      setBusinessProcessors([])
      setDataProcessors([])
      return
    }
    try {
      const [biz, data] = await Promise.all([
        getServiceProcessors(projectPath, serviceId, 'business'),
        getServiceProcessors(projectPath, serviceId, 'data'),
      ])
      setBusinessProcessors(biz.processors ?? [])
      setDataProcessors(data.processors ?? [])
    } catch (err) {
      setBusinessProcessors([])
      setDataProcessors([])
      console.error(err)
    }
  }

  function onServiceChange(serviceId: string) {
    setDraft({
      ...draftRef.current,
      serviceId,
      controllerId: '',
      apiId: '',
      inputs: {},
    })
    setJsonTextDraft({})
    void loadControllers(serviceId)
    void loadProcessors(serviceId)
  }

  function onControllerChange(controllerId: string) {
    setDraft({
      ...draftRef.current,
      controllerId,
      apiId: '',
      inputs: {},
    })
    setJsonTextDraft({})
  }

  function onApiChange(apiId: string) {
    const ctrl = controllersRef.current.find(
      (c) => c.id === draftRef.current.controllerId,
    )
    const api = ctrl?.apis.find((a) => a.id === apiId) ?? null
    const inputs = syncInputsForApi(api, draftRef.current.inputs)
    setDraft({
      ...draftRef.current,
      apiId,
      inputs,
    })
    const texts: Record<string, string> = {}
    let jsonDraft = { ...jsonTextDraftRef.current }
    for (const inp of api?.inputs ?? []) {
      const name = inp.varName.trim()
      if (!name) continue
      if (literalModeOf(inp) === 'json') {
        jsonDraft = {
          ...jsonDraft,
          [name]: stringifyLiteral(inputs[name]?.literal),
        }
        texts[name] = jsonDraft[name] ?? ''
      }
    }
    setJsonTextDraft({ ...jsonDraft, ...texts })
  }

  function openEventBind(kind: EventKind) {
    setEventBindKind(kind)
    setEventBindVisible(true)
  }

  function saveEventBind(value: string) {
    setDraft({
      ...draftRef.current,
      [eventBindKind]: value,
    })
  }

  function eventSummary(raw: string): string {
    const n = countEventBindings(raw)
    return n > 0 ? `已配置 ${n} 项` : '未配置'
  }

  function applyApiInputsAfterLoad(current: ControllerBindingConfig) {
    const ctrl = controllersRef.current.find((c) => c.id === current.controllerId)
    const api = ctrl?.apis.find((a) => a.id === current.apiId) ?? null
    if (!api) return
    const inputs = syncInputsForApi(api, current.inputs)
    setDraft({ ...draftRef.current, inputs })
    let jsonDraft = { ...jsonTextDraftRef.current }
    for (const inp of api.inputs) {
      const name = inp.varName.trim()
      if (!name) continue
      if (literalModeOf(inp) === 'json') {
        jsonDraft = {
          ...jsonDraft,
          [name]: stringifyLiteral(inputs[name]?.literal),
        }
      }
    }
    setJsonTextDraft(jsonDraft)
  }

  useEffect(() => {
    if (!open || !field) return
    let cancelled = false
    const base =
      field.controllerBinding ?? createEmptyControllerBinding(field.type)
    let parseBody = base.parseBody
    if (/\bresponse\b/.test(parseBody) && !/\bdata\b/.test(parseBody)) {
      parseBody = parseBody.replace(/\bresponse\b/g, 'data')
    }
    const nextDraft: ControllerBindingConfig = {
      ...createEmptyControllerBinding(field.type),
      ...base,
      parseBody,
      inputs: { ...(base.inputs ?? {}) },
    }
    setDraft(nextDraft)
    setJsonTextDraft({})

    void (async () => {
      await loadServices()
      if (cancelled) return
      if (draftRef.current.serviceId) {
        await Promise.all([
          loadControllers(draftRef.current.serviceId),
          loadProcessors(draftRef.current.serviceId),
        ])
        if (cancelled) return
        applyApiInputsAfterLoad(draftRef.current)
      } else {
        setControllers([])
        setBusinessProcessors([])
        setDataProcessors([])
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field])

  function handleSave() {
    const current = draftRef.current
    if (!current.serviceId || !current.controllerId || !current.apiId) {
      ElMessage.warning('请选择服务、控制器与 API')
      return
    }
    const ctrl = controllersRef.current.find((c) => c.id === current.controllerId)
    const api = ctrl?.apis.find((a) => a.id === current.apiId) ?? null
    if (api?.inputs?.length) {
      for (const inp of api.inputs) {
        const name = inp.varName.trim()
        if (!name) continue
        const cfg =
          current.inputs?.[name] ??
          ({ source: 'literal' as const, literal: '' } as ControllerInputParamConfig)
        if (cfg.source === 'binding') {
          if (inp.required && !(cfg.binding ?? '').trim()) {
            ElMessage.warning(`请为必填入参「${name}」选择绑定`)
            return
          }
          continue
        }
        if (literalModeOf(inp) === 'json') {
          const text = jsonTextDraftRef.current[name]
          if (text !== undefined && text.trim()) {
            try {
              JSON.parse(text)
            } catch {
              ElMessage.warning(`入参「${name}」的 JSON 不合法`)
              return
            }
          } else if (
            inp.required &&
            (cfg.literal === undefined || cfg.literal === null)
          ) {
            ElMessage.warning(`请填写必填入参「${name}」`)
            return
          }
        } else if (
          inp.required &&
          (cfg.literal === undefined ||
            cfg.literal === null ||
            cfg.literal === '')
        ) {
          ElMessage.warning(`请填写必填入参「${name}」`)
          return
        }
      }
    }
    const parseBody = editorRef.current?.getBody?.() ?? current.parseBody
    const inputs = syncInputsForApi(api, current.inputs)
    onSave?.({
      ...current,
      parseBody,
      inputs,
    })
    onOpenChange?.(false)
  }

  function stringifyObjectField(value: unknown, kind: FieldKind): string {
    try {
      return JSON.stringify(value ?? (kind === 'array' ? [] : {}))
    } catch {
      return ''
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={`控制器 · ${fieldName}`}
        width={820}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        className="controller-binding-dialog"
        styles={{ body: { overflow: 'visible' } }}
        onCancel={() => onOpenChange?.(false)}
        footer={
          <Button type="primary" onClick={handleSave}>
            保存
          </Button>
        }
      >
        <Form layout="vertical" className="bind-form">
          <Form.Item label="绑定 API" required>
            <div className="pick-row">
              <Select
                value={draft.serviceId || undefined}
                showSearch
                allowClear
                placeholder="服务"
                loading={loadingServices}
                optionFilterProp="label"
                style={{ flex: 1 }}
                options={services.map((s) => ({
                  value: s.id,
                  label: s.name || s.id,
                }))}
                onChange={(value) => onServiceChange(String(value || ''))}
              />
              <Select
                value={draft.controllerId || undefined}
                showSearch
                allowClear
                placeholder="控制器"
                disabled={!draft.serviceId}
                loading={loadingControllers}
                optionFilterProp="label"
                style={{ flex: 1 }}
                options={controllers.map((c) => ({
                  value: c.id,
                  label: formatControllerLabel(c),
                }))}
                onChange={(value) => onControllerChange(String(value || ''))}
              />
              <Select
                value={draft.apiId || undefined}
                showSearch
                allowClear
                placeholder="API"
                disabled={!draft.controllerId}
                optionFilterProp="label"
                style={{ flex: 1 }}
                options={apiOptions.map((api) => ({
                  value: api.id,
                  label: formatApiLabel(api),
                }))}
                onChange={(value) => onApiChange(String(value || ''))}
              />
            </div>
          </Form.Item>

          {selectedApi?.inputs?.length ? (
            <Form.Item label="入参">
              <div className="input-list">
                {selectedApi.inputs.map((inp) => {
                  const cfg = inputCfg(inp.varName)
                  const mode = literalModeOf(inp)
                  return (
                    <div key={inp.id || inp.varName} className="input-card">
                      <div className="input-head">
                        <span
                          className={`loc-badge ${locationClass(inp.location)}`}
                        >
                          {locationLabel(inp.location)}
                        </span>
                        <span className="input-name">
                          {inp.varName}
                          {inp.required ? <em className="req">*</em> : null}
                        </span>
                        <span className="input-type">
                          {apiParamTypeLabel(inp)}
                        </span>
                        <Radio.Group
                          value={cfg.source}
                          size="small"
                          className="source-radio"
                          optionType="button"
                          onChange={(e) =>
                            setInputSource(
                              inp.varName,
                              e.target.value as ControllerInputSource,
                            )
                          }
                        >
                          <Radio.Button value="literal">固定值</Radio.Button>
                          <Radio.Button value="binding">绑定</Radio.Button>
                        </Radio.Group>
                      </div>

                      {cfg.source === 'binding' ? (
                        <div className="input-body">
                          <TypedBindingCascader
                            value={cfg.binding ?? ''}
                            ambientVars={bindingAmbientVars}
                            targetType={apiParamToTypeExpr(inp)}
                            typeLibrary={typeLibrary}
                            extraRoots={queryExtraRoots(apiParamToTypeExpr(inp))}
                            placeholder="选择数据池或 $query"
                            onChange={(value) =>
                              setInputBinding(inp.varName, value)
                            }
                          />
                        </div>
                      ) : mode === 'object' ? (
                        <div className="input-body object-fields">
                          {objectFieldsForParam(inp).map((f) => (
                            <div key={f.name} className="prop-row">
                              <div className="prop-label">
                                <span className="prop-name">{f.name}</span>
                                {f.remark ? (
                                  <span className="prop-type">{f.remark}</span>
                                ) : null}
                              </div>
                              {f.kind === 'boolean' ? (
                                <Switch
                                  checked={Boolean(
                                    objectLiteral(inp.varName)[f.name],
                                  )}
                                  onChange={(checked) =>
                                    setObjectField(inp.varName, f.name, checked)
                                  }
                                />
                              ) : f.kind === 'number' ? (
                                <InputNumber
                                  value={Number(
                                    objectLiteral(inp.varName)[f.name] ?? 0,
                                  )}
                                  style={{ width: '100%' }}
                                  onChange={(value) =>
                                    setObjectField(
                                      inp.varName,
                                      f.name,
                                      Number(value ?? 0),
                                    )
                                  }
                                />
                              ) : f.kind === 'enum' ? (
                                <Select
                                  value={String(
                                    objectLiteral(inp.varName)[f.name] ?? '',
                                  )}
                                  allowClear
                                  style={{ width: '100%' }}
                                  options={f.enumOptions.map((opt) => ({
                                    value: opt,
                                    label: opt,
                                  }))}
                                  onChange={(value) =>
                                    setObjectField(
                                      inp.varName,
                                      f.name,
                                      value ?? '',
                                    )
                                  }
                                />
                              ) : f.kind === 'json' || f.kind === 'array' ? (
                                <Input.TextArea
                                  value={stringifyObjectField(
                                    objectLiteral(inp.varName)[f.name],
                                    f.kind,
                                  )}
                                  rows={2}
                                  onChange={(e) => {
                                    const t = e.target.value
                                    try {
                                      setObjectField(
                                        inp.varName,
                                        f.name,
                                        t.trim()
                                          ? JSON.parse(t)
                                          : f.kind === 'array'
                                            ? []
                                            : {},
                                      )
                                    } catch {
                                      /* editing */
                                    }
                                  }}
                                />
                              ) : (
                                <Input
                                  value={String(
                                    objectLiteral(inp.varName)[f.name] ?? '',
                                  )}
                                  onChange={(e) =>
                                    setObjectField(
                                      inp.varName,
                                      f.name,
                                      e.target.value,
                                    )
                                  }
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : mode === 'json' ? (
                        <div className="input-body">
                          <Input.TextArea
                            value={jsonTextDraft[inp.varName] ?? ''}
                            rows={4}
                            placeholder="JSON"
                            onChange={(e) =>
                              onJsonTextChange(inp.varName, e.target.value)
                            }
                          />
                        </div>
                      ) : (
                        <div className="input-body">
                          {scalarKind(inp) === 'boolean' ? (
                            <Switch
                              checked={Boolean(cfg.literal)}
                              onChange={(checked) =>
                                setScalarLiteral(inp.varName, checked)
                              }
                            />
                          ) : scalarKind(inp) === 'number' ? (
                            <InputNumber
                              value={Number(cfg.literal ?? 0)}
                              style={{ width: '100%' }}
                              onChange={(value) =>
                                setScalarLiteral(
                                  inp.varName,
                                  Number(value ?? 0),
                                )
                              }
                            />
                          ) : scalarKind(inp) === 'enum' ? (
                            <Select
                              value={String(cfg.literal ?? '')}
                              allowClear
                              style={{ width: '100%' }}
                              options={enumOptionsOf(inp).map((opt) => ({
                                value: opt,
                                label: opt,
                              }))}
                              onChange={(value) =>
                                setScalarLiteral(inp.varName, value ?? '')
                              }
                            />
                          ) : (
                            <Input
                              value={String(cfg.literal ?? '')}
                              onChange={(e) =>
                                setScalarLiteral(inp.varName, e.target.value)
                              }
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </Form.Item>
          ) : selectedApi ? (
            <Form.Item label="入参">
              <span className="hint-inline">该 API 无入参</span>
            </Form.Item>
          ) : null}

          <Form.Item label="自定义解析">
            <p className="hint">
              语法 TypeScript：形参 <code>data</code> 为所选 API 返回的
              <code>Result.data</code>（已解包，类型随 API）；
              <code>return</code> 的值写入本数据池字段（类型随字段）。
            </p>
            <TsCodeEditor
              ref={editorRef}
              value={draft.parseBody}
              onChange={(value) =>
                setDraft({ ...draftRef.current, parseBody: value })
              }
              functionName={functionName}
              params={parseParams}
              ambientExtra={ambientExtra}
              returnType={returnType}
              returnTypeTs={returnTypeTs}
            />
          </Form.Item>

          <Form.Item label="加载事件">
            <div className="event-list">
              <p className="event-hint">
                页面进入时会自动请求本接口；以下为加载过程中的可选钩子，未配置不影响拉数。
              </p>
              {eventRows.map((row) => (
                <div key={row.kind} className="event-row">
                  <div className="event-meta">
                    <span className="event-label">{row.label}</span>
                    <span className="event-summary">
                      {eventSummary(row.raw)}
                    </span>
                  </div>
                  <Button type="link" onClick={() => openEventBind(row.kind)}>
                    配置
                  </Button>
                </div>
              ))}
            </div>
          </Form.Item>
        </Form>
      </Modal>

      <EventBindDialog
        open={eventBindVisible}
        onOpenChange={setEventBindVisible}
        eventLabel={eventBindLabel}
        eventKey={eventBindKind}
        eventParams={controllerEventParams}
        rawValue={eventBindRaw}
        methods={methods ?? []}
        dataFields={dataFields ?? []}
        xml={xml}
        componentMap={componentMap}
        componentMethodsMap={componentMethodsMap}
        iconOptions={iconOptions}
        emitEvents={emitEvents}
        typeLibrary={typeLibrary}
        componentProps={componentProps}
        projectPath={projectPath}
        onSave={saveEventBind}
      />
    </>
  )
}
