import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Input, Modal, Spin, Table, Tag } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  createOssBucket,
  deleteOssBucket,
  listOssBuckets,
  setOssBucketAccess,
} from '../../api/projects'
import OssConnectionDialog from './OssConnectionDialog'
import OssObjectsPanel from './OssObjectsPanel'
import {
  createEmptyOssConnection,
  type OssBucketInfo,
  type OssConnectionConfig,
  type OssConnectionPayload,
  type OssLibrary,
} from '../../types/oss'
import './OssPanel.css'

export default function OssPanel({
  library,
  onLibraryChange,
}: {
  library: OssLibrary
  onLibraryChange?: (library: OssLibrary) => void
}) {
  const connections = library.connections

  function setConnections(value: OssConnectionConfig[]) {
    onLibraryChange?.({ connections: value })
  }

  const [activeId, setActiveId] = useState('')
  const [connDialogVisible, setConnDialogVisible] = useState(false)
  const [editingConn, setEditingConn] = useState<OssConnectionConfig | null>(null)
  const [viewingBucket, setViewingBucket] = useState<OssBucketInfo | null>(null)
  const [createBucketVisible, setCreateBucketVisible] = useState(false)
  const [newBucketName, setNewBucketName] = useState('')
  const [creatingBucket, setCreatingBucket] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!connections.length) {
      setActiveId('')
      setViewingBucket(null)
      return
    }
    if (!connections.some((c) => c.id === activeId)) {
      setActiveId(connections[0]!.id)
      setViewingBucket(null)
    }
  }, [connections, activeId])

  useEffect(() => {
    setViewingBucket(null)
  }, [activeId])

  const activeConn = useMemo(
    () => connections.find((c) => c.id === activeId) ?? null,
    [connections, activeId],
  )

  const buckets = activeConn?.buckets ?? []

  const connectionPayload = useMemo<OssConnectionPayload | null>(() => {
    if (!activeConn) return null
    return {
      endpoint: activeConn.endpoint,
      region: activeConn.region,
      accessKeyId: activeConn.accessKeyId,
      secretAccessKey: activeConn.secretAccessKey,
      forcePathStyle: activeConn.forcePathStyle,
    }
  }, [activeConn])

  function patchActiveBuckets(nextBuckets: OssBucketInfo[]) {
    if (!activeConn) return
    const prev = new Map(activeConn.buckets.map((b) => [b.name, b.access]))
    const merged = nextBuckets.map((b) => ({
      ...b,
      access: (prev.get(b.name) === 'public' || b.access === 'public'
        ? 'public'
        : 'private') as 'public' | 'private',
    }))
    setConnections(
      connections.map((c) =>
        c.id === activeConn.id
          ? { ...c, buckets: merged, lastTestedAt: Date.now() }
          : c,
      ),
    )
  }

  function patchBucketAccess(bucketName: string, access: 'public' | 'private') {
    if (!activeConn) return
    setConnections(
      connections.map((c) =>
        c.id === activeConn.id
          ? {
              ...c,
              buckets: c.buckets.map((b) =>
                b.name === bucketName ? { ...b, access } : b,
              ),
            }
          : c,
      ),
    )
    setViewingBucket((prev) =>
      prev?.name === bucketName ? { ...prev, access } : prev,
    )
  }

  function openCreateConn() {
    setEditingConn(createEmptyOssConnection(`对象存储${connections.length + 1}`))
    setConnDialogVisible(true)
  }

  function openEditConn(conn: OssConnectionConfig) {
    setEditingConn(JSON.parse(JSON.stringify(conn)) as OssConnectionConfig)
    setConnDialogVisible(true)
  }

  type ConnMenuCommand = 'config' | 'delete'

  function handleConnMenuCommand(
    command: ConnMenuCommand,
    conn: OssConnectionConfig,
  ) {
    if (command === 'config') openEditConn(conn)
    else void removeConn(conn)
  }

  async function removeConn(conn: OssConnectionConfig) {
    try {
      await ElMessageBox.confirm(
        `确定删除对象存储连接「${conn.name}」吗？`,
        '删除连接',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    setConnections(connections.filter((c) => c.id !== conn.id))
  }

  function handleSaveConn(conn: OssConnectionConfig) {
    const dup = connections.some((c) => c.name === conn.name && c.id !== conn.id)
    if (dup) {
      ElMessage.error(`连接名称「${conn.name}」已存在`)
      return
    }
    const idx = connections.findIndex((c) => c.id === conn.id)
    if (idx >= 0) {
      setConnections(connections.map((c) => (c.id === conn.id ? conn : c)))
    } else {
      setConnections([...connections, conn])
    }
    setActiveId(conn.id)
    ElMessage.success('已保存对象存储配置')
  }

  function ensureConnection(): OssConnectionPayload | null {
    const conn = connectionPayload
    if (!conn) {
      ElMessage.warning('请先选择对象存储连接')
      return null
    }
    if (!conn.endpoint.trim()) {
      ElMessage.warning('请先配置连接并填写 Endpoint')
      openEditConn(activeConn!)
      return null
    }
    return conn
  }

  function openCreateBucket() {
    if (!ensureConnection()) return
    setNewBucketName('')
    setCreateBucketVisible(true)
  }

  async function handleCreateBucket() {
    const conn = ensureConnection()
    if (!conn) return
    const name = newBucketName.trim()
    if (!name) {
      ElMessage.error('请填写桶名称')
      return
    }
    setCreatingBucket(true)
    try {
      const result = await createOssBucket({ ...conn, bucketName: name })
      patchActiveBuckets(result.buckets)
      setCreateBucketVisible(false)
      ElMessage.success(`已创建桶「${name}」`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '创建桶失败')
    } finally {
      setCreatingBucket(false)
    }
  }

  function openViewBucket(row: OssBucketInfo) {
    if (!ensureConnection()) return
    setViewingBucket(row)
  }

  function closeViewBucket() {
    setViewingBucket(null)
  }

  async function refreshBuckets() {
    const conn = ensureConnection()
    if (!conn) return
    setBusy(true)
    try {
      const result = await listOssBuckets(conn)
      patchActiveBuckets(result.buckets)
      ElMessage.success(`已刷新，共 ${result.buckets.length} 个桶`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeBucket(row: OssBucketInfo) {
    const conn = ensureConnection()
    if (!conn) return
    try {
      await ElMessageBox.confirm(
        `确定删除桶「${row.name}」吗？桶必须为空才能删除。`,
        '删除桶',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    setBusy(true)
    try {
      const result = await deleteOssBucket({ ...conn, bucketName: row.name })
      patchActiveBuckets(result.buckets)
      ElMessage.success(`已删除桶「${row.name}」`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  async function toggleBucketAccess(row: OssBucketInfo) {
    const conn = ensureConnection()
    if (!conn) return
    const nextAccess = row.access === 'public' ? 'private' : 'public'
    const label = nextAccess === 'public' ? '公有' : '私有'
    try {
      await ElMessageBox.confirm(
        nextAccess === 'public'
          ? `将桶「${row.name}」设为公有后，匿名即可通过外链读取对象。确定继续？`
          : `将桶「${row.name}」设为私有后，前端访问需运行时签名。确定继续？`,
        `设为${label}`,
        {
          type: 'warning',
          confirmButtonText: `设为${label}`,
          cancelButtonText: '取消',
        },
      )
    } catch {
      return
    }
    setBusy(true)
    try {
      await setOssBucketAccess({
        ...conn,
        bucketName: row.name,
        access: nextAccess,
      })
      patchBucketAccess(row.name, nextAccess)
      ElMessage.success(`已将桶「${row.name}」设为${label}`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : `设为${label}失败`)
    } finally {
      setBusy(false)
    }
  }

  function formatTime(ts: number | null): string {
    if (!ts) return '未同步'
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return '—'
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }

  function shortEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint)
      return url.host || endpoint
    } catch {
      return endpoint
    }
  }

  const bucketColumns = [
    { title: '桶名', dataIndex: 'name', key: 'name', minWidth: 160 },
    {
      title: '访问',
      dataIndex: 'access',
      key: 'access',
      width: 100,
      render: (access: string) => (
        <Tag color={access === 'public' ? 'success' : 'default'}>
          {access === 'public' ? '公有' : '私有'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'creationDate',
      key: 'creationDate',
      minWidth: 150,
      render: (iso: string | null) => formatDate(iso),
    },
    { title: 'Region', dataIndex: 'region', key: 'region', width: 120 },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right' as const,
      render: (_: unknown, row: OssBucketInfo) => (
        <>
          <Button type="link" onClick={() => openViewBucket(row)}>
            查看
          </Button>
          <Button type="link" onClick={() => void toggleBucketAccess(row)}>
            {row.access === 'public' ? '设为私有' : '设为公有'}
          </Button>
          <Button type="link" danger onClick={() => void removeBucket(row)}>
            删除
          </Button>
        </>
      ),
    },
  ]

  return (
    <div className="oss-panel">
      <Spin spinning={busy} wrapperClassName="oss-spin">
        <div className="oss-body">
          <aside className="conn-pane">
            <div className="pane-head">
              <span className="pane-title">连接</span>
              <Button type="link" icon={<PlusOutlined />} onClick={openCreateConn}>
                添加
              </Button>
            </div>
            {!connections.length ? (
              <Empty description="添加对象存储连接" styles={{ image: { height: 56 } }} />
            ) : (
              <ul className="conn-list">
                {connections.map((conn) => (
                  <Dropdown
                    key={conn.id}
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'config', label: '配置' },
                        { type: 'divider' },
                        { key: 'delete', label: '删除', danger: true },
                      ],
                      onClick: ({ key }) =>
                        handleConnMenuCommand(key as ConnMenuCommand, conn),
                    }}
                  >
                    <li
                      className={`conn-item${conn.id === activeId ? ' active' : ''}`}
                      onClick={() => setActiveId(conn.id)}
                      onDoubleClick={() => openEditConn(conn)}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <div className="conn-meta">
                        <div className="conn-name">{conn.name}</div>
                        <div className="conn-sub-row">
                          <div className="conn-sub">{shortEndpoint(conn.endpoint)}</div>
                          <span className="conn-count">{conn.buckets.length}个桶</span>
                        </div>
                      </div>
                    </li>
                  </Dropdown>
                ))}
              </ul>
            )}
          </aside>

          <section className="bucket-pane">
            {viewingBucket && connectionPayload ? (
              <OssObjectsPanel
                connection={connectionPayload}
                bucket={viewingBucket}
                onBack={closeViewBucket}
              />
            ) : (
              <>
                <div className="pane-head">
                  <span className="pane-title">存储桶</span>
                  {activeConn ? (
                    <span className="pane-sub">
                      最近同步：{formatTime(activeConn.lastTestedAt)}
                    </span>
                  ) : null}
                  {activeConn ? (
                    <Button
                      type="link"
                      icon={<ReloadOutlined />}
                      onClick={() => void refreshBuckets()}
                    >
                      刷新
                    </Button>
                  ) : null}
                  {activeConn ? (
                    <Button
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={openCreateBucket}
                    >
                      添加
                    </Button>
                  ) : null}
                </div>

                {!activeConn ? (
                  <Empty description="请选择或添加左侧连接" styles={{ image: { height: 64 } }} />
                ) : !buckets.length ? (
                  <Empty
                    description="暂无存储桶，点击添加创建"
                    styles={{ image: { height: 64 } }}
                  />
                ) : (
                  <div className="table-wrap">
                    <Table
                      dataSource={buckets}
                      columns={bucketColumns}
                      bordered
                      size="small"
                      pagination={false}
                      rowKey="name"
                      locale={{ emptyText: '无存储桶' }}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </Spin>

      <OssConnectionDialog
        open={connDialogVisible}
        onOpenChange={setConnDialogVisible}
        connection={editingConn}
        onSave={handleSaveConn}
      />

      <Modal
        open={createBucketVisible}
        title="创建存储桶"
        width={480}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setCreateBucketVisible(false)}
        footer={
          <Button
            type="primary"
            loading={creatingBucket}
            onClick={() => void handleCreateBucket()}
          >
            创建
          </Button>
        }
      >
        <div className="bucket-form">
          <div className="form-item">
            <div className="label">桶名称</div>
            <div className="content">
              <Input
                value={newBucketName}
                placeholder="小写字母、数字、点、连字符"
                onChange={(e) => setNewBucketName(e.target.value)}
                onPressEnter={() => void handleCreateBucket()}
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
