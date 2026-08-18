import { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Input, Modal, Select, Tabs } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import { createMysqlTable, updateMysqlTableMeta } from '../../api/projects'
import type {
  MysqlColumnDef,
  MysqlConnectionPayload,
  MysqlIndexDef,
  MysqlTableDef,
  MysqlTableInfo,
} from '../../types/mysql'
import { MYSQL_COMMON_TYPE_OPTIONS } from '../../utils/mysql-common-types'
import {
  canSetLogicDelete,
  indexableColumnNames,
  secondaryIndexName,
} from '../../utils/mysql-schema'
import { emitMysqlSchemaChanged } from '../../utils/mysql-schema-events'
import './MysqlTableDialog.css'

function emptyColumn(partial?: Partial<MysqlColumnDef>): MysqlColumnDef {
  return {
    name: '',
    type: 'varchar(255)',
    nullable: true,
    primaryKey: false,
    autoIncrement: false,
    defaultValue: '',
    comment: '',
    resource: false,
    logicDelete: false,
    ...partial,
  }
}

function emptyIndex(partial?: Partial<MysqlIndexDef>): MysqlIndexDef {
  return {
    name: '',
    columns: [],
    remark: '',
    ...partial,
  }
}

function defaultColumns(): MysqlColumnDef[] {
  return [
    emptyColumn({
      name: 'id',
      type: 'bigint',
      nullable: false,
      primaryKey: true,
      autoIncrement: true,
    }),
  ]
}

type FormState = {
  name: string
  remark: string
  columns: MysqlColumnDef[]
  indexes: MysqlIndexDef[]
}

