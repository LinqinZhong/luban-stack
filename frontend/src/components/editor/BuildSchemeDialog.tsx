import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Spin,
} from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import FrameworkTypeIcon from '../icons/FrameworkTypeIcon'
import {
  getBuildSchemes,
  saveBuildSchemes,
  getBackendServiceLibrary,
  type BuildScheme,
  type BuildSchemeLibrary,
  type BuildBackendService,
  type BuildBackendType,
  type BuildFrontendApp,
  type BuildFrontendType,
} from '../../api/projects'
import { listPages, type PageSummary } from '../../api/pages'
import { ElMessage } from '../../ui/feedback'
import './BuildSchemeDialog.css'

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

export default function BuildSchemeDialog({
  open,
  onOpenChange,
  projectPath,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  onSaved?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [library, setLibrary] = useState<BuildSchemeLibrary>({ schemes: [] })
  const [selectedId, setSelectedId] = useState('')
  const [modules, setModules] = useState<Array<{ id: string; name: string }>>([])
  const [pages, setPages] = useState<PageSummary[]>([])

  const [backendEditVisible, setBackendEditVisible] = useState(false)
  const [frontendEditVisible, setFrontendEditVisible] = useState(false)
  const [backendEditIndex, setBackendEditIndex] = useState(-1)
  const [frontendEditIndex, setFrontendEditIndex] = useState(-1)

  const [backendDraft, setBackendDraft] = useState<BuildBackendService>({
    name: 'service1',
    type: 'nestjs',
    port: 3030,
    moduleIds: [],
    includeOss: false,
  })
  const [frontendDraft, setFrontendDraft] = useState<BuildFrontendApp>({
    name: 'app1',
    type: 'vue3',
    port: 5173,
    wechatAppId: '',
    pageIds: [],
    entryPage: '',
  })

  const frontendEntryOptions = useMemo(
    () => pages.filter((p) => frontendDraft.pageIds.includes(p.id)),
    [pages, frontendDraft.pageIds],
  )

  const activeScheme =
    library.schemes.find((s) => s.id === selectedId) ?? null

  const claimedModuleIds = useMemo(() => {
    const map = new Map<string, string>()
    if (!activeScheme) return map
    for (const b of activeScheme.backends) {
      for (const mid of b.moduleIds) map.set(mid, b.name)
    }
    return map
  }, [activeScheme])

  function uid(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  }

  function patchActive(patch: Partial<BuildScheme> | ((s: BuildScheme) => BuildScheme)) {
    if (!activeScheme) return
    setLibrary((prev) => ({
      schemes: prev.schemes.map((s) => {
        if (s.id !== activeScheme.id) return s
        return typeof patch === 'function' ? patch(s) : { ...s, ...patch }
      }),
    }))
  }

  async function load() {
    if (!projectPath) return
    setLoading(true)
    try {
      const [lib, svcLib, pageLib] = await Promise.all([
        getBuildSchemes(projectPath),
        getBackendServiceLibrary(projectPath),
        listPages(projectPath),
      ])
      let nextLib = lib
      let nextSelected = selectedId
      if (!nextLib.schemes.length) {
        const scheme: BuildScheme = {
          id: uid('bld'),
          name: 'build1',
          description: '',
          backends: [],
          frontends: [],
        }
        nextLib = { schemes: [scheme] }
        nextSelected = scheme.id
      } else if (
        !nextSelected ||
        !nextLib.schemes.some((s) => s.id === nextSelected)
      ) {
        nextSelected = nextLib.schemes[0]!.id
      }
      setLibrary(nextLib)
      setSelectedId(nextSelected)
      setModules(svcLib.services.map((s) => ({ id: s.id, name: s.name })))
      setPages(pageLib.pages ?? [])
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载构建方案失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectPath])

  useEffect(() => {
    const entry = frontendDraft.entryPage?.trim()
    if (entry && frontendDraft.pageIds.includes(entry)) return
    setFrontendDraft((prev) => ({
      ...prev,
      entryPage: prev.pageIds[0] ?? '',
    }))
  }, [frontendDraft.pageIds, frontendDraft.entryPage])

  function addScheme() {
    const scheme: BuildScheme = {
      id: uid('bld'),
      name: `build${library.schemes.length + 1}`,
      description: '',
      backends: [],
      frontends: [],
    }
    setLibrary({ schemes: [...library.schemes, scheme] })
    setSelectedId(scheme.id)
  }

  function removeScheme(id: string) {
    const schemes = library.schemes.filter((s) => s.id !== id)
    setLibrary({ schemes })
    if (selectedId === id) setSelectedId(schemes[0]?.id ?? '')
  }

  function openBackendEdit(index: number) {
    if (!activeScheme) return
    setBackendEditIndex(index)
    if (index < 0) {
      setBackendDraft({
        name: `service${activeScheme.backends.length + 1}`,
        type: 'nestjs',
        port: 3030 + activeScheme.backends.length,
        moduleIds: [],
        includeOss: activeScheme.backends.length === 0,
      })
    } else {
      const b = activeScheme.backends[index]!
      setBackendDraft({
        name: b.name,
        type: b.type ?? 'nestjs',
        port: b.port,
        moduleIds: [...b.moduleIds],
        includeOss: Boolean(b.includeOss),
      })
    }
    setBackendEditVisible(true)
  }

  function moduleDisabled(moduleId: string): boolean {
    const owner = claimedModuleIds.get(moduleId)
    if (!owner) return false
    if (backendEditIndex < 0) return true
    const editing = activeScheme?.backends[backendEditIndex]
    return owner !== editing?.name
  }

  function saveBackendDraft() {
    if (!activeScheme) return
    const name = backendDraft.name.trim()
    if (!NAME_RE.test(name)) {
      ElMessage.error('服务名须以字母开头，仅含字母、数字、_、-')
      return
    }
    if (!(backendDraft.port > 0 && backendDraft.port <= 65535)) {
      ElMessage.error('端口无效')
      return
    }
    if (!backendDraft.moduleIds.length) {
      ElMessage.error('至少勾选一个模块')
      return
    }
    const type = (backendDraft.type || 'nestjs') as BuildBackendType
    if (type !== 'nestjs') {
      ElMessage.error('暂不支持的后端框架')
      return
    }
    const dup = activeScheme.backends.some(
      (b, i) => b.name === name && i !== backendEditIndex,
    )
    if (dup) {
      ElMessage.error('服务名重复')
      return
    }
    const next: BuildBackendService = {
      name,
      type,
      port: Math.floor(backendDraft.port),
      moduleIds: [...backendDraft.moduleIds],
      includeOss: Boolean(backendDraft.includeOss),
    }
    const backends = [...activeScheme.backends]
    if (backendEditIndex < 0) backends.push(next)
    else backends[backendEditIndex] = next
    if (next.includeOss) {
      const ossIndex =
        backendEditIndex < 0 ? backends.length - 1 : backendEditIndex
      for (let i = 0; i < backends.length; i++) {
        if (i === ossIndex) continue
        backends[i] = { ...backends[i]!, includeOss: false }
      }
    }
    patchActive({ backends })
    setBackendEditVisible(false)
  }

  function removeBackend(index: number) {
    if (!activeScheme) return
    patchActive({
      backends: activeScheme.backends.filter((_, i) => i !== index),
    })
  }

  function openFrontendEdit(index: number) {
    if (!activeScheme) return
    setFrontendEditIndex(index)
    if (index < 0) {
      const firstId = pages[0]?.id
      setFrontendDraft({
        name: `app${activeScheme.frontends.length + 1}`,
        type: 'vue3',
        port: 5173,
        wechatAppId: '',
        pageIds: firstId ? [firstId] : [],
        entryPage: firstId ?? '',
      })
    } else {
      const f = activeScheme.frontends[index]!
      const pageIds = [...f.pageIds]
      const entry =
        f.entryPage && pageIds.includes(f.entryPage)
          ? f.entryPage
          : (pageIds[0] ?? '')
      setFrontendDraft({
        name: f.name,
        type: f.type,
        port: f.port ?? 5173,
        wechatAppId: f.wechatAppId ?? '',
        pageIds,
        entryPage: entry,
      })
    }
    setFrontendEditVisible(true)
  }

  function saveFrontendDraft() {
    if (!activeScheme) return
    const name = frontendDraft.name.trim()
    if (!NAME_RE.test(name)) {
      ElMessage.error('应用名须以字母开头，仅含字母、数字、_、-')
      return
    }
    if (!frontendDraft.pageIds.length) {
      ElMessage.error('至少选择一个页面')
      return
    }
    const entryPage = frontendDraft.entryPage?.trim() || ''
    if (!entryPage || !frontendDraft.pageIds.includes(entryPage)) {
      ElMessage.error('请选择入口页')
      return
    }
    const type = frontendDraft.type as BuildFrontendType
    if (type === 'vue3') {
      const port = Number(frontendDraft.port)
      if (!(port > 0 && port <= 65535)) {
        ElMessage.error('H5 须配置有效端口')
        return
      }
    }
    if (type === 'mp-wx' && !frontendDraft.wechatAppId?.trim()) {
      ElMessage.error('微信小程序须配置 AppID')
      return
    }
    const dup = activeScheme.frontends.some(
      (f, i) => f.name === name && i !== frontendEditIndex,
    )
    if (dup) {
      ElMessage.error('应用名重复')
      return
    }
    const next: BuildFrontendApp = {
      name,
      type,
      pageIds: [...frontendDraft.pageIds],
      entryPage,
    }
    if (type === 'vue3') next.port = Math.floor(Number(frontendDraft.port))
    if (type === 'mp-wx') next.wechatAppId = frontendDraft.wechatAppId?.trim() || ''

    const frontends = [...activeScheme.frontends]
    if (frontendEditIndex < 0) frontends.push(next)
    else frontends[frontendEditIndex] = next
    patchActive({ frontends })
    setFrontendEditVisible(false)
  }

  function removeFrontend(index: number) {
    if (!activeScheme) return
    patchActive({
      frontends: activeScheme.frontends.filter((_, i) => i !== index),
    })
  }

  function validateClient(): string | null {
    const names = new Set<string>()
    for (const s of library.schemes) {
      if (!NAME_RE.test(s.name)) return `构建名无效：${s.name}`
      if (names.has(s.name)) return `构建名重复：${s.name}`
      names.add(s.name)

      const claimed = new Map<string, string>()
      for (const b of s.backends) {
        for (const mid of b.moduleIds) {
          if (claimed.has(mid)) return `模块 ${mid} 被多个服务勾选`
          claimed.set(mid, b.name)
        }
      }
      for (const m of modules) {
        if (!claimed.has(m.id)) return `方案 ${s.name}：模块 ${m.name} 未被勾选`
      }
      if (modules.length && !s.backends.length) {
        return `方案 ${s.name}：请添加后端服务并勾选全部模块`
      }
    }
    return null
  }

  async function handleSave() {
    const err = validateClient()
    if (err) {
      ElMessage.error(err)
      return
    }
    setSaving(true)
    try {
      const next = await saveBuildSchemes({
        projectPath,
        library,
      })
      setLibrary(next)
      ElMessage.success('构建方案已保存')
      onSaved?.()
      onOpenChange(false)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        className="build-scheme-dialog"
        title="配置构建方案"
        open={open}
        width={920}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => onOpenChange(false)}
        footer={
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        }
      >
        <Spin spinning={loading}>
          <div className="body">
            <aside className="scheme-list">
              <div className="aside-head">
                <span>方案</span>
                <Button type="link" icon={<PlusOutlined />} onClick={addScheme}>
                  新建
                </Button>
              </div>
              {library.schemes.map((s) => (
                <div
                  key={s.id}
                  className={`scheme-item${s.id === selectedId ? ' active' : ''}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div className="scheme-name">{s.name}</div>
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeScheme(s.id)
                    }}
                  />
                </div>
              ))}
              {!library.schemes.length ? (
                <Empty description="暂无方案" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : null}
            </aside>

            {activeScheme ? (
              <div className="scheme-editor">
                <Form
                  labelCol={{ flex: '72px' }}
                  className="scheme-form"
                  onFinish={(e) => e.preventDefault?.()}
                >
                  <Form.Item label="名称">
                    <Input
                      value={activeScheme.name}
                      placeholder="纯英文，允许 _ - 数字，字母开头"
                      onChange={(e) => patchActive({ name: e.target.value })}
                    />
                  </Form.Item>
                  <Form.Item label="说明">
                    <Input.TextArea
                      value={activeScheme.description}
                      rows={2}
                      placeholder="可选"
                      onChange={(e) =>
                        patchActive({ description: e.target.value })
                      }
                    />
                  </Form.Item>
                  <Form.Item label="后端">
                    <div className="field-block">
                      <div className="field-toolbar">
                        <div className="card-actions">
                          <Button
                            className="add-link"
                            type="link"
                            icon={<PlusOutlined />}
                            onClick={() => openBackendEdit(-1)}
                          >
                            添加服务
                          </Button>
                        </div>
                      </div>
                      {activeScheme.backends.map((b, i) => (
                        <div key={b.name + i} className="card">
                          <div className="card-main">
                            <strong>{b.name}</strong>
                            <span className="muted">
                              <FrameworkTypeIcon type={b.type || 'nestjs'} />
                              <span>
                                {b.type === 'nestjs' ? 'Nest.js' : b.type} :{b.port}
                                {' · '}
                                {b.moduleIds.length} 个模块
                                {b.includeOss ? ' · OSS' : ''}
                              </span>
                            </span>
                          </div>
                          <div className="card-actions">
                            <Button
                              type="link"
                              icon={<EditOutlined />}
                              onClick={() => openBackendEdit(i)}
                            >
                              编辑
                            </Button>
                            <Button
                              type="link"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => removeBackend(i)}
                            />
                          </div>
                        </div>
                      ))}
                      {!activeScheme.backends.length ? (
                        <div className="field-empty">暂无后端服务，请添加</div>
                      ) : null}
                    </div>
                  </Form.Item>
                  <Form.Item label="前端">
                    <div className="field-block">
                      <div className="field-toolbar">
                        <div className="card-actions">
                          <Button
                            className="add-link"
                            type="link"
                            icon={<PlusOutlined />}
                            onClick={() => openFrontendEdit(-1)}
                          >
                            添加应用
                          </Button>
                        </div>
                      </div>
                      {activeScheme.frontends.map((f, i) => (
                        <div key={f.name + i} className="card">
                          <div className="card-main">
                            <strong>{f.name}</strong>
                            <span className="muted">
                              <FrameworkTypeIcon type={f.type || 'vue3'} />
                              <span>
                                {f.type === 'vue3'
                                  ? `Vue3 :${f.port}`
                                  : '微信小程序'}
                                {' · '}
                                {f.pageIds.length} 页
                              </span>
                            </span>
                          </div>
                          <div className="card-actions">
                            <Button
                              type="link"
                              icon={<EditOutlined />}
                              onClick={() => openFrontendEdit(i)}
                            >
                              编辑
                            </Button>
                            <Button
                              type="link"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => removeFrontend(i)}
                            />
                          </div>
                        </div>
                      ))}
                      {!activeScheme.frontends.length ? (
                        <div className="field-empty">
                          可选：添加 Vue3 / 微信小程序应用
                        </div>
                      ) : null}
                    </div>
                  </Form.Item>
                </Form>
              </div>
            ) : null}
          </div>
        </Spin>
      </Modal>

      <Modal
        title={backendEditIndex < 0 ? '添加后端服务' : '编辑后端服务'}
        open={backendEditVisible}
        width={480}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setBackendEditVisible(false)}
        footer={
          <Button type="primary" onClick={saveBackendDraft}>
            确定
          </Button>
        }
      >
        <Form labelCol={{ flex: '88px' }}>
          <Form.Item label="服务名">
            <Input
              value={backendDraft.name}
              placeholder="如 service1"
              onChange={(e) =>
                setBackendDraft({ ...backendDraft, name: e.target.value })
              }
            />
          </Form.Item>
          <Form.Item label="端口">
            <InputNumber
              value={backendDraft.port}
              min={1}
              max={65535}
              style={{ width: '100%' }}
              onChange={(v) =>
                setBackendDraft({ ...backendDraft, port: Number(v) || 0 })
              }
            />
          </Form.Item>
          <Form.Item label="框架">
            <Radio.Group
              value={backendDraft.type}
              onChange={(e) =>
                setBackendDraft({
                  ...backendDraft,
                  type: e.target.value as BuildBackendType,
                })
              }
            >
              <Radio value="nestjs">
                <span className="type-option">
                  <FrameworkTypeIcon type="nestjs" />
                  Nest.js
                </span>
              </Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="模块">
            <Checkbox.Group
              className="module-checks"
              value={backendDraft.moduleIds}
              onChange={(vals) =>
                setBackendDraft({
                  ...backendDraft,
                  moduleIds: vals.map(String),
                })
              }
            >
              {modules.map((m) => (
                <Checkbox
                  key={m.id}
                  value={m.id}
                  disabled={
                    moduleDisabled(m.id) &&
                    !backendDraft.moduleIds.includes(m.id)
                  }
                >
                  {m.name}
                  <span className="muted">（{m.id}）</span>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
          <Form.Item label="OSS">
            <Checkbox
              checked={backendDraft.includeOss}
              onChange={(e) =>
                setBackendDraft({
                  ...backendDraft,
                  includeOss: e.target.checked,
                })
              }
            >
              在本服务挂载 OSS 模块
            </Checkbox>
            <div className="field-hint">
              提供 <code>POST /oss/sign</code>；同一构建方案只能选一个服务
            </div>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={frontendEditIndex < 0 ? '添加前端应用' : '编辑前端应用'}
        open={frontendEditVisible}
        width={480}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setFrontendEditVisible(false)}
        footer={
          <Button type="primary" onClick={saveFrontendDraft}>
            确定
          </Button>
        }
      >
        <Form labelCol={{ flex: '100px' }}>
          <Form.Item label="应用名">
            <Input
              value={frontendDraft.name}
              placeholder="如 app1"
              onChange={(e) =>
                setFrontendDraft({ ...frontendDraft, name: e.target.value })
              }
            />
          </Form.Item>
          <Form.Item label="类型">
            <Radio.Group
              value={frontendDraft.type}
              onChange={(e) =>
                setFrontendDraft({
                  ...frontendDraft,
                  type: e.target.value as BuildFrontendType,
                })
              }
            >
              <Radio value="vue3">
                <span className="type-option">
                  <FrameworkTypeIcon type="vue3" />
                  Vue3
                </span>
              </Radio>
              <Radio value="mp-wx">
                <span className="type-option">
                  <FrameworkTypeIcon type="mp-wx" />
                  微信小程序
                </span>
              </Radio>
            </Radio.Group>
          </Form.Item>
          {frontendDraft.type === 'vue3' ? (
            <Form.Item label="端口">
              <InputNumber
                value={frontendDraft.port}
                min={1}
                max={65535}
                style={{ width: '100%' }}
                onChange={(v) =>
                  setFrontendDraft({
                    ...frontendDraft,
                    port: Number(v) || 0,
                  })
                }
              />
            </Form.Item>
          ) : null}
          {frontendDraft.type === 'mp-wx' ? (
            <Form.Item label="微信 AppID">
              <Input
                value={frontendDraft.wechatAppId}
                placeholder="例如 wx1234567890abcdef"
                onChange={(e) =>
                  setFrontendDraft({
                    ...frontendDraft,
                    wechatAppId: e.target.value,
                  })
                }
              />
            </Form.Item>
          ) : null}
          <Form.Item label="页面">
            <Select
              mode="multiple"
              showSearch
              value={frontendDraft.pageIds}
              placeholder="选择页面"
              style={{ width: '100%' }}
              options={pages.map((p) => ({
                value: p.id,
                label: `${p.title || p.id}（${p.id}）`,
              }))}
              onChange={(ids) =>
                setFrontendDraft({ ...frontendDraft, pageIds: ids })
              }
            />
          </Form.Item>
          <Form.Item label="入口页">
            <Select
              showSearch
              value={frontendDraft.entryPage || undefined}
              placeholder="从已选页面中选择入口页"
              style={{ width: '100%' }}
              disabled={!frontendDraft.pageIds.length}
              options={frontendEntryOptions.map((p) => ({
                value: p.id,
                label: `${p.title || p.id}（${p.id}）`,
              }))}
              onChange={(id) =>
                setFrontendDraft({ ...frontendDraft, entryPage: id })
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
