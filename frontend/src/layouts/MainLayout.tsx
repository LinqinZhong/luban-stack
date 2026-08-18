import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Outlet, useNavigate } from 'react-router-dom'
import { Button, Form, Input, Modal, Tooltip } from 'antd'
import { CommentOutlined, LogoutOutlined } from '@ant-design/icons'
import { useProjectStore } from '../stores/project'
import { useWorkspaceSettingsStore } from '../stores/workspace-settings'
import { useAiAssistantStore } from '../stores/ai-assistant'
import {
  buildProject,
  getBuildSchemes,
  getWechatPublishStatus,
  uploadWechatMp,
  type BuildScheme,
} from '../api/projects'
import WorkspaceSettingsButton, {
  type WorkspaceSettingsButtonHandle,
} from '../components/editor/WorkspaceSettingsButton'
import AiAssistantPanel from '../components/editor/AiAssistantPanel'
import BuildSchemeDialog from '../components/editor/BuildSchemeDialog'
import BuildSchemeIcon from '../components/icons/BuildSchemeIcon'
import HammerIcon from '../components/icons/HammerIcon'
import PublishIcon from '../components/icons/PublishIcon'
import LubanStackLogo from '../components/icons/LubanStackLogo'
import { PRODUCT_NAME } from '../constants/brand'
import { ElMessage } from '../ui/feedback'
import './MainLayout.css'

type BuildTargetKind = 'backend' | 'frontend'

type BuildTarget = {
  key: string
  kind: BuildTargetKind
  name: string
  label: string
  detail: string
}

