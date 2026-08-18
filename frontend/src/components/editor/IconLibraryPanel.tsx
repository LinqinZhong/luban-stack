import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Form, Input, Modal, Select, Spin, Tooltip } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  deleteOssObject,
  getOssLibrary,
  getOssObjectMeta,
  listOssBuckets,
  uploadOssObject,
} from '../../api/projects'
import {
  isValidIconId,
  parseSvgSource,
  type IconDefinition,
  type IconLibrary,
} from '../../types/icon-library'
import type { OssBindingConfig } from '../../types/page-data'
import type {
  OssBucketInfo,
  OssConnectionConfig,
  OssConnectionPayload,
} from '../../types/oss'
import {
  buildIconSvgMarkup,
  buildOssPublicUrl,
  createIconOssObjectKey,
  isOssBound,
  resolveOssConnectionPayload,
  utf8ToBase64,
} from '../../utils/oss-binding'
import './IconLibraryPanel.css'

export default function IconLibraryPanel({
  library,
  projectPath,
  onLibraryChange,
}: {
  library: IconLibrary
  projectPath?: string | null
  onLibraryChange?: (library: IconLibrary) => void
}) {
  const icons = library.icons

  function setIcons(value: IconDefinition[]) {
    onLibraryChange?.({ icons: value })
  }

  const [dialogVisible, setDialogVisible] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ id: '', label: '', rawSvg: '' })

  const [bindDialogVisible, setBindDialogVisible] = useState(false)
  const [bindingIconId, setBindingIconId] = useState('')
  const [bindBusy, setBindBusy] = useState(false)
  const [bindLoading, setBindLoading] = useState(false)
  const [bindHydrating, setBindHydrating] = useState(false)
  const [bindConnections, setBindConnections] = useState<OssConnectionConfig[]>([])
  const [bindConnectionId, setBindConnectionId] = useState('')
  const [bindBucketName, setBindBucketName] = useState('')
  const skipConnWatch = useRef(true)

  const bindingIcon = useMemo(
    () => icons.find((item) => item.id === bindingIconId) ?? null,
    [icons, bindingIconId],
  )

  const bindActiveConnection = useMemo(
    () => bindConnections.find((c) => c.id === bindConnectionId) ?? null,
    [bindConnections, bindConnectionId],
  )

  const bindBuckets = useMemo<OssBucketInfo[]>(
    () => bindActiveConnection?.buckets ?? [],
    [bindActiveConnection],
  )

  const bindPayload = useMemo<OssConnectionPayload | null>(() => {
    if (!bindActiveConnection) return null
    return {
      endpoint: bindActiveConnection.endpoint,
      region: bindActiveConnection.region,
      accessKeyId: bindActiveConnection.accessKeyId,
      secretAccessKey: bindActiveConnection.secretAccessKey,
      forcePathStyle: bindActiveConnection.forcePathStyle,
    }
  }, [bindActiveConnection])

  function openCreate() {
    setEditingId(null)
    setForm({ id: '', label: '', rawSvg: '' })
    setDialogVisible(true)
  }

  function openEdit(icon: IconDefinition) {
    setEditingId(icon.id)
    setForm({
      id: icon.id,
      label: icon.label,
      rawSvg: buildIconSvgMarkup(icon.viewBox, icon.content),
    })
    setDialogVisible(true)
  }

  function updateIcon(id: string, patch: Partial<IconDefinition>) {
    setIcons(icons.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  async function syncIconToOss(
    icon: IconDefinition,
  ): Promise<OssBindingConfig | null> {
    const binding = icon.ossBinding
    if (!isOssBound(binding)) return null
    const path = projectPath?.trim()
    if (!path) throw new Error('未打开项目，无法同步对象存储')

    const payload = await resolveOssConnectionPayload(path, binding)
    const svg = buildIconSvgMarkup(icon.viewBox, icon.content)
    await uploadOssObject({
      ...payload,
      bucketName: binding.bucketName,
      key: binding.objectKey,
      contentBase64: utf8ToBase64(svg),
      contentType: 'image/svg+xml',
    })

    let url =
      binding.url ||
      buildOssPublicUrl(payload, binding.bucketName, binding.objectKey) ||
      ''
    try {
      const meta = await getOssObjectMeta({
        ...payload,
        bucketName: binding.bucketName,
        key: binding.objectKey,
      })
      if (meta.publicUrl) url = meta.publicUrl
    } catch {
      // 保留原外链
    }

    return {
      ...binding,
      url,
    }
  }

  async function deleteIconFromOss(icon: IconDefinition) {
    const binding = icon.ossBinding
    if (!isOssBound(binding)) return
    const path = projectPath?.trim()
    if (!path) throw new Error('未打开项目，无法同步对象存储')
    const payload = await resolveOssConnectionPayload(path, binding)
    await deleteOssObject({
      ...payload,
      bucketName: binding.bucketName,
      key: binding.objectKey,
    })
  }

  async function removeIcon(icon: IconDefinition) {
    const bound = isOssBound(icon.ossBinding)
    try {
      await ElMessageBox.confirm(
        bound
          ? `确定删除图标「${icon.label || icon.id}」吗？将同时删除对象存储中的对应文件。`
          : `确定删除图标「${icon.label || icon.id}」吗？引用该图标的控件将显示占位。`,
        '删除图标',
        {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
        },
      )
    } catch {
      return
    }

    if (bound) {
      try {
        await deleteIconFromOss(icon)
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : '删除对象存储文件失败')
        return
      }
    }

    setIcons(icons.filter((item) => item.id !== icon.id))
    ElMessage.success('已删除图标')
  }

  async function refreshBindBuckets(
    payload: OssConnectionPayload | null,
    connId: string,
  ): Promise<OssBucketInfo[]> {
    if (!payload) return []
    try {
      const result = await listOssBuckets(payload)
      setBindConnections((prev) =>
        prev.map((c) => (c.id === connId ? { ...c, buckets: result.buckets } : c)),
      )
      return result.buckets
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '列出桶失败')
      return []
    }
  }

  async function openBind(icon: IconDefinition) {
    const path = projectPath?.trim()
    if (!path) {
      ElMessage.warning('未打开项目，无法绑定对象存储')
      return
    }
    setBindingIconId(icon.id)
    setBindDialogVisible(true)
    setBindLoading(true)
    setBindHydrating(true)
    skipConnWatch.current = true
    try {
      const preferredConn = icon.ossBinding?.connectionId || ''
      const preferredBucket = icon.ossBinding?.bucketName || ''
      const lib = await getOssLibrary(path)
      const list = lib.connections ?? []
      setBindConnections(list)
      const nextConnId =
        (preferredConn && list.some((c) => c.id === preferredConn) && preferredConn) ||
        list[0]?.id ||
        ''
      setBindConnectionId(nextConnId)
      const conn = list.find((c) => c.id === nextConnId) ?? null
      const payload = conn
        ? {
            endpoint: conn.endpoint,
            region: conn.region,
            accessKeyId: conn.accessKeyId,
            secretAccessKey: conn.secretAccessKey,
            forcePathStyle: conn.forcePathStyle,
          }
        : null
      let nextBuckets = conn?.buckets ?? []
      if (nextConnId && !nextBuckets.length) {
        nextBuckets = await refreshBindBuckets(payload, nextConnId)
      }
      setBindBucketName(
        (preferredBucket &&
          nextBuckets.some((b) => b.name === preferredBucket) &&
          preferredBucket) ||
          nextBuckets[0]?.name ||
          '',
      )
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载对象存储失败')
      setBindConnections([])
      setBindConnectionId('')
      setBindBucketName('')
    } finally {
      setBindLoading(false)
      setBindHydrating(false)
      queueMicrotask(() => {
        skipConnWatch.current = false
      })
    }
  }

  useEffect(() => {
    if (!bindDialogVisible || bindHydrating || skipConnWatch.current || !bindConnectionId)
      return
    setBindBucketName('')
    void (async () => {
      const buckets = await refreshBindBuckets(bindPayload, bindConnectionId)
      setBindBucketName(buckets[0]?.name || '')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindConnectionId])

  async function confirmBind() {
    const icon = bindingIcon
    const payload = bindPayload
    if (!icon || !payload) return
    if (!bindConnectionId || !bindBucketName) {
      ElMessage.warning('请选择连接和桶')
      return
    }

    setBindBusy(true)
    try {
      const prevBinding = icon.ossBinding
      if (isOssBound(prevBinding)) {
        try {
          await deleteIconFromOss(icon)
        } catch {
          // 旧对象删除失败不阻断重新绑定
        }
      }

      const objectKey = createIconOssObjectKey()
      const svg = buildIconSvgMarkup(icon.viewBox, icon.content)
      await uploadOssObject({
        ...payload,
        bucketName: bindBucketName,
        key: objectKey,
        contentBase64: utf8ToBase64(svg),
        contentType: 'image/svg+xml',
      })

      let url = buildOssPublicUrl(payload, bindBucketName, objectKey) || ''
      try {
        const meta = await getOssObjectMeta({
          ...payload,
          bucketName: bindBucketName,
          key: objectKey,
        })
        if (meta.publicUrl) url = meta.publicUrl
      } catch {
        // 保留拼出的外链
      }

      const config: OssBindingConfig = {
        connectionId: bindConnectionId,
        bucketName: bindBucketName,
        objectKey,
        url,
      }
      updateIcon(icon.id, { ossBinding: config })
      setBindDialogVisible(false)
      ElMessage.success('已绑定并上传到对象存储')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '绑定对象存储失败')
    } finally {
      setBindBusy(false)
    }
  }

  async function unbindIcon(icon: IconDefinition) {
    if (!isOssBound(icon.ossBinding)) return
    try {
      await ElMessageBox.confirm(
        `确定解绑「${icon.label || icon.id}」吗？仅清除绑定关系，不会删除对象存储中的文件。`,
        '解绑对象存储',
        {
          type: 'warning',
          confirmButtonText: '解绑',
          cancelButtonText: '取消',
        },
      )
    } catch {
      return
    }
    setIcons(
      icons.map((item) => {
        if (item.id !== icon.id) return item
        const { ossBinding: _removed, ...rest } = item
        return rest
      }),
    )
    ElMessage.success('已解绑')
  }

  async function saveIcon() {
    const id = form.id.trim()
    if (!isValidIconId(id)) {
      ElMessage.error('图标 ID 需以字母开头，仅含字母、数字、下划线和短横线')
      return
    }

    const parsed = parseSvgSource(form.rawSvg)
    if (!parsed?.content) {
      ElMessage.error('请粘贴有效的 SVG 代码')
      return
    }

    const duplicate = icons.some((item) => item.id === id && item.id !== editingId)
    if (duplicate) {
      ElMessage.error('图标 ID 已存在')
      return
    }

    const prev = editingId ? icons.find((item) => item.id === editingId) : undefined

    const next: IconDefinition = {
      id,
      label: form.label.trim() || id,
      viewBox: parsed.viewBox || '0 0 24 24',
      content: parsed.content,
      ...(prev?.ossBinding ? { ossBinding: prev.ossBinding } : {}),
    }

    setSaving(true)
    try {
      if (isOssBound(next.ossBinding)) {
        const synced = await syncIconToOss(next)
        if (synced) next.ossBinding = synced
      }

      if (editingId) {
        setIcons(icons.map((item) => (item.id === editingId ? next : item)))
      } else {
        setIcons([...icons, next])
      }

      setDialogVisible(false)
      ElMessage.success(editingId ? '已更新图标' : '已添加图标')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '同步对象存储失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="icon-library-panel">
      <div className="panel-toolbar">
        <div className="toolbar-text">
          <div className="title">图标库</div>
          <div className="desc">
            项目级 SVG 符号表，控件通过 iconId 引用，不重复内联代码
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          添加图标
        </Button>
      </div>

      {!icons.length ? (
        <Empty description="暂无图标，点击添加自定义 SVG" styles={{ image: { height: 72 } }} />
      ) : (
        <div className="icon-grid">
          {icons.map((icon) => (
            <div key={icon.id} className="icon-card">
              <div className="icon-main">
                <div className="icon-preview">
                  <svg
                    className="preview-svg"
                    viewBox={icon.viewBox}
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: icon.content }}
                  />
                </div>
                <div className="icon-meta">
                  <div className="icon-label" title={icon.label}>
                    {icon.label}
                  </div>
                  <div className="icon-id" title={icon.id}>
                    {icon.id}
                  </div>
                  {isOssBound(icon.ossBinding) ? (
                    <div className="icon-bound" title="已绑定对象存储">
                      已绑定
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="icon-actions">
                <Tooltip
                  title={isOssBound(icon.ossBinding) ? '重新绑定' : '绑定'}
                  placement="top"
                >
                  <Button
                    type="text"
                    shape="circle"
                    icon={<UploadOutlined />}
                    disabled={bindBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      void openBind(icon)
                    }}
                  />
                </Tooltip>
                {isOssBound(icon.ossBinding) ? (
                  <Tooltip title="解绑" placement="top">
                    <Button
                      type="text"
                      shape="circle"
                      icon={<LinkOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        void unbindIcon(icon)
                      }}
                    />
                  </Tooltip>
                ) : null}
                <Tooltip title="编辑" placement="top">
                  <Button
                    type="text"
                    shape="circle"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation()
                      openEdit(icon)
                    }}
                  />
                </Tooltip>
                <Tooltip title="删除" placement="top">
                  <Button
                    type="text"
                    shape="circle"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeIcon(icon)
                    }}
                  />
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={dialogVisible}
        title={editingId ? '编辑图标' : '添加图标'}
        width={560}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setDialogVisible(false)}
        footer={
          <Button type="primary" loading={saving} onClick={() => void saveIcon()}>
            保存
          </Button>
        }
      >
        <Form layout="vertical">
          <Form.Item label="图标 ID" required>
            <Input
              value={form.id}
              disabled={Boolean(editingId)}
              placeholder="例如：home"
              onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
            />
          </Form.Item>
          <Form.Item label="显示名称">
            <Input
              value={form.label}
              placeholder="例如：首页"
              onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
            />
          </Form.Item>
          <Form.Item label="SVG 代码" required>
            <Input.TextArea
              value={form.rawSvg}
              rows={8}
              placeholder="粘贴完整 <svg>...</svg>，或仅内部 path 等 markup"
              onChange={(e) =>
                setForm((prev) => ({ ...prev, rawSvg: e.target.value }))
              }
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={bindDialogVisible}
        title="绑定对象存储"
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setBindDialogVisible(false)}
        footer={
          <Button
            type="primary"
            loading={bindBusy}
            disabled={!bindConnectionId || !bindBucketName}
            onClick={() => void confirmBind()}
          >
            绑定并上传
          </Button>
        }
      >
        <Spin spinning={bindLoading}>
          <div className="bind-form">
            {!projectPath ? (
              <Empty
                description="未打开项目，无法读取对象存储"
                styles={{ image: { height: 56 } }}
              />
            ) : !bindConnections.length ? (
              <Empty
                description="暂无对象存储连接，请先在「对象存储」中配置"
                styles={{ image: { height: 56 } }}
              />
            ) : (
              <Form layout="vertical">
                <Form.Item label="连接" required>
                  <Select
                    showSearch
                    placeholder="选择连接"
                    style={{ width: '100%' }}
                    value={bindConnectionId || undefined}
                    options={bindConnections.map((c) => ({
                      label: c.name,
                      value: c.id,
                    }))}
                    onChange={setBindConnectionId}
                  />
                </Form.Item>
                <Form.Item label="桶" required>
                  <Select
                    showSearch
                    placeholder="选择桶"
                    style={{ width: '100%' }}
                    disabled={!bindConnectionId}
                    value={bindBucketName || undefined}
                    options={bindBuckets.map((b) => ({
                      label: b.name,
                      value: b.name,
                    }))}
                    onChange={setBindBucketName}
                  />
                </Form.Item>
                <p className="bind-hint">
                  将自动生成以 icon_ 开头的对象 key，并上传当前 SVG。
                </p>
              </Form>
            )}
          </div>
        </Spin>
      </Modal>
    </div>
  )
}
