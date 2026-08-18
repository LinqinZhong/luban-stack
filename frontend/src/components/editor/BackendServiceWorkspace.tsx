import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Button,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Skeleton,
  Table,
} from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  getServiceControllers,
  getServiceProcessors,
  saveServiceControllers as saveServiceControllersApi,
} from '../../api/projects'
import {
  createDefaultMethodFlow,
  createEmptyDataMethodConfig,
  createEmptyProcessorTypeExpr,
  createEmptyServiceApi,
  createEmptyServiceController,
  isValidControllerName,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ServiceApi,
  type ServiceApiParamLocation,
  type ServiceController,
  type ServiceProcessor,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import EditServiceApiDialog, {
  type ServiceApiEditPayload,
} from './EditServiceApiDialog'
import ServiceProcessorPanel, {
  isSameProcessorDebugTarget,
  type ProcessorDebugTarget,
  type ProcessorSelectionState,
  type ServiceProcessorPanelHandle,
} from './ServiceProcessorPanel'
import type { DataMethodUsageRef } from '../../utils/data-method-usage'
import './BackendServiceWorkspace.css'

type ServiceLayer = 'controller' | 'service' | 'data' | 'schedule'

export type BackendServiceWorkspaceHandle = {
  applyDebugParams: (params: Record<string, unknown>) => void
  applyFlowDebugCursor: (state: {
    cursorNodeId: string | null
    visitedNodeIds: string[]
    printByNode?: Record<string, string>
  }) => void
  openBusinessFlowAt: (options: {
    processorId: string
    methodId: string
    focusNodeId?: string
  }) => boolean
  openCreateController: () => void
  addApi: () => void
  openCreateProcessor: () => void
  addProcessorMethod: () => void
}

export default forwardRef<
  BackendServiceWorkspaceHandle,
  {
    projectPath: string
    serviceId: string
    serviceName: string
    typeLibrary: DataTypeLibrary | null
    moduleOptions?: Array<{ id: string; name: string }>
    layer?: ServiceLayer
    restoredControllerId?: string
    restoredBusiness?: {
      processorId: string
      methodId: string
      flowEditing: {
        processorId: string
        methodId: string
        focusNodeId?: string
      } | null
    } | null
    restoredData?: {
      processorId: string
      methodId: string
    } | null
    onLayerChange?: (layer: ServiceLayer) => void
    onDebugTargetChange?: (target: ProcessorDebugTarget | null) => void
    onControllerIdChange?: (id: string) => void
    onBusinessSelectionChange?: (state: ProcessorSelectionState) => void
    onDataSelectionChange?: (state: ProcessorSelectionState) => void
    onNavigateUsage?: (ref: DataMethodUsageRef) => void
  }
>(function BackendServiceWorkspace(
  {
    projectPath,
    serviceId,
    typeLibrary,
    moduleOptions,
    layer,
    restoredControllerId,
    restoredBusiness,
    restoredData,
    onDebugTargetChange,
    onControllerIdChange,
    onBusinessSelectionChange,
    onDataSelectionChange,
    onNavigateUsage,
  },
  ref,
) {
  const dataProcessorPanelRef = useRef<ServiceProcessorPanelHandle | null>(null)
  const businessProcessorPanelRef = useRef<ServiceProcessorPanelHandle | null>(
    null,
  )

  const activeLayer = layer ?? 'controller'
  const [controllers, setControllers] = useState<ServiceController[]>([])
  const [activeControllerId, setActiveControllerId] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogVisible, setDialogVisible] = useState(false)
  const [dialogName, setDialogName] = useState('')
  const [dialogPath, setDialogPath] = useState('')
  const [dialogRemark, setDialogRemark] = useState('')
  const [editingControllerId, setEditingControllerId] = useState<string | null>(
    null,
  )

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [apiDialogVisible, setApiDialogVisible] = useState(false)
  const [apiEditIndex, setApiEditIndex] = useState(-1)
  const [apiDraft, setApiDraft] = useState<ServiceApi | null>(null)
  const [selectedApiId, setSelectedApiId] = useState('')

  const [apiFlowEditing, setApiFlowEditing] = useState<{
    controllerId: string
    apiId: string
  } | null>(null)
  const [businessProcessors, setBusinessProcessors] = useState<
    ServiceProcessor[]
  >([])
  const [dataLayerProcessors, setDataLayerProcessors] = useState<
    ServiceProcessor[]
  >([])
  const [apiFlowSelectedNodeId, setApiFlowSelectedNodeId] = useState<
    string | null
  >(null)
  const [, setApiFlowDebugCursorId] = useState<string | null>(null)
  const [, setApiFlowDebugVisitedIds] = useState<string[]>([])
  const [, setApiFlowDebugPrintByNode] = useState<Record<string, string>>(
    {},
  )

  const activeController =
    controllers.find((c) => c.id === activeControllerId) ?? null
  const apis = activeController?.apis ?? []

  const dtoOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        if (t.category === 'dto' || (!t.category && t.kind === 'interface')) {
          opts.push({
            id: t.id,
            label: t.name ? `${t.name}${t.remark ? ` · ${t.remark}` : ''}` : t.id,
          })
        }
      }
    }
    return opts
  }, [typeLibrary])

  function persistControllers(next = controllers) {
    if (!projectPath || !serviceId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await saveServiceControllersApi({
          projectPath,
          serviceId,
          controllers: next,
        })
        setControllers(res.controllers)
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存控制器失败')
      }
    }, 400)
  }

  async function loadControllers() {
    if (!projectPath || !serviceId) return
    setLoading(true)
    try {
      const res = await getServiceControllers(projectPath, serviceId)
      setControllers(res.controllers)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载控制器失败')
      setControllers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (projectPath && serviceId) void loadControllers()
    else {
      setControllers([])
      setActiveControllerId('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, serviceId])

  useEffect(() => {
    if (!controllers.length) {
      setActiveControllerId('')
      return
    }
    const prefer = restoredControllerId
    if (prefer && controllers.some((c) => c.id === prefer)) {
      setActiveControllerId(prefer)
      return
    }
    if (!controllers.some((c) => c.id === activeControllerId)) {
      setActiveControllerId(controllers[0]!.id)
    }
  }, [controllers, restoredControllerId, activeControllerId])

  useEffect(() => {
    onControllerIdChange?.(activeControllerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeControllerId])

  const lastEmittedDebugRef = useRef<ProcessorDebugTarget | null>(null)

  useEffect(() => {
    if (layer !== 'schedule') return
    if (lastEmittedDebugRef.current == null) return
    lastEmittedDebugRef.current = null
    onDebugTargetChange?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer])

  function onDebugTarget(target: ProcessorDebugTarget | null) {
    if (activeLayer === 'controller') return
    if (isSameProcessorDebugTarget(lastEmittedDebugRef.current, target)) return
    lastEmittedDebugRef.current = target
    onDebugTargetChange?.(target)
  }

  function openCreateDialog() {
    setEditingControllerId(null)
    setDialogName('')
    setDialogPath('')
    setDialogRemark('')
    setDialogVisible(true)
  }

  function openEditDialog(ctrl: ServiceController) {
    setEditingControllerId(ctrl.id)
    setDialogName(ctrl.name)
    setDialogPath(ctrl.path)
    setDialogRemark(ctrl.remark)
    setDialogVisible(true)
  }

  function submitDialog() {
    const name = dialogName.trim()
    if (!name) {
      ElMessage.warning('请输入控制器名称')
      return
    }
    if (!isValidControllerName(name)) {
      ElMessage.warning('名称须为英文大驼峰，如 Goods')
      return
    }
    const path = dialogPath.trim()
    const remark = dialogRemark.trim()
    const nameTaken = controllers.some(
      (c) =>
        c.name.trim().toLowerCase() === name.toLowerCase() &&
        c.id !== editingControllerId,
    )
    if (nameTaken) {
      ElMessage.warning(`控制器名称「${name}」已存在`)
      return
    }

    let next = controllers
    if (editingControllerId) {
      next = controllers.map((c) =>
        c.id === editingControllerId ? { ...c, name, path, remark } : c,
      )
    } else {
      const created = {
        ...createEmptyServiceController(name),
        path,
        remark,
      }
      next = [...controllers, created]
      setActiveControllerId(created.id)
    }
    setControllers(next)
    setDialogVisible(false)
    persistControllers(next)
  }

  async function removeController(ctrl: ServiceController) {
    try {
      await ElMessageBox.confirm(
        `确定删除控制器「${ctrl.name}」？其下 API 将一并删除。`,
        '删除控制器',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    const next = controllers.filter((c) => c.id !== ctrl.id)
    setControllers(next)
    persistControllers(next)
  }

  function patchActiveApis(nextApis: ServiceApi[]) {
    const id = activeControllerId
    if (!id) return
    const next = controllers.map((c) =>
      c.id === id ? { ...c, apis: nextApis } : c,
    )
    setControllers(next)
    persistControllers(next)
  }

  const apiReservedNames = apis
    .filter((_, i) => i !== apiEditIndex)
    .map((a) => a.name.trim())
    .filter(Boolean)

  function apiInputLocationClass(location: ServiceApiParamLocation): string {
    switch (location) {
      case 'query':
        return 'api-in-query'
      case 'param':
        return 'api-in-param'
      case 'body':
        return 'api-in-body'
      case 'httpHeader':
        return 'api-in-header'
      default:
        return ''
    }
  }

  function apiInputItems(api: ServiceApi): Array<{
    name: string
    location: ServiceApiParamLocation
    className: string
  }> {
    return (api.inputs ?? [])
      .map((p) => {
        const name = p.varName.trim()
        if (!name) return null
        return {
          name,
          location: p.location,
          className: apiInputLocationClass(p.location),
        }
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
  }

  function apiInputsTitle(api: ServiceApi): string {
    const list = apiInputItems(api)
    if (!list.length) return '无'
    return list.map((p) => `${p.location}:${p.name}`).join('、')
  }

  function openApiEdit(index: number) {
    if (!activeController) return
    setApiEditIndex(index)
    if (index < 0) {
      setApiDraft(createEmptyServiceApi(`api${apis.length + 1}`))
    } else {
      const api = apis[index]
      if (!api) return
      setApiDraft({
        ...api,
        inputs: (api.inputs ?? []).map((p) => ({ ...p })),
        output: api.output
          ? { ...api.output, genericArgs: { ...(api.output.genericArgs ?? {}) } }
          : createEmptyProcessorTypeExpr('any'),
        scope: api.scope === 'private' ? 'private' : 'public',
        flow: api.flow ?? createDefaultMethodFlow(),
      })
      setSelectedApiId(api.id)
    }
    setApiDialogVisible(true)
  }

  function addApi() {
    if (!activeController) {
      ElMessage.warning('请先选择或创建控制器')
      return
    }
    openApiEdit(-1)
  }

  function saveApiEdit(payload: ServiceApiEditPayload) {
    if (apiEditIndex < 0) {
      const base = apiDraft ?? createEmptyServiceApi(payload.name)
      patchActiveApis([
        ...apis,
        {
          ...base,
          name: payload.name,
          path: payload.path,
          remark: payload.remark,
          method: payload.method,
          inputs: payload.inputs,
          output: payload.output,
          requireAuth: payload.requireAuth,
          scope: payload.scope,
          flow: payload.flow ?? createDefaultMethodFlow(),
        },
      ])
      setSelectedApiId(base.id)
    } else {
      patchActiveApis(
        apis.map((api, i) =>
          i === apiEditIndex
            ? {
                ...api,
                name: payload.name,
                path: payload.path,
                remark: payload.remark,
                method: payload.method,
                inputs: payload.inputs,
                output: payload.output,
                requireAuth: payload.requireAuth,
                scope: payload.scope,
                flow: payload.flow ?? api.flow ?? createDefaultMethodFlow(),
              }
            : api,
        ),
      )
    }
    setApiEditIndex(-1)
    setApiDraft(null)
  }

  function findTypeDef(id: string) {
    if (!id) return null
    for (const group of typeLibrary?.groups ?? []) {
      const hit = group.types.find((t) => t.id === id)
      if (hit) return hit
    }
    return null
  }

  function buildApiMethodParams(api: ServiceApi): ProcessorMethodParam[] {
    if (!api.inputs?.length) return []
    return api.inputs.map((p) => {
      const varName = p.varName.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'input'
      const def = p.typeRef ? findTypeDef(p.typeRef) : null
      const type = p.typeRef ? 'json' : p.type || 'string'
      return {
        id: p.id || `api_input_${varName}`,
        name: varName,
        remark: p.remark || def?.remark || `${p.location} · ${varName}`,
        typeExpr: {
          ...createEmptyProcessorTypeExpr(type),
          typeRef: p.typeRef || '',
        },
        required: Boolean(p.required),
      }
    })
  }

  function apiAsProcessorMethod(api: ServiceApi): ProcessorMethod {
    return {
      id: api.id,
      name: api.name,
      remark: api.remark,
      scope: api.scope === 'private' ? 'private' : 'public',
      params: buildApiMethodParams(api),
      output: api.output ?? createEmptyProcessorTypeExpr(),
      dataConfig: createEmptyDataMethodConfig(),
      debugParams: api.debugParams ?? {},
      flow: api.flow ?? createDefaultMethodFlow(),
    }
  }

  const selectedApi = apis.find((a) => a.id === selectedApiId) ?? null
  const apiFlowEditingApi = (() => {
    if (!apiFlowEditing) return null
    const ctrl = controllers.find((c) => c.id === apiFlowEditing.controllerId)
    return ctrl?.apis.find((a) => a.id === apiFlowEditing.apiId) ?? null
  })()

  const apiFlowDebugTarget: ProcessorDebugTarget | null = (() => {
    if (activeLayer !== 'controller') return null
    if (!projectPath || !serviceId) return null
    if (apiFlowEditing && apiFlowEditingApi) {
      const api = apiFlowEditingApi
      const ctrl = activeController
      return {
        kind: 'flow',
        projectPath,
        serviceId,
        processorId: ctrl?.id || 'controller',
        processorName: ctrl?.name || '控制器',
        method: apiAsProcessorMethod(api),
        flow: api.flow ?? createDefaultMethodFlow(),
        selectedNodeId: apiFlowSelectedNodeId,
        dataProcessors: dataLayerProcessors,
        businessProcessors,
        mode: 'canvas',
      }
    }
    if (!selectedApi) return null
    return {
      kind: 'flow',
      projectPath,
      serviceId,
      processorId: activeController?.id || 'controller',
      processorName: activeController?.name || '控制器',
      method: apiAsProcessorMethod(selectedApi),
      flow: selectedApi.flow ?? createDefaultMethodFlow(),
      selectedNodeId: apiFlowSelectedNodeId || 'start',
      dataProcessors: dataLayerProcessors,
      businessProcessors,
      mode: 'list',
    }
  })()

  useEffect(() => {
    if (activeLayer !== 'controller') return
    if (isSameProcessorDebugTarget(lastEmittedDebugRef.current, apiFlowDebugTarget)) {
      return
    }
    lastEmittedDebugRef.current = apiFlowDebugTarget
    onDebugTargetChange?.(apiFlowDebugTarget)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, apiFlowDebugTarget])

  async function loadFlowProcessors() {
    if (!projectPath || !serviceId) {
      setBusinessProcessors([])
      setDataLayerProcessors([])
      return
    }
    try {
      const [biz, data] = await Promise.all([
        getServiceProcessors(projectPath, serviceId, 'business'),
        getServiceProcessors(projectPath, serviceId, 'data'),
      ])
      setBusinessProcessors(biz.processors)
      setDataLayerProcessors(data.processors)
    } catch (err) {
      setBusinessProcessors([])
      setDataLayerProcessors([])
      console.error(err)
    }
  }

  useEffect(() => {
    if (activeLayer === 'controller' && projectPath && serviceId) {
      void loadFlowProcessors()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, projectPath, serviceId])

  function clearApiFlowDebug() {
    setApiFlowSelectedNodeId(null)
    setApiFlowDebugCursorId(null)
    setApiFlowDebugVisitedIds([])
    setApiFlowDebugPrintByNode({})
  }

  function onApiFlowDebugCursor(state: {
    cursorNodeId: string | null
    visitedNodeIds: string[]
    printByNode?: Record<string, string>
  }) {
    setApiFlowDebugCursorId(state.cursorNodeId)
    setApiFlowDebugVisitedIds(state.visitedNodeIds)
    setApiFlowDebugPrintByNode(state.printByNode ?? {})
  }

  function updateApiDebugParams(params: Record<string, unknown>) {
    const apiId = apiFlowEditing?.apiId ?? selectedApiId
    const ctrlId = apiFlowEditing?.controllerId ?? activeControllerId
    if (!apiId || !ctrlId) return
    const next = controllers.map((c) => {
      if (c.id !== ctrlId) return c
      return {
        ...c,
        apis: c.apis.map((a) =>
          a.id === apiId ? { ...a, debugParams: { ...params } } : a,
        ),
      }
    })
    setControllers(next)
    persistControllers(next)
  }

  useEffect(() => {
    setApiFlowEditing(null)
    clearApiFlowDebug()
  }, [projectPath, serviceId])

  useEffect(() => {
    setApiFlowEditing(null)
    clearApiFlowDebug()
  }, [activeControllerId])

  useEffect(() => {
    if (!apiFlowEditing) clearApiFlowDebug()
  }, [selectedApiId])

  useEffect(() => {
    if (!apis.length) {
      setSelectedApiId('')
      return
    }
    if (!apis.some((a) => a.id === selectedApiId)) {
      setSelectedApiId(apis[0]!.id)
    }
  }, [apis, selectedApiId])

  useEffect(() => {
    return () => {
      setApiFlowEditing(null)
      onDebugTargetChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function removeApi(index: number) {
    const target = apis[index]
    if (!target) return
    try {
      await ElMessageBox.confirm(
        `确定删除 API「${target.name || target.path || target.id}」？`,
        '删除 API',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    if (selectedApiId === target.id) setSelectedApiId('')
    if (apiFlowEditing?.apiId === target.id) setApiFlowEditing(null)
    patchActiveApis(apis.filter((_, i) => i !== index))
  }

  useImperativeHandle(ref, () => ({
    applyDebugParams(params) {
      if (activeLayer === 'controller') {
        updateApiDebugParams(params)
        return
      }
      if (activeLayer === 'service') {
        businessProcessorPanelRef.current?.updateDebugParams(params)
        return
      }
      dataProcessorPanelRef.current?.updateDebugParams(params)
    },
    applyFlowDebugCursor(state) {
      if (activeLayer === 'controller') {
        onApiFlowDebugCursor(state)
        return
      }
      businessProcessorPanelRef.current?.applyFlowDebugCursor(state)
    },
    openBusinessFlowAt: (options) =>
      businessProcessorPanelRef.current?.openFlowAt(options) ?? false,
    openCreateController: openCreateDialog,
    addApi,
    openCreateProcessor() {
      if (activeLayer === 'service') {
        businessProcessorPanelRef.current?.openCreateDialog()
      } else if (activeLayer === 'data') {
        dataProcessorPanelRef.current?.openCreateDialog()
      }
    },
    addProcessorMethod() {
      if (activeLayer === 'service') {
        businessProcessorPanelRef.current?.addMethod()
      } else if (activeLayer === 'data') {
        dataProcessorPanelRef.current?.addMethod()
      }
    },
  }))

  const apiColumns = [
    {
      title: '名称',
      key: 'name',
      minWidth: 100,
      render: (_: unknown, row: ServiceApi) => (
        <span className="cell-text">{row.name || '—'}</span>
      ),
    },
    {
      title: '路径',
      key: 'path',
      minWidth: 110,
      render: (_: unknown, row: ServiceApi) => (
        <span className="cell-text muted">{row.path || '/'}</span>
      ),
    },
    {
      title: '说明',
      key: 'remark',
      minWidth: 100,
      render: (_: unknown, row: ServiceApi) => (
        <span className="cell-text muted">{row.remark || '—'}</span>
      ),
    },
    {
      title: '请求方法',
      key: 'method',
      width: 88,
      align: 'center' as const,
      render: (_: unknown, row: ServiceApi) => (
        <span className="cell-text">{row.method}</span>
      ),
    },
    {
      title: '入参',
      key: 'inputs',
      minWidth: 180,
      render: (_: unknown, row: ServiceApi) =>
        !apiInputItems(row).length ? (
          <span className="cell-text muted">无</span>
        ) : (
          <span className="api-inputs" title={apiInputsTitle(row)}>
            {apiInputItems(row).map((item, i) => (
              <span key={`${item.location}-${item.name}-${i}`}>
                {i > 0 ? <span className="api-inputs-sep">、</span> : null}
                <span className={`api-input-name ${item.className}`}>
                  {item.name}
                </span>
              </span>
            ))}
          </span>
        ),
    },
    {
      title: '鉴权',
      key: 'requireAuth',
      width: 64,
      align: 'center' as const,
      render: (_: unknown, row: ServiceApi) => (
        <span className="cell-text">{row.requireAuth ? '是' : '否'}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: unknown, _row: ServiceApi, index: number) => (
        <>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              openApiEdit(index)
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              void removeApi(index)
            }}
          >
            删除
          </Button>
        </>
      ),
    },
  ]

  return (
    <div className="svc-workspace">
      {activeLayer === 'controller' ? (
        <div className="svc-workspace-body">
          <aside className="ctrl-pane">
            {loading ? (
              <div style={{ padding: 12 }}>
                <Skeleton active paragraph={{ rows: 4 }} />
              </div>
            ) : !controllers.length ? (
              <Empty
                description="暂无控制器，点击顶部创建"
                styles={{ image: { height: 56 } }}
              />
            ) : (
              <ul className="ctrl-list">
                {controllers.map((ctrl) => (
                  <Dropdown
                    key={ctrl.id}
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'edit', label: '编辑' },
                        { type: 'divider' },
                        { key: 'delete', label: '删除', danger: true },
                      ],
                      onClick: ({ key }) =>
                        key === 'edit'
                          ? openEditDialog(ctrl)
                          : void removeController(ctrl),
                    }}
                  >
                    <li
                      className={`ctrl-item${ctrl.id === activeControllerId ? ' active' : ''}`}
                      onClick={() => setActiveControllerId(ctrl.id)}
                      onDoubleClick={() => openEditDialog(ctrl)}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <div className="ctrl-name" title={ctrl.name}>
                        {ctrl.name}
                      </div>
                      <div className="ctrl-meta">
                        <span
                          className={`ctrl-bind${!ctrl.path ? ' ctrl-bind--empty' : ''}`}
                          title={ctrl.path || undefined}
                        >
                          {ctrl.path || '—'}
                        </span>
                        <span className="ctrl-count">{ctrl.apis.length}个方法</span>
                      </div>
                      <div className="ctrl-desc" title={ctrl.remark || undefined}>
                        {ctrl.remark || '—'}
                      </div>
                    </li>
                  </Dropdown>
                ))}
              </ul>
            )}
          </aside>

          <section className="api-pane">
            {!activeController ? (
              <Empty
                description="请选择或创建左侧控制器"
                styles={{ image: { height: 64 } }}
              />
            ) : (
              <div className="api-table">
                <Table
                  dataSource={apis}
                  columns={apiColumns}
                  bordered
                  size="small"
                  pagination={false}
                  rowKey="id"
                  locale={{ emptyText: '暂无 API，点击顶部创建' }}
                  rowClassName={(row) =>
                    row.id === selectedApiId ? 'is-selected-row' : ''
                  }
                  onRow={(row) => ({
                    onClick: () => setSelectedApiId(row.id),
                  })}
                />
              </div>
            )}
          </section>
        </div>
      ) : activeLayer === 'service' ? (
        <ServiceProcessorPanel
          ref={businessProcessorPanelRef}
          projectPath={projectPath}
          serviceId={serviceId}
          layer="business"
          typeLibrary={typeLibrary}
          moduleOptions={moduleOptions ?? []}
          restored={restoredBusiness}
          onDebugTargetChange={onDebugTarget}
          onSelectionChange={onBusinessSelectionChange}
        />
      ) : activeLayer === 'data' ? (
        <ServiceProcessorPanel
          ref={dataProcessorPanelRef}
          projectPath={projectPath}
          serviceId={serviceId}
          layer="data"
          typeLibrary={typeLibrary}
          moduleOptions={moduleOptions ?? []}
          restored={
            restoredData
              ? {
                  processorId: restoredData.processorId,
                  methodId: restoredData.methodId,
                  flowEditing: null,
                }
              : null
          }
          onDebugTargetChange={onDebugTarget}
          onSelectionChange={onDataSelectionChange}
          onNavigateUsage={onNavigateUsage}
        />
      ) : (
        <div className="layer-placeholder">
          <Empty description="定时任务稍后实现" styles={{ image: { height: 80 } }} />
        </div>
      )}

      <Modal
        open={dialogVisible}
        title="控制器"
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setDialogVisible(false)}
        footer={
          <Button type="primary" onClick={submitDialog}>
            确定
          </Button>
        }
      >
        <Form
          labelCol={{ style: { width: 64 } }}
          onSubmitCapture={(e) => {
            e.preventDefault()
            submitDialog()
          }}
        >
          <Form.Item label="名称">
            <Input
              value={dialogName}
              placeholder="英文大驼峰，如 Goods"
              maxLength={64}
              autoFocus
              onChange={(e) => setDialogName(e.target.value)}
            />
            <p className="field-hint">仅英文，须大驼峰（PascalCase）</p>
          </Form.Item>
          <Form.Item label="路径">
            <Input
              value={dialogPath}
              placeholder="如 /goods"
              maxLength={128}
              onChange={(e) => setDialogPath(e.target.value)}
            />
          </Form.Item>
          <Form.Item label="说明">
            <Input.TextArea
              value={dialogRemark}
              rows={2}
              placeholder="可选说明"
              maxLength={256}
              onChange={(e) => setDialogRemark(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>

      <EditServiceApiDialog
        open={apiDialogVisible}
        onOpenChange={setApiDialogVisible}
        api={apiDraft}
        dtoOptions={dtoOptions}
        typeLibrary={typeLibrary}
        reservedNames={apiReservedNames}
        projectPath={projectPath}
        serviceId={serviceId}
        onSave={saveApiEdit}
      />
    </div>
  )
})