export default function MainLayout() {
  const navigate = useNavigate()
  const projectPath = useProjectStore((s) => s.path)
  const projectConfig = useProjectStore((s) => s.config)
  const clearProject = useProjectStore((s) => s.clearProject)
  const showAiButton = useWorkspaceSettingsStore((s) => s.aiAssistantEnabled)
  const panelOpen = useAiAssistantStore((s) => s.panelOpen)
  const projectBusyByAi = useAiAssistantStore((s) => s.projectBusyByAi)
  const setPanelOpen = useAiAssistantStore((s) => s.setPanelOpen)
  const togglePanel = useAiAssistantStore((s) => s.togglePanel)
  const [building, setBuilding] = useState(false)
  const settingsBtn = useRef<WorkspaceSettingsButtonHandle>(null)
  const [buildingKey, setBuildingKey] = useState('')
  const [buildingLabel, setBuildingLabel] = useState('')
  const [schemeDialogVisible, setSchemeDialogVisible] = useState(false)
  const [buildSelectVisible, setBuildSelectVisible] = useState(false)
  const [schemes, setSchemes] = useState<BuildScheme[]>([])
  const [publishVisible, setPublishVisible] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishForm, setPublishForm] = useState({ version: '', desc: '' })
  const [publishStatusHint, setPublishStatusHint] = useState('')

  const pageTitle = projectConfig?.name
    ? `${projectConfig.name} · 工作区`
    : '工作区'

  useEffect(() => {
    if (!showAiButton) setPanelOpen(false)
  }, [showAiButton, setPanelOpen])

  function onAiBusyMaskClick() {
    ElMessage.warning({
      message: 'AI助手正在编辑项目，请稍候',
      zIndex: 6000,
    })
  }

  function closeProject() {
    clearProject()
    void navigate('/')
  }

  function openSchemeDialog() {
    if (!projectPath) {
      ElMessage.warning('请先打开项目')
      return
    }
    setSchemeDialogVisible(true)
  }

  function frontendTypeLabel(type: string): string {
    if (type === 'mp-wx') return '微信小程序'
    if (type === 'vue3') return 'Vue3'
    return type || '前端'
  }

  function targetsOf(scheme: BuildScheme): BuildTarget[] {
    const out: BuildTarget[] = []
    const schemeName = scheme.name.trim()
    for (const b of scheme.backends ?? []) {
      const name = b.name.trim()
      if (!name) continue
      out.push({
        key: `${schemeName}::backend::${name}`,
        kind: 'backend',
        name,
        label: name,
        detail: `${b.type === 'nestjs' ? 'Nest.js' : b.type || '后端'} :${b.port}${
          b.includeOss ? ' · OSS' : ''
        }`,
      })
    }
    for (const f of scheme.frontends ?? []) {
      const name = f.name.trim()
      if (!name) continue
      const pageCount = f.pageIds?.length ?? 0
      out.push({
        key: `${schemeName}::frontend::${name}`,
        kind: 'frontend',
        name,
        label: name,
        detail: `${frontendTypeLabel(f.type)}${pageCount ? ` · ${pageCount} 页` : ''}`,
      })
    }
    return out
  }

  const schemeRows = useMemo(
    () => schemes.map((scheme) => ({ scheme, targets: targetsOf(scheme) })),
    [schemes],
  )

  async function handleBuild() {
    if (!projectPath) {
      ElMessage.warning('请先打开项目')
      return
    }
    try {
      const lib = await getBuildSchemes(projectPath)
      if (!lib.schemes.length) {
        ElMessage.warning('请先配置构建方案')
        setSchemeDialogVisible(true)
        return
      }
      setSchemes(lib.schemes)
      setBuildSelectVisible(true)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '读取构建方案失败')
    }
  }

  async function runBuild(payload: {
    schemeName: string
    backendNames?: string[]
    frontendNames?: string[]
    label: string
    key?: string
  }) {
    if (!projectPath || building) return
    setBuilding(true)
    setBuildingKey(payload.key || '')
    setBuildingLabel(payload.label)
    try {
      const result = await buildProject({
        projectPath,
        schemeName: payload.schemeName,
        ...(payload.backendNames != null ? { backendNames: payload.backendNames } : {}),
        ...(payload.frontendNames != null
          ? { frontendNames: payload.frontendNames }
          : {}),
      })
      ElMessage.success(
        `构建完成：${result.backends.length} 个后端 / ${result.frontends.length} 个前端 → ${result.outputRoot}`,
      )
      setBuildSelectVisible(false)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '构建失败')
    } finally {
      setBuilding(false)
      setBuildingKey('')
      setBuildingLabel('')
    }
  }

  function onTargetClick(scheme: BuildScheme, item: BuildTarget) {
    void runBuild({
      schemeName: scheme.name,
      backendNames: item.kind === 'backend' ? [item.name] : [],
      frontendNames: item.kind === 'frontend' ? [item.name] : [],
      label: `正在构建 ${item.label}…`,
      key: item.key,
    })
  }

  function onBuildAll(scheme: BuildScheme) {
    void runBuild({
      schemeName: scheme.name,
      label: `正在构建 ${scheme.name}…`,
      key: `${scheme.name}::all`,
    })
  }

  async function handlePublish() {
    if (!projectPath) {
      ElMessage.warning('请先打开项目')
      return
    }
    try {
      const status = await getWechatPublishStatus(projectPath)
      if (!status.wechatAppId || !status.hasPrivateKey) {
        ElMessage.warning('请先在「设置 → 项目」配置微信 AppID 与上传密钥')
        settingsBtn.current?.open('project')
        return
      }
      setPublishForm({
        version: status.projectVersion || '0.1.0',
        desc: '',
      })
      setPublishStatusHint(`AppID：${status.wechatAppId}`)
      setPublishVisible(true)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '读取发布配置失败')
    }
  }

  function openPublishSettings() {
    setPublishVisible(false)
    settingsBtn.current?.open('project')
  }

  async function confirmPublish() {
    if (!projectPath || publishing) return
    const version = publishForm.version.trim()
    if (!version) {
      ElMessage.warning('请填写版本号')
      return
    }
    setPublishing(true)
    try {
      const result = await uploadWechatMp({
        projectPath,
        version,
        desc: publishForm.desc.trim(),
        rebuild: true,
      })
      ElMessage.success(
        `已上传开发版 ${result.version}（${result.appid}），可在微信公众平台查看`,
      )
      setPublishVisible(false)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '发布失败')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="layout">
      {projectBusyByAi
        ? createPortal(
            <div
              className="ai-busy-mask"
              aria-hidden="true"
              onClick={onAiBusyMaskClick}
              onContextMenu={(e) => {
                e.preventDefault()
                onAiBusyMaskClick()
              }}
            />,
            document.body,
          )
        : null}
      <header className="header">
        <div className="brand">
          <LubanStackLogo className="brand-mark" size={28} />
          <span className="logo">{PRODUCT_NAME}</span>
          <span className="title">{pageTitle}</span>
        </div>
        <div className="header-actions">
          {showAiButton ? (
            <Tooltip title="AI助手" placement="bottom">
              <Button
                className="header-icon-btn"
                icon={<CommentOutlined />}
                onClick={() => togglePanel()}
              />
            </Tooltip>
          ) : null}
          <WorkspaceSettingsButton ref={settingsBtn} />
          <Tooltip title="配置构建方案" placement="bottom">
            <Button
              className="header-icon-btn"
              disabled={!projectPath}
              onClick={openSchemeDialog}
            >
              <BuildSchemeIcon className="header-action-icon" />
            </Button>
          </Tooltip>
          <Tooltip title="构建" placement="bottom">
            <Button
              className="header-icon-btn"
              loading={building}
              disabled={!projectPath}
              onClick={() => void handleBuild()}
            >
              <HammerIcon className="header-action-icon" />
            </Button>
          </Tooltip>
          <Tooltip title="发布到微信" placement="bottom">
            <Button
              className="header-icon-btn"
              loading={publishing}
              disabled={!projectPath || building}
              onClick={() => void handlePublish()}
            >
              <PublishIcon className="header-action-icon" />
            </Button>
          </Tooltip>
          <Tooltip title="关闭项目" placement="bottom">
            <Button
              className="header-icon-btn"
              icon={<LogoutOutlined />}
              onClick={closeProject}
            />
          </Tooltip>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>

      <AiAssistantPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
      />

      {projectPath ? (
        <BuildSchemeDialog
          open={schemeDialogVisible}
          onOpenChange={setSchemeDialogVisible}
          projectPath={projectPath}
        />
      ) : null}

      <Modal
        title="选择要构建的方案"
        open={buildSelectVisible}
        onCancel={() => {
          if (!building) {
            setBuildSelectVisible(false)
            setSchemes([])
          }
        }}
        width={560}
        centered
        destroyOnHidden
        maskClosable={!building}
        keyboard={!building}
        closable={!building}
        footer={null}
      >
        <div className="build-picker">
          {building ? (
            <div className="build-picker-loading">{buildingLabel || '正在构建…'}</div>
          ) : null}
          {schemeRows.map((row) => (
            <div key={row.scheme.id || row.scheme.name} className="scheme-block">
              <div className="scheme-head">
                <div className="scheme-titles">
                  <div className="scheme-name">{row.scheme.name}</div>
                  <div className="scheme-desc">
                    {row.scheme.description?.trim() || '暂无说明'}
                  </div>
                </div>
                <Button
                  type="primary"
                  size="small"
                  disabled={building || !row.targets.length}
                  loading={building && buildingKey === `${row.scheme.name}::all`}
                  onClick={() => onBuildAll(row.scheme)}
                >
                  构建全部
                </Button>
              </div>
              {row.targets.length ? (
                <div className="target-grid">
                  {row.targets.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`target-tile${
                        building && buildingKey === item.key ? ' is-building' : ''
                      }`}
                      disabled={building}
                      onClick={() => onTargetClick(row.scheme, item)}
                    >
                      <div className="tile-body">
                        <div className="tile-name">{item.label}</div>
                        <div className="tile-detail">{item.detail}</div>
                      </div>
                      <span className="tile-kind">
                        {item.kind === 'backend' ? '后端' : '前端'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="targets-empty">没有可构建的后端/前端</div>
              )}
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        title="发布到微信小程序"
        open={publishVisible}
        onCancel={() => {
          if (!publishing) setPublishVisible(false)
        }}
        width={480}
        centered
        destroyOnHidden
        maskClosable={!publishing}
        keyboard={!publishing}
        closable={!publishing}
        footer={
          <>
            <Button disabled={publishing} onClick={openPublishSettings}>
              项目设置
            </Button>
            <Button disabled={publishing} onClick={() => setPublishVisible(false)}>
              取消
            </Button>
            <Button
              type="primary"
              loading={publishing}
              onClick={() => void confirmPublish()}
            >
              发布
            </Button>
          </>
        }
      >
        <p className="publish-hint">
          {publishStatusHint}
          <br />
          将导出小程序并上传为开发版（无需打开微信开发者工具）。请确认本机 IP 已在公众平台白名单中。
        </p>
        <Form labelCol={{ span: 4 }} className="publish-form">
          <Form.Item label="版本号" required>
            <Input
              value={publishForm.version}
              disabled={publishing}
              placeholder="例如 1.0.0"
              onChange={(e) =>
                setPublishForm((prev) => ({ ...prev, version: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea
              value={publishForm.desc}
              rows={3}
              disabled={publishing}
              placeholder="可选，显示在微信后台的版本描述"
              onChange={(e) =>
                setPublishForm((prev) => ({ ...prev, desc: e.target.value }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
