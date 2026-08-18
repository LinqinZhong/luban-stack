import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Pagination, Spin, Table } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  deleteMysqlTableRow,
  insertMysqlTableRow,
  listMysqlTableRows,
  updateMysqlTableRow,
  resolveMysqlTableSchema,
} from '../../api/projects'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlTableInfo,
} from '../../types/mysql'
import { isMysqlResourceColumn } from '../../utils/mysql-common-types'
import type { OssBindingConfig } from '../../types/page-data'
import BackLink from './BackLink'
import OssResourcePickerDialog from './OssResourcePickerDialog'
import MysqlSchemaConflictDialog from './MysqlSchemaConflictDialog'
import './MysqlRowsPanel.css'

export default function MysqlRowsPanel({
  connection,
  table,
  projectPath,
  onBack,
}: {
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo
  projectPath?: string | null
  onBack?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [columns, setColumns] = useState<MysqlColumnDef[]>([])
  const [keyColumns, setKeyColumns] = useState<string[]>([])
  const [keyName, setKeyName] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const [formVisible, setFormVisible] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('edit')
  const [formTitle, setFormTitle] = useState('编辑行')
  const [editingKey, setEditingKey] = useState<Record<string, unknown> | null>(
    null,
  )
  const [editForm, setEditForm] = useState<Record<string, string>>({})

  const [ossPickerVisible, setOssPickerVisible] = useState(false)
  const [ossPickerColumn, setOssPickerColumn] = useState('')
  const [conflictVisible, setConflictVisible] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [conflictLocal, setConflictLocal] = useState<MysqlColumnDef[]>([])
  const [conflictRemote, setConflictRemote] = useState<MysqlColumnDef[]>([])

  const canMutate = keyColumns.length > 0
  const keyColumnSet = useMemo(() => new Set(keyColumns), [keyColumns])
  const autoIncrementSet = useMemo(
    () => new Set(columns.filter((c) => c.autoIncrement).map((c) => c.name)),
    [columns],
  )

  function formatCell(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  function cellInputType(col: MysqlColumnDef): string {
    const t = col.type.toLowerCase()
    if (t.includes('text') || t.includes('json') || t.includes('blob'))
      return 'textarea'
    return 'text'
  }

  function pickKey(row: Record<string, unknown>): Record<string, unknown> {
    const key: Record<string, unknown> = {}
    for (const col of keyColumns) {
      key[col] = row[col] ?? null
    }
    return key
  }

  function toEditString(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }
    return String(value)
  }

  function parseEditValue(col: MysqlColumnDef, raw: string): unknown {
    const text = raw
    if (text === '' && (col.nullable || col.autoIncrement)) return null
    const t = col.type.toLowerCase()
    if (t.startsWith('tinyint(1)') || t === 'boolean' || t === 'bool') {
      if (text === 'true' || text === '1') return 1
      if (text === 'false' || text === '0') return 0
    }
    if (
      t.includes('int') ||
      t.includes('decimal') ||
      t.includes('float') ||
      t.includes('double') ||
      t.includes('numeric')
    ) {
      if (text.trim() === '') return col.nullable || col.autoIncrement ? null : 0
      const n = Number(text)
      if (!Number.isFinite(n)) throw new Error(`列「${col.name}」不是合法数字`)
      return n
    }
    if (t.includes('json')) {
      if (text.trim() === '') return null
      return JSON.parse(text)
    }
    return text
  }

  function resetForm(cols: MysqlColumnDef[]) {
    const next: Record<string, string> = {}
    for (const col of cols) {
      next[col.name] = col.autoIncrement ? '' : toEditString(col.defaultValue)
    }
    setEditForm(next)
  }

  async function loadRows(page = current, size = pageSize) {
    if (!connection || !table?.name) return
    setLoading(true)
    try {
      const result = await listMysqlTableRows({
        ...connection,
        tableName: table.name,
        current: page,
        pageSize: size,
        projectPath: projectPath || undefined,
      })
      setColumns(result.columns)
      setKeyColumns(result.keyColumns)
      setKeyName(result.keyName)
      setRows(result.rows)
      setTotal(result.total)
      setCurrent(result.current)
      setPageSize(result.pageSize)
      if (result.conflict && result.local) {
        setConflictLocal(result.local)
        setConflictRemote(result.remote)
        setConflictVisible(true)
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleConflictAdopt(side: 'local' | 'remote') {
    if (!connection || !table?.name || !projectPath) {
      ElMessage.error('缺少项目路径，无法解决冲突')
      return
    }
    setResolving(true)
    try {
      await resolveMysqlTableSchema({
        ...connection,
        tableName: table.name,
        projectPath,
        adopt: side,
      })
      setConflictVisible(false)
      ElMessage.success(
        side === 'local'
          ? '已采用本地结构并推送到数据库'
          : '已采用数据库结构并写入本地',
      )
      await loadRows()
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '解决冲突失败')
    } finally {
      setResolving(false)
    }
  }

  function openCreate() {
    setFormMode('create')
    setFormTitle('添加行')
    setEditingKey(null)
    resetForm(columns)
    setFormVisible(true)
  }

  function openEdit(row: Record<string, unknown>) {
    setFormMode('edit')
    setFormTitle('编辑行')
    setEditingKey(pickKey(row))
    const next: Record<string, string> = {}
    for (const col of columns) {
      next[col.name] = toEditString(row[col.name])
    }
    setEditForm(next)
    setFormVisible(true)
  }

  function openCopy(row: Record<string, unknown>) {
    setFormMode('create')
    setFormTitle('复制行')
    setEditingKey(null)
    const next: Record<string, string> = {}
    for (const col of columns) {
      if (col.autoIncrement || keyColumnSet.has(col.name)) {
        next[col.name] = ''
        continue
      }
      next[col.name] = toEditString(row[col.name])
    }
    setEditForm(next)
    setFormVisible(true)
  }

  function isFieldDisabled(col: MysqlColumnDef): boolean {
    if (formMode === 'edit') return keyColumnSet.has(col.name)
    return col.autoIncrement
  }

  function openOssPickerForColumn(col: MysqlColumnDef) {
    if (isFieldDisabled(col)) return
    setOssPickerColumn(col.name)
    setOssPickerVisible(true)
  }

  function onOssPicked(config: OssBindingConfig) {
    const col = ossPickerColumn
    if (!col) return
    setEditForm((prev) => ({ ...prev, [col]: config.url }))
  }

  async function saveForm() {
    if (!connection || !table?.name) return
    const values: Record<string, unknown> = {}
    try {
      for (const col of columns) {
        if (formMode === 'edit' && keyColumnSet.has(col.name)) continue
        if (formMode === 'create' && autoIncrementSet.has(col.name)) {
          const raw = (editForm[col.name] ?? '').trim()
          if (!raw) continue
        }
        values[col.name] = parseEditValue(col, editForm[col.name] ?? '')
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '字段格式错误')
      return
    }

    setSaving(true)
    try {
      if (formMode === 'create') {
        await insertMysqlTableRow({
          ...connection,
          tableName: table.name,
          values,
        })
        ElMessage.success('已添加')
        setCurrent(1)
        setFormVisible(false)
        await loadRows(1, pageSize)
      } else {
        if (!editingKey) return
        await updateMysqlTableRow({
          ...connection,
          tableName: table.name,
          key: editingKey,
          values,
        })
        ElMessage.success('已保存')
        setFormVisible(false)
        await loadRows()
      }
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function removeRow(row: Record<string, unknown>) {
    if (!connection || !table?.name) return
    const key = pickKey(row)
    const label = keyColumns.map((c) => `${c}=${formatCell(key[c])}`).join(', ')
    try {
      await ElMessageBox.confirm(`确定删除该行吗？\n${label}`, '删除行', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    setLoading(true)
    try {
      await deleteMysqlTableRow({
        ...connection,
        tableName: table.name,
        key,
      })
      ElMessage.success('已删除')
      let page = current
      if (rows.length <= 1 && current > 1) {
        page = current - 1
        setCurrent(page)
      }
      await loadRows(page, pageSize)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setLoading(false)
    }
  }

  function onPageChange(page: number, size: number) {
    if (size !== pageSize) {
      setPageSize(size)
      setCurrent(1)
      void loadRows(1, size)
      return
    }
    setCurrent(page)
    void loadRows(page, size)
  }

  useEffect(() => {
    setColumns([])
    setKeyColumns([])
    setKeyName(null)
    setRows([])
    setTotal(0)
    setCurrent(1)
    setPageSize(20)
    setFormVisible(false)
    void loadRows(1, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.name, connection?.database])

  const tableColumns = [
    ...columns.map((col) => ({
      title: (
        <span>
          {col.name}
          {keyColumnSet.has(col.name) ? <span className="key-tag">键</span> : null}
          {isMysqlResourceColumn(col) ? (
            <span className="resource-tag">资源</span>
          ) : null}
        </span>
      ),
      dataIndex: col.name,
      key: col.name,
      minWidth: 120,
      ellipsis: true,
      render: (_: unknown, row: Record<string, unknown>) =>
        formatCell(row[col.name]),
    })),
    {
      title: '操作',
      key: 'actions',
      width: canMutate ? 160 : 80,
      fixed: 'right' as const,
      render: (_: unknown, row: Record<string, unknown>) => (
        <>
          <Button type="link" onClick={() => openCopy(row)}>
            复制
          </Button>
          {canMutate ? (
            <>
              <Button type="link" onClick={() => openEdit(row)}>
                编辑
              </Button>
              <Button type="link" danger onClick={() => void removeRow(row)}>
                删除
              </Button>
            </>
          ) : null}
        </>
      ),
    },
  ]

  return (
    <div className="rows-panel">
      <Spin spinning={loading} wrapperClassName="rows-spin">
        <div className="pane-head">
          <BackLink onClick={() => onBack?.()} />
          <span className="pane-title">数据表 / {table.name}</span>
          <span className="pane-sub">
            {canMutate ? (
              <>
                唯一键：{keyName === 'PRIMARY' ? '主键' : keyName}（
                {keyColumns.join(', ')}）
              </>
            ) : (
              '未设计唯一键，仅可浏览与添加'
            )}
          </span>
          <Button type="link" icon={<ReloadOutlined />} onClick={() => void loadRows()}>
            刷新
          </Button>
          <Button type="link" icon={<PlusOutlined />} onClick={openCreate}>
            添加
          </Button>
        </div>

        <div className="rows-body">
          <Table
            className="rows-table"
            dataSource={rows}
            columns={tableColumns}
            bordered
            size="small"
            pagination={false}
            scroll={{ x: 'max-content', y: '100%' }}
            locale={{ emptyText: '暂无数据' }}
            rowKey={(row) =>
              keyColumns.length
                ? keyColumns.map((k) => String(row[k] ?? '')).join('\0')
                : String(rows.indexOf(row))
            }
          />

          <div className="rows-pager">
            <Pagination
              showSizeChanger
              showTotal={(t) => `共 ${t} 条`}
              current={current}
              pageSize={pageSize}
              total={total}
              pageSizeOptions={['10', '20', '50', '100']}
              onChange={onPageChange}
            />
          </div>
        </div>
      </Spin>

      <Modal
        open={formVisible}
        title={formTitle}
        width={560}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setFormVisible(false)}
        footer={
          <Button type="primary" loading={saving} onClick={() => void saveForm()}>
            {formMode === 'create' ? '添加' : '保存'}
          </Button>
        }
      >
        <Form labelCol={{ style: { width: 110 } }} className="edit-form">
          {columns.map((col) => (
            <Form.Item key={col.name} label={col.name}>
              {isMysqlResourceColumn(col) ? (
                <div className="resource-field">
                  <Input
                    value={editForm[col.name] ?? ''}
                    disabled={isFieldDisabled(col)}
                    placeholder="资源地址"
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, [col.name]: e.target.value }))
                    }
                  />
                  <Button
                    type="link"
                    disabled={isFieldDisabled(col)}
                    onClick={() => openOssPickerForColumn(col)}
                  >
                    对象存储
                  </Button>
                </div>
              ) : (
                <Input.TextArea
                  value={editForm[col.name] ?? ''}
                  autoSize={
                    cellInputType(col) === 'textarea'
                      ? { minRows: 3, maxRows: 8 }
                      : { minRows: 1, maxRows: 1 }
                  }
                  disabled={isFieldDisabled(col)}
                  placeholder={
                    col.autoIncrement && formMode === 'create'
                      ? `${col.type} · 自增可留空`
                      : col.type
                  }
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, [col.name]: e.target.value }))
                  }
                />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <OssResourcePickerDialog
        open={ossPickerVisible}
        onOpenChange={setOssPickerVisible}
        projectPath={projectPath}
        onConfirm={onOssPicked}
      />
      <MysqlSchemaConflictDialog
        open={conflictVisible}
        onOpenChange={setConflictVisible}
        tableName={table.name}
        local={conflictLocal}
        remote={conflictRemote}
        resolving={resolving}
        onAdopt={(side) => void handleConflictAdopt(side)}
      />
    </div>
  )
}
