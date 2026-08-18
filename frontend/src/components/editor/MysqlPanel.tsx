import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Empty, Spin, Table } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  dropMysqlTable,
  listMysqlTables,
  truncateMysqlTable,
} from '../../api/projects'
import MysqlConnectionDialog from './MysqlConnectionDialog'
import MysqlDesignDialog from './MysqlDesignDialog'
import MysqlRowsPanel from './MysqlRowsPanel'
import MysqlTableDialog from './MysqlTableDialog'
import MysqlToTypeDialog from './MysqlToTypeDialog'
import {
  createEmptyMysqlDatabase,
  type MysqlConnectionPayload,
  type MysqlDatabaseConfig,
  type MysqlLibrary,
  type MysqlTableInfo,
} from '../../types/mysql'
import type { DataTypeLibrary } from '../../types/data-types'
import './MysqlPanel.css'

export default function MysqlPanel({
  library,
  typeLibrary,
  projectPath,
  onLibraryChange,
  onTypeLibraryChange,
}: {
  library: MysqlLibrary
  typeLibrary: DataTypeLibrary
  projectPath?: string | null
  onLibraryChange?: (library: MysqlLibrary) => void
  onTypeLibraryChange?: (library: DataTypeLibrary) => void
}) {
  const databases = library.databases

  function setDatabases(value: MysqlDatabaseConfig[]) {
    onLibraryChange?.({ databases: value })
  }

  const [activeId, setActiveId] = useState('')
  const [connDialogVisible, setConnDialogVisible] = useState(false)
  const [editingDb, setEditingDb] = useState<MysqlDatabaseConfig | null>(null)

  const [tableDialogVisible, setTableDialogVisible] = useState(false)
  const [tableDialogMode, setTableDialogMode] = useState<'create' | 'edit'>('create')
  const [editingTable, setEditingTable] = useState<MysqlTableInfo | null>(null)
  const [designDialogVisible, setDesignDialogVisible] = useState(false)
  const [designingTable, setDesigningTable] = useState<MysqlTableInfo | null>(null)
  const [toTypeDialogVisible, setToTypeDialogVisible] = useState(false)
  const [toTypeTable, setToTypeTable] = useState<MysqlTableInfo | null>(null)
  const [viewingTable, setViewingTable] = useState<MysqlTableInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!databases.length) {
      setActiveId('')
      setViewingTable(null)
      return
    }
    if (!databases.some((d) => d.id === activeId)) {
      setActiveId(databases[0]!.id)
      setViewingTable(null)
    }
  }, [databases, activeId])

  useEffect(() => {
    setViewingTable(null)
  }, [activeId])

  const activeDb = useMemo(
    () => databases.find((d) => d.id === activeId) ?? null,
    [databases, activeId],
  )

  const tables = activeDb?.tables ?? []

  const connectionPayload = useMemo<MysqlConnectionPayload | null>(() => {
    if (!activeDb) return null
    return {
      host: activeDb.host,
      port: activeDb.port,
      username: activeDb.username,
      password: activeDb.password,
      database: activeDb.database,
      ssh: activeDb.ssh,
    }
  }, [activeDb])

  function patchActiveTables(nextTables: MysqlTableInfo[]) {
    if (!activeDb) return
    setDatabases(
      databases.map((d) =>
        d.id === activeDb.id
          ? { ...d, tables: nextTables, lastTestedAt: Date.now() }
          : d,
      ),
    )
  }

  function openCreateDb() {
    setEditingDb(createEmptyMysqlDatabase(`mysql${databases.length + 1}`))
    setConnDialogVisible(true)
  }

  function openEditDb(db: MysqlDatabaseConfig) {
    setEditingDb(JSON.parse(JSON.stringify(db)) as MysqlDatabaseConfig)
    setConnDialogVisible(true)
  }

  type DbMenuCommand = 'config' | 'delete'

  function handleDbMenuCommand(command: DbMenuCommand, db: MysqlDatabaseConfig) {
    if (command === 'config') openEditDb(db)
    else void removeDb(db)
  }

  async function removeDb(db: MysqlDatabaseConfig) {
    try {
      await ElMessageBox.confirm(`确定删除数据库「${db.name}」吗？`, '删除数据库', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    setDatabases(databases.filter((d) => d.id !== db.id))
  }

  function handleSaveDb(db: MysqlDatabaseConfig) {
    const dup = databases.some((d) => d.name === db.name && d.id !== db.id)
    if (dup) {
      ElMessage.error(`数据库名称「${db.name}」已存在`)
      return
    }
    const idx = databases.findIndex((d) => d.id === db.id)
    if (idx >= 0) {
      setDatabases(databases.map((d) => (d.id === db.id ? db : d)))
    } else {
      setDatabases([...databases, db])
    }
    setActiveId(db.id)
    ElMessage.success('已保存 MySQL 配置')
  }

  function ensureConnection(): MysqlConnectionPayload | null {
    const conn = connectionPayload
    if (!conn) {
      ElMessage.warning('请先选择数据库')
      return null
    }
    if (!conn.database.trim()) {
      ElMessage.warning('请先配置连接并填写默认数据库名')
      openEditDb(activeDb!)
      return null
    }
    return conn
  }

  function openCreateTable() {
    if (!ensureConnection()) return
    setTableDialogMode('create')
    setEditingTable(null)
    setTableDialogVisible(true)
  }

  function openEditTable(row: MysqlTableInfo) {
    if (!ensureConnection()) return
    setTableDialogMode('edit')
    setEditingTable(row)
    setTableDialogVisible(true)
  }

  function openDesignTable(row: MysqlTableInfo) {
    if (!ensureConnection()) return
    setDesigningTable(row)
    setDesignDialogVisible(true)
  }

  function openToType(row: MysqlTableInfo) {
    if (!ensureConnection()) return
    setToTypeTable(row)
    setToTypeDialogVisible(true)
  }

  function openViewTable(row: MysqlTableInfo) {
    if (!ensureConnection()) return
    setViewingTable(row)
  }

  function closeViewTable() {
    setViewingTable(null)
  }

  function handleTypeLibrarySave(nextLibrary: DataTypeLibrary) {
    onTypeLibraryChange?.(nextLibrary)
  }

  function handleTableSaved(nextTables: MysqlTableInfo[]) {
    patchActiveTables(nextTables)
  }

  async function refreshTables() {
    const conn = ensureConnection()
    if (!conn) return
    setBusy(true)
    try {
      const result = await listMysqlTables(conn)
      patchActiveTables(result.tables)
      ElMessage.success(`已刷新，共 ${result.tables.length} 张表`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '刷新失败')
    } finally {
      setBusy(false)
    }
  }

  async function clearTable(row: MysqlTableInfo) {
    const conn = ensureConnection()
    if (!conn) return
    try {
      await ElMessageBox.confirm(
        `确定清空表「${row.name}」的所有数据吗？此操作不可恢复。`,
        '清空表',
        { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    setBusy(true)
    try {
      const result = await truncateMysqlTable({ ...conn, tableName: row.name })
      patchActiveTables(result.tables)
      ElMessage.success(`已清空表「${row.name}」`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '清空失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeTable(row: MysqlTableInfo) {
    const conn = ensureConnection()
    if (!conn) return
    try {
      await ElMessageBox.confirm(
        `确定删除表「${row.name}」吗？此操作不可恢复。`,
        '删除表',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    setBusy(true)
    try {
      const result = await dropMysqlTable({
        ...conn,
        tableName: row.name,
        projectPath: projectPath || undefined,
      })
      patchActiveTables(result.tables)
      ElMessage.success(`已删除表「${row.name}」`)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '删除失败')
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

  const tableColumns = [
    { title: '表名', dataIndex: 'name', key: 'name', minWidth: 160 },
    { title: '引擎', dataIndex: 'engine', key: 'engine', width: 110 },
    {
      title: '行数',
      dataIndex: 'rows',
      key: 'rows',
      width: 100,
      align: 'right' as const,
      render: (value: number | null) => (value == null ? '—' : value),
    },
    { title: '备注', dataIndex: 'remark', key: 'remark', minWidth: 160 },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      fixed: 'right' as const,
      render: (_: unknown, row: MysqlTableInfo) => (
        <>
          <Button type="link" onClick={() => openViewTable(row)}>
            查看
          </Button>
          <Button type="link" onClick={() => openEditTable(row)}>
            编辑
          </Button>
          <Button type="link" onClick={() => openDesignTable(row)}>
            设计
          </Button>
          <Button type="link" onClick={() => openToType(row)}>
            转成类型
          </Button>
          <Button type="link" onClick={() => void clearTable(row)}>
            清空
          </Button>
          <Button type="link" danger onClick={() => void removeTable(row)}>
            删除
          </Button>
        </>
      ),
    },
  ]

  return (
    <div className="mysql-panel">
      <Spin spinning={busy} wrapperClassName="mysql-spin">
        <div className="mysql-body">
          <aside className="db-pane">
            <div className="pane-head">
              <span className="pane-title">连接</span>
              <Button type="link" icon={<PlusOutlined />} onClick={openCreateDb}>
                添加
              </Button>
            </div>
            {!databases.length ? (
              <Empty description="添加 MySQL 数据库连接" styles={{ image: { height: 56 } }} />
            ) : (
              <ul className="db-list">
                {databases.map((db) => (
                  <Dropdown
                    key={db.id}
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        { key: 'config', label: '配置' },
                        { type: 'divider' },
                        { key: 'delete', label: '删除', danger: true },
                      ],
                      onClick: ({ key }) =>
                        handleDbMenuCommand(key as DbMenuCommand, db),
                    }}
                  >
                    <li
                      className={`db-item${db.id === activeId ? ' active' : ''}`}
                      onClick={() => setActiveId(db.id)}
                      onDoubleClick={() => openEditDb(db)}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <div className="db-meta">
                        <div className="db-name">{db.name}</div>
                        <div className="db-sub-row">
                          <div className="db-sub">
                            {db.host}:{db.port}
                            {db.ssh.enabled ? ' · SSH' : ''}
                          </div>
                          <span className="db-count">{db.tables.length}张表</span>
                        </div>
                      </div>
                    </li>
                  </Dropdown>
                ))}
              </ul>
            )}
          </aside>

          <section className="table-pane">
            {viewingTable && connectionPayload ? (
              <MysqlRowsPanel
                connection={connectionPayload}
                table={viewingTable}
                projectPath={projectPath}
                onBack={closeViewTable}
              />
            ) : (
              <>
                <div className="pane-head">
                  <span className="pane-title">数据表</span>
                  {activeDb ? (
                    <span className="pane-sub">
                      最近同步：{formatTime(activeDb.lastTestedAt)}
                    </span>
                  ) : null}
                  {activeDb ? (
                    <Button
                      type="link"
                      icon={<ReloadOutlined />}
                      onClick={() => void refreshTables()}
                    >
                      刷新
                    </Button>
                  ) : null}
                  {activeDb ? (
                    <Button type="link" icon={<PlusOutlined />} onClick={openCreateTable}>
                      添加
                    </Button>
                  ) : null}
                </div>

                {!activeDb ? (
                  <Empty description="请选择或添加左侧连接" styles={{ image: { height: 64 } }} />
                ) : !tables.length ? (
                  <Empty
                    description="暂无数据表，点击添加创建"
                    styles={{ image: { height: 64 } }}
                  />
                ) : (
                  <div className="table-wrap">
                    <Table
                      dataSource={tables}
                      columns={tableColumns}
                      bordered
                      size="small"
                      pagination={false}
                      rowKey="name"
                      locale={{ emptyText: '无数据表' }}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </Spin>

      <MysqlConnectionDialog
        open={connDialogVisible}
        onOpenChange={setConnDialogVisible}
        database={editingDb}
        onSave={handleSaveDb}
      />
      <MysqlTableDialog
        open={tableDialogVisible}
        onOpenChange={setTableDialogVisible}
        mode={tableDialogMode}
        connection={connectionPayload}
        table={editingTable}
        projectPath={projectPath}
        onSaved={handleTableSaved}
      />
      <MysqlDesignDialog
        open={designDialogVisible}
        onOpenChange={setDesignDialogVisible}
        connection={connectionPayload}
        table={designingTable}
        projectPath={projectPath}
        typeLibrary={typeLibrary}
        onSaved={handleTableSaved}
      />
      <MysqlToTypeDialog
        open={toTypeDialogVisible}
        onOpenChange={setToTypeDialogVisible}
        connection={connectionPayload}
        table={toTypeTable}
        typeLibrary={typeLibrary}
        projectPath={projectPath}
        onSave={handleTypeLibrarySave}
      />
    </div>
  )
}
