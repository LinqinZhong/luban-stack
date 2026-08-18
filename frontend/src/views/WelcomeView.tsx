import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Empty, Form, Input, InputNumber, Modal, Skeleton } from 'antd'
import {
  ArrowUpOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
} from '@ant-design/icons'
import {
  browseProjectDirectory,
  createProject,
  getProjectMeta,
  openProject,
  type BrowseEntry,
  type ProjectMeta,
} from '../api/projects'
import { useProjectStore } from '../stores/project'
import LubanStackLogo from '../components/icons/LubanStackLogo'
import { PRODUCT_NAME } from '../constants/brand'
import { ElMessage } from '../ui/feedback'
import './WelcomeView.css'

export default function WelcomeView() {
  const navigate = useNavigate()
  const projectStore = useProjectStore()

  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [openDialogVisible, setOpenDialogVisible] = useState(false)
  const [createDialogVisible, setCreateDialogVisible] = useState(false)
  const [folderPickerVisible, setFolderPickerVisible] = useState(false)
  const [folderPickerMode, setFolderPickerMode] = useState<'open' | 'create'>('open')
  const [loading, setLoading] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  const [openPath, setOpenPath] = useState('')
  const [browsePath, setBrowsePath] = useState('')
  const [browseParent, setBrowseParent] = useState<string | null>(null)
  const [browseEntries, setBrowseEntries] = useState<BrowseEntry[]>([])

  const [createForm] = Form.useForm<{
    path: string
    name: string
    author: string
    version: string
    canvasWidth: number
  }>()

  const engineVersionLabel = meta?.engineVersion ?? '1.0.0'
  const configFileName = meta?.configFile ?? 'luban.json'

  useEffect(() => {
    void getProjectMeta()
      .then((next) => {
        setMeta(next)
        createForm.setFieldValue('canvasWidth', next.defaultCanvasWidth)
      })
      .catch(() => {
        /* keep defaults */
      })
  }, [createForm])

  async function loadBrowse(dirPath?: string) {
    setBrowsing(true)
    try {
      const result = await browseProjectDirectory(dirPath)
      setBrowsePath(result.path)
      setBrowseParent(result.parent)
      setBrowseEntries(result.entries)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '无法浏览文件夹')
    } finally {
      setBrowsing(false)
    }
  }

  function openFolderPicker(mode: 'open' | 'create') {
    setFolderPickerMode(mode)
    setFolderPickerVisible(true)
    void loadBrowse()
  }

  function selectBrowseEntry(entry: BrowseEntry) {
    void loadBrowse(entry.path)
  }

  function confirmFolderPick() {
    if (!browsePath) {
      ElMessage.warning('请先进入一个文件夹')
      return
    }
    if (folderPickerMode === 'open') setOpenPath(browsePath)
    else createForm.setFieldValue('path', browsePath)
    setFolderPickerVisible(false)
  }

  async function handleOpenProject() {
    if (!openPath.trim()) {
      ElMessage.warning('请选择或输入项目路径')
      return
    }
    setLoading(true)
    try {
      const result = await openProject(openPath.trim())
      projectStore.setProject(result.path, result.config)
      ElMessage.success(`已打开项目：${result.config.name}`)
      setOpenDialogVisible(false)
      await navigate('/workspace')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '打开项目失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateProject() {
    try {
      const values = await createForm.validateFields()
      setLoading(true)
      try {
        const result = await createProject({
          path: values.path.trim(),
          name: values.name.trim(),
          author: (values.author ?? '').trim(),
          version: values.version.trim(),
          canvasWidth: Number(values.canvasWidth),
          engineVersion: engineVersionLabel,
        })
        projectStore.setProject(result.path, result.config)
        ElMessage.success(`已创建项目：${result.config.name}`)
        setCreateDialogVisible(false)
        await navigate('/workspace')
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '创建项目失败')
      } finally {
        setLoading(false)
      }
    } catch {
      /* validation */
    }
  }

  function goWorkspaceIfReady() {
    if (projectStore.hasProject) void navigate('/workspace')
  }

  return (
    <div className="welcome">
      <div className="panel">
        <div className="brand">
          <LubanStackLogo className="brand-mark" size={56} />
          <div className="brand-text">
            <h1>{PRODUCT_NAME}</h1>
            <p>H5 低代码开发工具</p>
          </div>
        </div>
        <div className="actions">
          <Button
            type="primary"
            size="large"
            icon={<FolderOpenOutlined />}
            onClick={() => setOpenDialogVisible(true)}
          >
            打开项目
          </Button>
          <Button
            size="large"
            icon={<FolderAddOutlined />}
            onClick={() => setCreateDialogVisible(true)}
          >
            新建项目
          </Button>
        </div>
        {projectStore.hasProject ? (
          <div className="recent">
            <p>
              最近项目：
              <strong>{projectStore.config?.name}</strong>
            </p>
            <p className="path">{projectStore.path}</p>
            <Button type="link" onClick={goWorkspaceIfReady}>
              继续编辑
            </Button>
          </div>
        ) : null}
      </div>

      <Modal
        title="打开项目"
        open={openDialogVisible}
        onCancel={() => setOpenDialogVisible(false)}
        width={560}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        footer={
          <Button type="primary" loading={loading} onClick={() => void handleOpenProject()}>
            打开
          </Button>
        }
      >
        <p className="hint">选择包含 {configFileName} 的项目文件夹</p>
        <div className="path-row">
          <Input
            value={openPath}
            allowClear
            placeholder="项目文件夹路径"
            onChange={(e) => setOpenPath(e.target.value)}
          />
          <Button icon={<FolderOutlined />} onClick={() => openFolderPicker('open')}>
            浏览
          </Button>
        </div>
      </Modal>

      <Modal
        title="新建项目"
        open={createDialogVisible}
        onCancel={() => setCreateDialogVisible(false)}
        width={560}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        footer={
          <Button type="primary" loading={loading} onClick={() => void handleCreateProject()}>
            创建
          </Button>
        }
      >
        <Form
          form={createForm}
          labelCol={{ span: 5 }}
          initialValues={{ version: '0.1.0', canvasWidth: 375 }}
        >
          <Form.Item
            label="项目路径"
            name="path"
            rules={[{ required: true, message: '请选择项目文件夹' }]}
          >
            <div className="path-row full">
              <Input
                placeholder={`将在此文件夹创建 ${configFileName}`}
                allowClear
                value={createForm.getFieldValue('path')}
                onChange={(e) => createForm.setFieldValue('path', e.target.value)}
              />
              <Button icon={<FolderOutlined />} onClick={() => openFolderPicker('create')}>
                浏览
              </Button>
            </div>
          </Form.Item>
          <Form.Item
            label="项目名称"
            name="name"
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input placeholder="例如：活动页" />
          </Form.Item>
          <Form.Item label="作者" name="author">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item
            label="版本号"
            name="version"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input placeholder="0.1.0" />
          </Form.Item>
          <Form.Item
            label="画布宽度"
            name="canvasWidth"
            rules={[{ required: true, message: '请输入画布宽度' }]}
          >
            <InputNumber min={1} max={5000} />
            <span className="unit">px</span>
          </Form.Item>
          <Form.Item label="引擎版本">
            <Input value={engineVersionLabel} disabled />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="选择文件夹"
        open={folderPickerVisible}
        onCancel={() => setFolderPickerVisible(false)}
        width={640}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        footer={
          <Button type="primary" onClick={confirmFolderPick}>
            选择当前文件夹
          </Button>
        }
      >
        <div className="browser-toolbar">
          <Button
            icon={<ArrowUpOutlined />}
            disabled={!browseParent && browsePath !== ''}
            onClick={() => void loadBrowse(browseParent ?? undefined)}
          >
            上级
          </Button>
          <Input value={browsePath || '此电脑'} readOnly />
        </div>
        {browsing ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : !browseEntries.length ? (
          <Empty description="没有可进入的子文件夹" />
        ) : (
          <div className="browser-list">
            {browseEntries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="browser-item"
                onDoubleClick={() => selectBrowseEntry(entry)}
                onClick={() => setBrowsePath(entry.path)}
              >
                <FolderOutlined />
                <span>{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
