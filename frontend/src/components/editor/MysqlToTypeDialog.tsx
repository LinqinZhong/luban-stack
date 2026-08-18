import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Select, Spin, Table } from 'antd'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import { getMysqlTableColumns } from '../../api/projects'
import {
  createEmptyDataTypeGroup,
  isValidGroupName,
  isValidTypeName,
  type DataTypeDef,
  type DataTypeGroup,
  type DataTypeLibrary,
} from '../../types/data-types'
import type { MysqlConnectionPayload, MysqlTableInfo } from '../../types/mysql'
import {
  mysqlTableToDataType,
  previewMysqlColumnMapping,
  tableNameToTypeName,
} from '../../utils/mysql-to-type'
import './MysqlToTypeDialog.css'

const kindLabel: Record<string, string> = {
  string: '字符串',
  number: '数值',
  boolean: '布尔值',
  any: 'any',
}

export default function MysqlToTypeDialog({
  open,
  onOpenChange,
  connection,
  table,
  typeLibrary,
  projectPath,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  connection: MysqlConnectionPayload | null
  table: MysqlTableInfo | null
  typeLibrary: DataTypeLibrary
  projectPath?: string | null
  onSave?: (library: DataTypeLibrary) => void
}) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    typeName: '',
    groupId: '',
    newGroupName: '',
  })
  const [preview, setPreview] = useState<
    Array<{ column: string; field: string; kind: string; optional: boolean }>
  >([])
  const [pendingDef, setPendingDef] = useState<DataTypeDef | null>(null)

  const groups = typeLibrary.groups

  useEffect(() => {
    if (!open || !table) return
    setForm({
      typeName: tableNameToTypeName(table.name),
      newGroupName: '',
      groupId: groups[0]?.id ?? '',
    })
    setPreview([])
    setPendingDef(null)
    void loadColumns(tableNameToTypeName(table.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, table])

  async function loadColumns(typeName: string) {
    if (!connection || !table) return
    setLoading(true)
    try {
      const result = await getMysqlTableColumns({
        ...connection,
        tableName: table.name,
        projectPath: projectPath || undefined,
      })
      if (result.conflict) {
        ElMessage.warning('表结构与本地不一致，请先在「设计表」中解决冲突')
      }
      const columns = result.columns ?? []
      if (!columns.length) {
        ElMessage.warning('该表没有可转换的列')
        return
      }
      const def = mysqlTableToDataType({
        tableName: table.name,
        tableRemark: table.remark,
        columns,
        typeName,
      })
      setPendingDef(def)
      setPreview(previewMysqlColumnMapping(columns))
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '读取表结构失败')
    } finally {
      setLoading(false)
    }
  }

  function findExisting(
    groupsList: DataTypeGroup[],
    groupId: string,
    typeName: string,
  ): { groupIndex: number; typeIndex: number } | null {
    const gi = groupsList.findIndex((g) => g.id === groupId)
    if (gi < 0) return null
    const ti = groupsList[gi]!.types.findIndex((t) => t.name === typeName)
    if (ti < 0) return null
    return { groupIndex: gi, typeIndex: ti }
  }

  async function handleConfirm() {
    const name = form.typeName.trim()
    if (!isValidTypeName(name)) {
      ElMessage.error('类型名需以字母或下划线开头，仅含字母、数字、下划线')
      return
    }
    if (!pendingDef) {
      ElMessage.warning('请先加载表结构')
      return
    }

    let nextGroups = typeLibrary.groups.map((g) => ({
      ...g,
      types: [...g.types],
    }))

    let groupId = form.groupId
    if (!groupId) {
      const gName = form.newGroupName.trim() || 'mysql'
      if (!isValidGroupName(gName)) {
        ElMessage.error('分组名需为纯英文（字母开头）')
        return
      }
      const existing = nextGroups.find((g) => g.name === gName)
      if (existing) {
        groupId = existing.id
      } else {
        const group = createEmptyDataTypeGroup(gName)
        nextGroups = [...nextGroups, group]
        groupId = group.id
      }
    }

    const def: DataTypeDef = {
      ...pendingDef,
      name,
      remark: pendingDef.remark,
      fields: pendingDef.fields.map((f) => ({ ...f })),
    }

    const hit = findExisting(nextGroups, groupId, name)
    if (hit) {
      try {
        await ElMessageBox.confirm(
          `分组内已存在类型「${name}」，是否覆盖？`,
          '覆盖确认',
          { type: 'warning', confirmButtonText: '覆盖', cancelButtonText: '取消' },
        )
      } catch {
        return
      }
      const group = nextGroups[hit.groupIndex]!
      group.types = group.types.map((t, i) =>
        i === hit.typeIndex ? { ...def, id: t.id } : t,
      )
    } else {
      nextGroups = nextGroups.map((g) =>
        g.id === groupId ? { ...g, types: [...g.types, def] } : g,
      )
    }

    onSave?.({ groups: nextGroups })
    onOpenChange?.(false)
    ElMessage.success(`已生成类型「${name}」`)
  }

  const groupOptions = useMemo(
    () => groups.map((g) => ({ label: g.name, value: g.id })),
    [groups],
  )

  const columns = [
    { title: '列名', dataIndex: 'column', key: 'column', minWidth: 120 },
    { title: '字段名', dataIndex: 'field', key: 'field', minWidth: 120 },
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 100,
      render: (kind: string) => kindLabel[kind] || kind,
    },
    {
      title: '可选',
      dataIndex: 'optional',
      key: 'optional',
      width: 72,
      align: 'center' as const,
      render: (optional: boolean) => (optional ? '是' : '否'),
    },
  ]

  return (
    <Modal
      open={open}
      title={`转成类型 · ${table?.name ?? ''}`}
      width={640}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button
          type="primary"
          disabled={loading || !preview.length}
          onClick={() => void handleConfirm()}
        >
          生成类型
        </Button>
      }
    >
      <Spin spinning={loading}>
        <div className="to-type">
          <Form layout="vertical">
            <Form.Item label="类型名" required>
              <Input
                value={form.typeName}
                placeholder="例如：Goods"
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, typeName: e.target.value }))
                }
              />
            </Form.Item>
            <Form.Item label="目标分组">
              {groups.length ? (
                <Select
                  value={form.groupId || undefined}
                  placeholder="选择分组"
                  style={{ width: '100%' }}
                  options={groupOptions}
                  onChange={(groupId) => setForm((prev) => ({ ...prev, groupId }))}
                />
              ) : (
                <Input
                  value={form.newGroupName}
                  placeholder="将新建分组（默认 mysql）"
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, newGroupName: e.target.value }))
                  }
                />
              )}
            </Form.Item>
          </Form>

          <div className="preview-title">字段映射预览</div>
          <Table
            dataSource={preview}
            columns={columns}
            bordered
            size="small"
            pagination={false}
            rowKey={(row) => `${row.column}-${row.field}`}
            locale={{ emptyText: '暂无列' }}
          />
        </div>
      </Spin>
    </Modal>
  )
}