export default function MysqlTableDialog({
  open,
  onOpenChange,
  mode,
  connection,
  table,
  projectPath,
  onSaved,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  mode: 'create' | 'edit'
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo | null
  projectPath?: string | null
  onSaved?: (tables: MysqlTableInfo[]) => void
}) {
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [activeTab, setActiveTab] = useState('columns')
  const [form, setForm] = useState<FormState>({
    name: '',
    remark: '',
    columns: [],
    indexes: [],
  })

  useEffect(() => {
    if (!open) return
    setShowErrors(false)
    setActiveTab('columns')
    if (mode === 'create') {
      setForm({
        name: '',
        remark: '',
        columns: defaultColumns(),
        indexes: [],
      })
      return
    }
    setForm({
      name: table?.name ?? '',
      remark: table?.remark ?? '',
      columns: [],
      indexes: [],
    })
  }, [open, mode, table])

  const columnSelectOptions = useMemo(
    () =>
      indexableColumnNames(form.columns).map((name) => ({
        label: name,
        value: name,
      })),
    [form.columns],
  )

  function pruneIndexes(indexes: MysqlIndexDef[], colName: string): MysqlIndexDef[] {
    const name = colName.trim()
    if (!name) return indexes
    return indexes
      .map((idx) => ({
        ...idx,
        columns: idx.columns.filter((c) => c !== name),
      }))
      .filter((i) => i.columns.length > 0)
  }

  function patchColumn(
    index: number,
    updater: (col: MysqlColumnDef) => MysqlColumnDef,
    pruneName?: string,
  ) {
    setForm((prev) => {
      const columns = prev.columns.map((c, i) => (i === index ? updater({ ...c }) : c))
      const indexes = pruneName ? pruneIndexes(prev.indexes, pruneName) : prev.indexes
      return { ...prev, columns, indexes }
    })
  }

  function onAutoIncrementChange(index: number, checked: boolean) {
    const col = form.columns[index]
    if (!col) return
    patchColumn(
      index,
      (c) => {
        c.autoIncrement = checked
        if (c.autoIncrement) {
          c.primaryKey = true
          c.nullable = false
          c.logicDelete = false
        }
        return c
      },
      checked ? col.name : undefined,
    )
  }

  function onPrimaryKeyChange(index: number, checked: boolean) {
    const col = form.columns[index]
    if (!col) return
    patchColumn(
      index,
      (c) => {
        c.primaryKey = checked
        if (!c.primaryKey) {
          c.autoIncrement = false
        } else {
          c.nullable = false
          c.logicDelete = false
        }
        return c
      },
      checked ? col.name : undefined,
    )
  }

  function onLogicDeleteChange(index: number, checked: boolean) {
    setForm((prev) => {
      const columns = prev.columns.map((c, i) => {
        if (i === index) return { ...c, logicDelete: checked }
        if (checked) return { ...c, logicDelete: false }
        return c
      })
      const col = prev.columns[index]
      const indexes =
        checked && col?.name ? pruneIndexes(prev.indexes, col.name) : prev.indexes
      return { ...prev, columns, indexes }
    })
  }

  function onTypeChange(index: number, type: string) {
    setForm((prev) => {
      const columns = prev.columns.map((c, i) => {
        if (i !== index) return c
        const next = { ...c, type }
        if (next.logicDelete && !canSetLogicDelete(next, prev.indexes)) {
          next.logicDelete = false
        }
        return next
      })
      return { ...prev, columns }
    })
  }

  function onIndexColumnsChange(index: number, columns: string[]) {
    setForm((prev) => ({
      ...prev,
      indexes: prev.indexes.map((idx, i) => {
        if (i !== index) return idx
        const next = { ...idx, columns }
        if (!next.name.trim() && next.columns.length) {
          next.name = secondaryIndexName(next.columns)
        }
        return next
      }),
    }))
  }

  const nameError = showErrors && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.name.trim())

  function columnNameError(col: MysqlColumnDef): boolean {
    if (!showErrors) return false
    return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(col.name.trim())
  }

  function indexNameError(idx: MysqlIndexDef): boolean {
    if (!showErrors) return false
    return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(idx.name.trim())
  }

  function addColumn() {
    setForm((prev) => ({ ...prev, columns: [...prev.columns, emptyColumn()] }))
  }

  function removeColumn(index: number) {
    if (form.columns.length <= 1) {
      ElMessage.warning('至少保留一列')
      return
    }
    setForm((prev) => {
      const removed = prev.columns[index]
      const columns = prev.columns.filter((_, i) => i !== index)
      const indexes = removed?.name
        ? pruneIndexes(prev.indexes, removed.name)
        : prev.indexes
      return { ...prev, columns, indexes }
    })
  }

  function addIndex() {
    setForm((prev) => ({ ...prev, indexes: [...prev.indexes, emptyIndex()] }))
    setActiveTab('indexes')
  }

  function removeIndex(index: number) {
    setForm((prev) => ({
      ...prev,
      indexes: prev.indexes.filter((_, i) => i !== index),
    }))
  }

  function validate(): boolean {
    setShowErrors(true)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(form.name.trim())) {
      ElMessage.error('表名不合法')
      return false
    }
    if (mode !== 'create') return true

    const names = new Set<string>()
    let logicDeleteCount = 0
    for (const col of form.columns) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col.name.trim())) {
        ElMessage.error('存在不合法的列名')
        return false
      }
      if (!col.type.trim()) {
        ElMessage.error('请填写列类型')
        return false
      }
      if (names.has(col.name.trim())) {
        ElMessage.error(`列名重复：${col.name}`)
        return false
      }
      names.add(col.name.trim())
      if (col.logicDelete) {
        logicDeleteCount += 1
        if (!canSetLogicDelete(col, form.indexes)) {
          ElMessage.error(`列「${col.name}」不能设为逻辑删除`)
          return false
        }
      }
    }
    if (logicDeleteCount > 1) {
      ElMessage.error('一张表只能有一列逻辑删除')
      return false
    }

    const indexNames = new Set<string>()
    for (const idx of form.indexes) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(idx.name.trim())) {
        ElMessage.error('存在不合法的索引名')
        setActiveTab('indexes')
        return false
      }
      if (idx.name.trim().toUpperCase() === 'PRIMARY') {
        ElMessage.error('索引名不能为 PRIMARY')
        setActiveTab('indexes')
        return false
      }
      if (indexNames.has(idx.name.trim())) {
        ElMessage.error(`索引名重复：${idx.name}`)
        setActiveTab('indexes')
        return false
      }
      indexNames.add(idx.name.trim())
      if (!idx.columns.length) {
        ElMessage.error(`索引「${idx.name}」请至少选择一列`)
        setActiveTab('indexes')
        return false
      }
      for (const colName of idx.columns) {
        const col = form.columns.find((c) => c.name.trim() === colName)
        if (!col) {
          ElMessage.error(`索引「${idx.name}」引用了不存在的列「${colName}」`)
          setActiveTab('indexes')
          return false
        }
        if (col.primaryKey) {
          ElMessage.error(`索引「${idx.name}」不能包含主键列「${colName}」`)
          setActiveTab('indexes')
          return false
        }
        if (col.logicDelete) {
          ElMessage.error(`索引「${idx.name}」不能包含逻辑删除列「${colName}」`)
          setActiveTab('indexes')
          return false
        }
      }
    }
    return true
  }

  function buildCreateTable(): MysqlTableDef {
    return {
      name: form.name.trim(),
      remark: form.remark.trim(),
      columns: form.columns.map((c) => ({
        name: c.name.trim(),
        type: c.type.trim(),
        nullable: c.nullable,
        primaryKey: c.primaryKey,
        autoIncrement: c.autoIncrement,
        defaultValue: c.defaultValue,
        comment: c.comment,
        resource: Boolean(c.resource),
        logicDelete: Boolean(c.logicDelete),
      })),
      indexes: form.indexes.map((i) => ({
        name: i.name.trim(),
        columns: [...i.columns],
        remark: i.remark.trim(),
      })),
    }
  }

  function close() {
    onOpenChange?.(false)
  }

  async function handleSave() {
    if (!connection) {
      ElMessage.error('缺少数据库连接')
      return
    }
    if (!connection.database.trim()) {
      ElMessage.error('请先在连接配置中填写默认数据库名')
      return
    }
    if (!validate()) return

    setSaving(true)
    try {
      const result =
        mode === 'create'
          ? await createMysqlTable({
              ...connection,
              projectPath: projectPath || undefined,
              table: buildCreateTable(),
            })
          : await updateMysqlTableMeta({
              ...connection,
              projectPath: projectPath || undefined,
              tableName: table?.name ?? form.name.trim(),
              name: form.name.trim(),
              remark: form.remark.trim(),
            })
      ElMessage.success(mode === 'create' ? '已创建数据表' : '已更新数据表')
      if (mode === 'create') {
        emitMysqlSchemaChanged(form.name.trim())
      }
      onSaved?.(result.tables)
      close()
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const dialogTitle =
    mode === 'create' ? '添加数据表' : `编辑表 · ${table?.name ?? ''}`

  const typeOptions = MYSQL_COMMON_TYPE_OPTIONS.map((t) => ({
    label: t.label,
    value: t.value,
  }))

  return (
    <Modal
      open={open}
      title={dialogTitle}
      width={mode === 'create' ? 1080 : 520}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={close}
      footer={
        <Button type="primary" loading={saving} onClick={() => void handleSave()}>
          保存
        </Button>
      }
    >
      <div className="table-form">
        <div className="form-item">
          <div className="label">表名</div>
          <div className="content">
            <Input
              value={form.name}
              placeholder="如 goods_item"
              status={nameError ? 'error' : undefined}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
        </div>
        <div className="form-item">
          <div className="label">备注</div>
          <div className="content">
            <Input
              value={form.remark}
              placeholder="表注释，可选"
              onChange={(e) =>
                setForm((prev) => ({ ...prev, remark: e.target.value }))
              }
            />
          </div>
        </div>

        {mode === 'create' ? (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'columns',
                label: '字段',
                children: (
                  <>
                    <div className="cols-head">
                      <span className="cols-title">初始字段</span>
                      <Button type="link" icon={<PlusOutlined />} onClick={addColumn}>
                        添加列
                      </Button>
                    </div>
                    <div className="cols-table">
                      <div className="cols-row cols-header">
                        <span>列名</span>
                        <span>类型</span>
                        <span>资源</span>
                        <span>逻辑删</span>
                        <span>可空</span>
                        <span>主键</span>
                        <span>自增</span>
                        <span>默认值</span>
                        <span>备注</span>
                        <span />
                      </div>
                      {form.columns.map((col, index) => (
                        <div key={index} className="cols-row">
                          <Input
                            size="small"
                            value={col.name}
                            placeholder="name"
                            status={columnNameError(col) ? 'error' : undefined}
                            onChange={(e) =>
                              patchColumn(index, (c) => {
                                c.name = e.target.value
                                return c
                              })
                            }
                          />
                          <Select
                            size="small"
                            showSearch
                            placeholder="类型"
                            value={col.type}
                            options={typeOptions}
                            style={{ width: '100%' }}
                            onChange={(value) => onTypeChange(index, value)}
                          />
                          <Checkbox
                            checked={col.resource}
                            onChange={(e) =>
                              patchColumn(index, (c) => {
                                c.resource = e.target.checked
                                return c
                              })
                            }
                          />
                          <Checkbox
                            checked={col.logicDelete}
                            disabled={
                              !canSetLogicDelete(col, form.indexes) && !col.logicDelete
                            }
                            onChange={(e) =>
                              onLogicDeleteChange(index, e.target.checked)
                            }
                          />
                          <Checkbox
                            checked={col.nullable}
                            onChange={(e) =>
                              patchColumn(index, (c) => {
                                c.nullable = e.target.checked
                                return c
                              })
                            }
                          />
                          <Checkbox
                            checked={col.primaryKey}
                            onChange={(e) =>
                              onPrimaryKeyChange(index, e.target.checked)
                            }
                          />
                          <Checkbox
                            checked={col.autoIncrement}
                            onChange={(e) =>
                              onAutoIncrementChange(index, e.target.checked)
                            }
                          />
                          <Input
                            size="small"
                            value={col.defaultValue}
                            placeholder="—"
                            onChange={(e) =>
                              patchColumn(index, (c) => {
                                c.defaultValue = e.target.value
                                return c
                              })
                            }
                          />
                          <Input
                            size="small"
                            value={col.comment}
                            placeholder="—"
                            onChange={(e) =>
                              patchColumn(index, (c) => {
                                c.comment = e.target.value
                                return c
                              })
                            }
                          />
                          <Button
                            type="link"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => removeColumn(index)}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ),
              },
              {
                key: 'indexes',
                label: '索引',
                children: (
                  <>
                    <div className="cols-head">
                      <span className="cols-title">索引</span>
                      <Button type="link" icon={<PlusOutlined />} onClick={addIndex}>
                        添加索引
                      </Button>
                    </div>
                    {!form.indexes.length ? (
                      <div className="indexes-empty">
                        暂无索引。可选择多个字段组成联合索引，并自定义名称与备注。
                      </div>
                    ) : (
                      <div className="indexes-table">
                        <div className="indexes-row indexes-header">
                          <span>索引名</span>
                          <span>字段</span>
                          <span>备注</span>
                          <span />
                        </div>
                        {form.indexes.map((idx, index) => (
                          <div key={index} className="indexes-row">
                            <Input
                              size="small"
                              value={idx.name}
                              placeholder="idx_name"
                              status={indexNameError(idx) ? 'error' : undefined}
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  indexes: prev.indexes.map((item, i) =>
                                    i === index
                                      ? { ...item, name: e.target.value }
                                      : item,
                                  ),
                                }))
                              }
                            />
                            <Select
                              size="small"
                              mode="multiple"
                              showSearch
                              maxTagCount="responsive"
                              placeholder="选择字段"
                              value={idx.columns}
                              options={columnSelectOptions}
                              style={{ width: '100%' }}
                              onChange={(value) => onIndexColumnsChange(index, value)}
                            />
                            <Input
                              size="small"
                              value={idx.remark}
                              placeholder="可选"
                              onChange={(e) =>
                                setForm((prev) => ({
                                  ...prev,
                                  indexes: prev.indexes.map((item, i) =>
                                    i === index
                                      ? { ...item, remark: e.target.value }
                                      : item,
                                  ),
                                }))
                              }
                            />
                            <Button
                              type="link"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => removeIndex(index)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ),
              },
            ]}
          />
        ) : null}
      </div>
    </Modal>
  )
}
