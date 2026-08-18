import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Switch,
  Tabs,
  Tooltip,
} from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  useWorkspaceSettingsStore,
  type AiAgentConfig,
  type AiAgentKind,
  type AiApiType,
  type AiModelConfig,
} from '../../stores/workspace-settings'
import { useProjectStore } from '../../stores/project'
import {
  clearWechatPrivateKey,
  getWechatPublishStatus,
  patchProjectConfig,
  saveWechatPrivateKey,
} from '../../api/projects'
import './WorkspaceSettingsButton.css'

export type WorkspaceSettingsButtonHandle = { open: (tab?: string) => void }

const WorkspaceSettingsButton = forwardRef<WorkspaceSettingsButtonHandle>(
  function WorkspaceSettingsButton(_props, ref) {
    const [visible, setVisible] = useState(false)
    const [activeTab, setActiveTab] = useState('network')
    const settings = useWorkspaceSettingsStore()
    const projectStore = useProjectStore()
    const pendingTabRef = useRef('')

    const [modelDialogVisible, setModelDialogVisible] = useState(false)
    const [editingModelId, setEditingModelId] = useState<string | null>(null)
    const [modelForm, setModelForm] = useState({
      name: '',
      apiType: 'openai' as AiApiType,
      baseUrl: '',
      apiKey: '',
      modelId: '',
      thinking: false,
    })

    const [agentDialogVisible, setAgentDialogVisible] = useState(false)
    const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
    const [agentForm, setAgentForm] = useState({
      name: '',
      kind: 'cursor' as AiAgentKind,
      apiKey: '',
      modelId: 'composer-2.5',
    })

    const [wechatAppId, setWechatAppId] = useState('')
    const [privateKeyDraft, setPrivateKeyDraft] = useState('')
    const [hasPrivateKey, setHasPrivateKey] = useState(false)
    const [wechatLoading, setWechatLoading] = useState(false)
    const [savingAppId, setSavingAppId] = useState(false)
    const [savingKey, setSavingKey] = useState(false)

    const loadWechatSettings = useCallback(async () => {
      if (!projectStore.path) return
      setWechatLoading(true)
      try {
        const status = await getWechatPublishStatus(projectStore.path)
        setWechatAppId(status.wechatAppId)
        setHasPrivateKey(status.hasPrivateKey)
        setPrivateKeyDraft('')
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '读取微信发布配置失败')
      } finally {
        setWechatLoading(false)
      }
    }, [projectStore.path])

    useEffect(() => {
      if (!visible) return
      if (!pendingTabRef.current) setActiveTab('network')
      else {
        setActiveTab(pendingTabRef.current)
        pendingTabRef.current = ''
      }
    }, [visible])

    useEffect(() => {
      if (visible && activeTab === 'project') {
        void loadWechatSettings()
      }
    }, [visible, activeTab, loadWechatSettings])

    const latencyDescription = useMemo(() => {
      const n = settings.apiLatencyMs
      if (n <= 0) return '设为 0 表示不延迟，预览调用 API 时立即返回数据'
      return `预览调用 API 时额外等待 ${n} ms 后再返回数据`
    }, [settings.apiLatencyMs])

    const hasProject = projectStore.hasProject

    const modelDialogTitle = editingModelId ? '编辑模型' : '添加模型'
    const agentDialogTitle = editingAgentId ? '编辑智能体' : '添加智能体'
    const keyStatusText = hasPrivateKey ? '已配置上传密钥' : '尚未配置上传密钥'

    async function saveWechatAppId() {
      if (!projectStore.path || !projectStore.config) return
      const next = wechatAppId.trim()
      setSavingAppId(true)
      try {
        const result = await patchProjectConfig({
          projectPath: projectStore.path,
          wechatAppId: next || null,
        })
        projectStore.setProject(result.path, result.config)
        setWechatAppId((result.config.wechatAppId ?? '').trim())
        ElMessage.success(next ? 'AppID 已保存' : '已清空 AppID')
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存 AppID 失败')
      } finally {
        setSavingAppId(false)
      }
    }

    async function savePrivateKey() {
      if (!projectStore.path) return
      const key = privateKeyDraft.trim()
      if (!key) {
        ElMessage.warning('请粘贴代码上传密钥全文')
        return
      }
      setSavingKey(true)
      try {
        await saveWechatPrivateKey({
          projectPath: projectStore.path,
          privateKey: key,
        })
        setHasPrivateKey(true)
        setPrivateKeyDraft('')
        ElMessage.success('上传密钥已保存')
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '保存密钥失败')
      } finally {
        setSavingKey(false)
      }
    }

    async function clearPrivateKey() {
      if (!projectStore.path || !hasPrivateKey) return
      try {
        await ElMessageBox.confirm(
          '确定清除本机保存的代码上传密钥？清除后需重新粘贴才能发布。',
          '清除上传密钥',
          { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消' },
        )
      } catch {
        return
      }
      setSavingKey(true)
      try {
        await clearWechatPrivateKey(projectStore.path)
        setHasPrivateKey(false)
        setPrivateKeyDraft('')
        ElMessage.success('已清除上传密钥')
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '清除密钥失败')
      } finally {
        setSavingKey(false)
      }
    }

    const open = useCallback((tab?: string) => {
      if (tab) {
        pendingTabRef.current = tab
        setActiveTab(tab)
      }
      setVisible(true)
    }, [])

    useImperativeHandle(ref, () => ({ open }), [open])

    function resetModelForm() {
      setModelForm({
        name: '',
        apiType: 'openai',
        baseUrl: '',
        apiKey: '',
        modelId: '',
        thinking: false,
      })
    }

    function openAddModel() {
      setEditingModelId(null)
      resetModelForm()
      setModelDialogVisible(true)
    }

    function openEditModel(model: AiModelConfig) {
      setEditingModelId(model.id)
      setModelForm({
        name: model.name,
        apiType: model.apiType,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        modelId: model.modelId,
        thinking: model.thinking,
      })
      setModelDialogVisible(true)
    }

    function saveModel() {
      const name = modelForm.name.trim()
      if (!name) {
        ElMessage.warning('请填写模型名称')
        return
      }
      settings.upsertAiModel({
        id: editingModelId ?? undefined,
        name,
        apiType: modelForm.apiType,
        baseUrl: modelForm.baseUrl,
        apiKey: modelForm.apiKey,
        modelId: modelForm.modelId,
        thinking: modelForm.thinking,
      })
      setModelDialogVisible(false)
      ElMessage.success(editingModelId ? '模型已更新' : '模型已添加')
    }

    async function deleteModel(model: AiModelConfig) {
      try {
        await ElMessageBox.confirm(`确定删除模型「${model.name}」？`, '删除模型', {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
        })
      } catch {
        return
      }
      settings.removeAiModel(model.id)
      ElMessage.success('模型已删除')
    }

    function resetAgentForm() {
      setAgentForm({
        name: '',
        kind: 'cursor',
        apiKey: '',
        modelId: 'composer-2.5',
      })
    }

    function openAddAgent() {
      setEditingAgentId(null)
      resetAgentForm()
      setAgentDialogVisible(true)
    }

    function openEditAgent(agent: AiAgentConfig) {
      setEditingAgentId(agent.id)
      setAgentForm({
        name: agent.name,
        kind: agent.kind,
        apiKey: agent.apiKey,
        modelId: agent.modelId || 'composer-2.5',
      })
      setAgentDialogVisible(true)
    }

    function saveAgent() {
      const name = agentForm.name.trim()
      if (!name) {
        ElMessage.warning('请填写智能体名称')
        return
      }
      if (!agentForm.apiKey.trim()) {
        ElMessage.warning('请填写 Cursor API Key')
        return
      }
      settings.upsertAiAgent({
        id: editingAgentId ?? undefined,
        name,
        kind: agentForm.kind,
        apiKey: agentForm.apiKey,
        modelId: agentForm.modelId.trim() || 'composer-2.5',
      })
      setAgentDialogVisible(false)
      ElMessage.success(editingAgentId ? '智能体已更新' : '智能体已添加')
    }

    async function deleteAgent(agent: AiAgentConfig) {
      try {
        await ElMessageBox.confirm(`确定删除智能体「${agent.name}」？`, '删除智能体', {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
        })
      } catch {
        return
      }
      settings.removeAiAgent(agent.id)
      ElMessage.success('智能体已删除')
    }

    return (
      <>
        <Tooltip title="设置" placement="bottom" mouseEnterDelay={0.05}>
          <Button
            className="header-icon-btn settings-trigger"
            icon={<SettingOutlined />}
            onClick={() => open()}
          />
        </Tooltip>
        <Modal
          open={visible}
          title="设置"
          width={560}
          destroyOnHidden
          centered
          maskClosable={false}
          keyboard={false}
          footer={null}
          className="workspace-settings-dialog"
          onCancel={() => setVisible(false)}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            className="settings-tabs"
            items={[
              {
                key: 'workbench',
                label: '工作台',
                children: <Empty description="暂无设置" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
              },
              {
                key: 'project',
                label: '项目',
                children: !hasProject ? (
                  <div className="settings-empty">
                    <Empty description="请先打开项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  </div>
                ) : (
                  <Spin spinning={wechatLoading}>
                    <div className="settings-list">
                      <div className="settings-block">
                        <div className="settings-title">微信小程序发布</div>
                        <div className="settings-desc">
                          配置 AppID 与代码上传密钥后，可在顶栏一键上传到微信后台（开发版）。密钥保存在项目
                          <code>.lubanstack/wechat/</code>，不会写入 luban.json。
                        </div>
                      </div>

                      <div className="settings-row settings-row-stack">
                        <div className="settings-meta">
                          <div className="settings-title">微信 AppID</div>
                          <div className="settings-desc">与微信公众平台小程序 AppID 一致</div>
                        </div>
                        <div className="settings-field">
                          <Input
                            value={wechatAppId}
                            allowClear
                            placeholder="wx…"
                            onChange={(e) => setWechatAppId(e.target.value)}
                          />
                          <Button type="primary" loading={savingAppId} onClick={() => void saveWechatAppId()}>
                            保存
                          </Button>
                        </div>
                      </div>

                      <div className="settings-row settings-row-stack">
                        <div className="settings-meta">
                          <div className="settings-title">代码上传密钥</div>
                          <div className="settings-desc">
                            {keyStatusText}。在微信公众平台 → 开发 → 开发管理 → 开发设置 →
                            小程序代码上传，生成并下载密钥；同时将本机公网 IP 加入白名单。
                          </div>
                        </div>
                        <div className="settings-field-col">
                          <Input.TextArea
                            value={privateKeyDraft}
                            rows={5}
                            placeholder="粘贴 private.key 全文（含 -----BEGIN PRIVATE KEY-----）"
                            onChange={(e) => setPrivateKeyDraft(e.target.value)}
                          />
                          <div className="key-actions">
                            <Button type="primary" loading={savingKey} onClick={() => void savePrivateKey()}>
                              保存密钥
                            </Button>
                            <Button disabled={!hasPrivateKey || savingKey} onClick={() => void clearPrivateKey()}>
                              清除
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Spin>
                ),
              },
              {
                key: 'file',
                label: '文件',
                children: <Empty description="暂无设置" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
              },
              {
                key: 'network',
                label: '网络',
                children: (
                  <div className="settings-list">
                    <div className="settings-row">
                      <div className="settings-meta">
                        <div className="settings-title">模拟 API 延迟</div>
                        <div className="settings-desc">{latencyDescription}</div>
                      </div>
                      <div className="settings-control">
                        <InputNumber
                          value={settings.apiLatencyMs}
                          min={0}
                          max={60000}
                          step={100}
                          className="latency-input"
                          onChange={(v) => settings.setApiLatencyMs(Number(v ?? 0))}
                        />
                        <span className="unit">ms</span>
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                key: 'ai',
                label: 'AI助手',
                children: (
                  <div className="settings-list">
                    <div className="settings-row">
                      <div className="settings-meta">
                        <div className="settings-title">开启AI助手</div>
                        <div className="settings-desc">
                          开启后在顶栏显示 AI 按钮，模型/智能体在浮窗中选择
                        </div>
                      </div>
                      <div className="settings-control">
                        <Switch
                          checked={settings.aiAssistantEnabled}
                          onChange={(checked) => settings.setAiAssistantEnabled(checked)}
                        />
                      </div>
                    </div>

                    {settings.aiModels.map((model) => (
                      <div key={model.id} className="settings-row model-row">
                        <div className="settings-meta">
                          <div className="settings-title">模型：{model.name}</div>
                          <div className="settings-desc">
                            {model.apiType === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                            {model.modelId ? ` · ${model.modelId}` : null}
                          </div>
                        </div>
                        <div className="settings-control model-actions">
                          <Button size="small" onClick={() => openEditModel(model)}>
                            编辑
                          </Button>
                          <Button size="small" danger onClick={() => void deleteModel(model)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    ))}

                    {settings.aiAgents.map((agent) => (
                      <div key={agent.id} className="settings-row model-row">
                        <div className="settings-meta">
                          <div className="settings-title">智能体：{agent.name}</div>
                          <div className="settings-desc">
                            Cursor
                            {agent.modelId ? ` · ${agent.modelId}` : null}
                          </div>
                        </div>
                        <div className="settings-control model-actions">
                          <Button size="small" onClick={() => openEditAgent(agent)}>
                            编辑
                          </Button>
                          <Button size="small" danger onClick={() => void deleteAgent(agent)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    ))}

                    <div className="add-model-row">
                      <Button onClick={openAddModel}>添加模型</Button>
                      <Button onClick={openAddAgent}>添加智能体</Button>
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </Modal>

        <Modal
          open={modelDialogVisible}
          title={modelDialogTitle}
          width={480}
          destroyOnHidden
          centered
          maskClosable={false}
          keyboard={false}
          onCancel={() => setModelDialogVisible(false)}
          footer={
            <>
              <Button onClick={() => setModelDialogVisible(false)}>取消</Button>
              <Button type="primary" onClick={saveModel}>
                保存
              </Button>
            </>
          }
        >
          <Form labelCol={{ flex: '96px' }} className="model-form">
            <Form.Item label="模型名称" required>
              <Input
                value={modelForm.name}
                placeholder="例如 GPT-4o"
                onChange={(e) => setModelForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Form.Item>
            <Form.Item label="API类型">
              <Select
                value={modelForm.apiType}
                style={{ width: '100%' }}
                options={[
                  { label: 'openai', value: 'openai' },
                  { label: 'Anthropic', value: 'anthropic' },
                ]}
                onChange={(v) => setModelForm((f) => ({ ...f, apiType: v }))}
              />
            </Form.Item>
            <Form.Item label="BaseUrl">
              <Input
                value={modelForm.baseUrl}
                placeholder="https://api.openai.com/v1"
                onChange={(e) => setModelForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
            </Form.Item>
            <Form.Item label="ApiKey">
              <Input.Password
                value={modelForm.apiKey}
                placeholder="API Key"
                onChange={(e) => setModelForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
            </Form.Item>
            <Form.Item label="模型ID">
              <Input
                value={modelForm.modelId}
                placeholder="例如 gpt-4o"
                onChange={(e) => setModelForm((f) => ({ ...f, modelId: e.target.value }))}
              />
            </Form.Item>
            <Form.Item label="思考">
              <Switch
                checked={modelForm.thinking}
                onChange={(checked) => setModelForm((f) => ({ ...f, thinking: checked }))}
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          open={agentDialogVisible}
          title={agentDialogTitle}
          width={480}
          destroyOnHidden
          centered
          maskClosable={false}
          keyboard={false}
          onCancel={() => setAgentDialogVisible(false)}
          footer={
            <>
              <Button onClick={() => setAgentDialogVisible(false)}>取消</Button>
              <Button type="primary" onClick={saveAgent}>
                保存
              </Button>
            </>
          }
        >
          <Form labelCol={{ flex: '110px' }} className="model-form">
            <Form.Item label="名称" required>
              <Input
                value={agentForm.name}
                placeholder="例如 Cursor 本地"
                onChange={(e) => setAgentForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Form.Item>
            <Form.Item label="类型" required>
              <Select
                value={agentForm.kind}
                style={{ width: '100%' }}
                options={[{ label: 'Cursor', value: 'cursor' }]}
                onChange={(v) => setAgentForm((f) => ({ ...f, kind: v }))}
              />
            </Form.Item>
            <Form.Item label="API Key" required>
              <Input.Password
                value={agentForm.apiKey}
                placeholder="Cursor Dashboard → API Keys"
                onChange={(e) => setAgentForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
            </Form.Item>
            <Form.Item label="模型 ID">
              <Input
                value={agentForm.modelId}
                placeholder="composer-2.5 或 auto"
                onChange={(e) => setAgentForm((f) => ({ ...f, modelId: e.target.value }))}
              />
            </Form.Item>
          </Form>
        </Modal>
      </>
    )
  },
)

export default WorkspaceSettingsButton
