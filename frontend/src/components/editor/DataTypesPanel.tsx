import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Cascader, Dropdown, Empty, Input, Table } from 'antd'
import type { DefaultOptionType } from 'antd/es/cascader'
import { PlusOutlined } from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import TypeConfigDialog from './TypeConfigDialog'
import TypeTsEditDialog from './TypeTsEditDialog'
import {
  COMMON_GROUP_NAME,
  createEmptyDataType,
  createEmptyDataTypeGroup,
  DATA_TYPE_CATEGORY_OPTIONS,
  DATA_TYPE_TABLE_KIND_OPTIONS,
  isSystemCommonType,
  isReservedCommonTypeName,
  isValidGroupName,
  isValidTypeName,
  kindNeedsConfig,
  type DataTypeCategory,
  type DataTypeDef,
  type DataTypeGroup,
  type DataTypeKind,
  type DataTypeLibrary,
} from '../../types/data-types'
import './DataTypesPanel.css'

const KIND_CATEGORY_CASCADER_OPTIONS: DefaultOptionType[] =
  DATA_TYPE_TABLE_KIND_OPTIONS.map((opt) => {
  if (opt.value !== 'interface') {
    return { value: opt.value, label: opt.label }
  }
  return {
    value: opt.value,
    label: opt.label,
    children: DATA_TYPE_CATEGORY_OPTIONS.map((c) => ({
      value: c.value,
      label: c.label,
    })),
  }
})

function kindCategoryPath(row: DataTypeDef): string[] {
  if (row.kind === 'interface') {
    return ['interface', row.category ?? 'other']
  }
  return [row.kind]
}

function isSystemCommonGroup(group: DataTypeGroup | null | undefined): boolean {
  if (!group) return false
  return group.name === COMMON_GROUP_NAME || group.id === 'group_common'
}

export default function DataTypesPanel({
  library,
  onLibraryChange,
}: {
  library: DataTypeLibrary
  onLibraryChange?: (library: DataTypeLibrary) => void
}) {
  const groups = library.groups

  function setGroups(value: DataTypeGroup[]) {
    onLibraryChange?.({ groups: value })
  }

  const [activeGroupId, setActiveGroupId] = useState('')
  const [configVisible, setConfigVisible] = useState(false)
  const [tsEditVisible, setTsEditVisible] = useState(false)
  const [editingTypeIndex, setEditingTypeIndex] = useState(-1)
  const [tsEditingTypeIndex, setTsEditingTypeIndex] = useState(-1)

  useEffect(() => {
    if (!groups.length) {
      setActiveGroupId('')
      return
    }
    if (!groups.some((g) => g.id === activeGroupId)) {
      setActiveGroupId(groups[0]!.id)
    }
  }, [groups, activeGroupId])

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  )

  const isCommonActive = isSystemCommonGroup(activeGroup)

  function isPresetTypeRow(row: DataTypeDef): boolean {
    return isSystemCommonType(row)
  }

  const activeTypes = activeGroup?.types ?? []

  const namedOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = []
    for (const group of groups) {
      for (const t of group.types) {
        if (!t.name.trim()) continue
        options.push({
          id: t.id,
          label: `${t.name}（${group.name}）`,
        })
      }
    }
    return options
  }, [groups])

  const editingType =
    !activeGroup || editingTypeIndex < 0
      ? null
      : (activeGroup.types[editingTypeIndex] ?? null)

  const tsEditingType =
    !activeGroup || tsEditingTypeIndex < 0
      ? null
      : (activeGroup.types[tsEditingTypeIndex] ?? null)

  const editingTypeReadonly = isSystemCommonType(editingType)
  const tsEditingTypeReadonly = isSystemCommonType(tsEditingType)

  function updateActiveGroup(patch: Partial<DataTypeGroup>) {
    if (!activeGroup) return
    setGroups(
      groups.map((g) => (g.id === activeGroup.id ? { ...g, ...patch } : g)),
    )
  }

  function updateType(index: number, patch: Partial<DataTypeDef>) {
    if (!activeGroup) return
    const current = activeGroup.types[index]
    if (!current || isSystemCommonType(current)) return
    if (patch.name != null && isReservedCommonTypeName(String(patch.name))) {
      ElMessage.warning('不能使用系统预设类型名')
      return
    }
    const types = activeGroup.types.map((t, i) =>
      i === index ? { ...t, ...patch } : t,
    )
    updateActiveGroup({ types })
  }

  function addGroup() {
    void promptAddGroup()
  }

  async function promptAddGroup() {
    let name = ''
    try {
      const result = await ElMessageBox.prompt(
        '分组名仅允许纯英文（字母开头），将保存为 types/{名称}.json',
        '添加分组',
        {
          confirmButtonText: '添加',
          cancelButtonText: '取消',
          inputPlaceholder: '如 Goods',
          inputPattern: /^[A-Za-z][A-Za-z0-9_]*$/,
          inputErrorMessage: '仅允许纯英文：字母开头，字母/数字/下划线',
        },
      )
      name = String(result.value ?? '').trim()
    } catch {
      return
    }
    if (!isValidGroupName(name)) {
      ElMessage.error('分组名不合法')
      return
    }
    if (groups.some((g) => g.name === name)) {
      ElMessage.error(`分组「${name}」已存在`)
      return
    }
    if (name === COMMON_GROUP_NAME) {
      ElMessage.error('common 为系统保留分组名')
      return
    }
    const group = createEmptyDataTypeGroup(name)
    setGroups([...groups, group])
    setActiveGroupId(group.id)
  }

  async function removeGroup(group: DataTypeGroup) {
    if (group.name === COMMON_GROUP_NAME) {
      ElMessage.warning('系统分组 common 不可删除')
      return
    }
    try {
      await ElMessageBox.confirm(
        `确定删除分组「${group.name}」及其下全部类型吗？对应文件 types/${group.name}.json 将一并删除。`,
        '删除分组',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    setGroups(groups.filter((g) => g.id !== group.id))
  }

  async function promptRenameGroup(group: DataTypeGroup) {
    if (group.name === COMMON_GROUP_NAME) {
      ElMessage.warning('系统分组 common 不可重命名')
      return
    }
    let name = group.name
    try {
      const result = await ElMessageBox.prompt('请输入分组名（纯英文）', '重命名分组', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: group.name,
        inputPlaceholder: '如 Goods',
        inputPattern: /^[A-Za-z][A-Za-z0-9_]*$/,
        inputErrorMessage: '仅允许纯英文：字母开头，字母/数字/下划线',
      })
      name = String(result.value ?? '').trim()
    } catch {
      return
    }
    if (!isValidGroupName(name)) {
      ElMessage.error('分组名不合法')
      return
    }
    if (groups.some((g) => g.id !== group.id && g.name === name)) {
      ElMessage.error(`分组「${name}」已存在`)
      return
    }
    setGroups(groups.map((g) => (g.id === group.id ? { ...g, name } : g)))
  }

  type GroupMenuCommand = 'rename' | 'delete'

  function handleGroupMenuCommand(command: GroupMenuCommand, group: DataTypeGroup) {
    if (isSystemCommonGroup(group)) {
      ElMessage.warning('系统分组 common 不可修改')
      return
    }
    if (command === 'rename') void promptRenameGroup(group)
    else if (command === 'delete') void removeGroup(group)
  }

  function addType() {
    if (!activeGroup) {
      ElMessage.warning('请先创建分组')
      return
    }
    void promptAddType()
  }

  async function promptAddType() {
    if (!activeGroup) return
    let name = ''
    try {
      const result = await ElMessageBox.prompt('请输入类型名', '添加类型', {
        confirmButtonText: '添加',
        cancelButtonText: '取消',
        inputPlaceholder: '如 GoodsItem',
        inputPattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
        inputErrorMessage: '需以字母或下划线开头，仅含字母数字下划线',
      })
      name = String(result.value ?? '').trim()
    } catch {
      return
    }
    if (!name || !isValidTypeName(name)) {
      ElMessage.error('类型名不合法')
      return
    }
    if (isReservedCommonTypeName(name)) {
      ElMessage.error(`「${name}」为系统预设类型名，不可占用`)
      return
    }
    const exists = groups.some((g) => g.types.some((t) => t.name === name))
    if (exists) {
      ElMessage.error(`类型名「${name}」已存在`)
      return
    }
    const next = createEmptyDataType('interface')
    next.name = name
    updateActiveGroup({ types: [...activeGroup.types, next] })
  }

  async function removeType(index: number) {
    if (!activeGroup) return
    const t = activeGroup.types[index]
    if (!t) return
    if (isSystemCommonType(t)) {
      ElMessage.warning('系统预设类型不可删除')
      return
    }
    try {
      await ElMessageBox.confirm(
        `确定删除类型「${t.name || '未命名'}」吗？`,
        '删除类型',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    updateActiveGroup({
      types: activeGroup.types.filter((_, i) => i !== index),
    })
  }

  function handleKindChange(index: number, path: string[] | null | undefined) {
    if (!path?.length) return
    const kind = path[0] as DataTypeKind
    const category: DataTypeCategory =
      kind === 'interface'
        ? ((path[1] as DataTypeCategory | undefined) ?? 'other')
        : 'other'
    updateType(index, {
      kind,
      category,
      ...(category !== 'entity' ? { tableName: '' } : {}),
    })
    if (kindNeedsConfig(kind)) {
      openConfig(index)
    }
  }

  function openConfig(index: number) {
    const t = activeTypes[index]
    if (!t || !kindNeedsConfig(t.kind)) return
    if (t.name.trim() && !isValidTypeName(t.name.trim())) {
      ElMessage.warning('请先填写合法的类型名（字母/下划线开头）')
      return
    }
    setEditingTypeIndex(index)
    setConfigVisible(true)
  }

  function saveConfig(def: DataTypeDef) {
    if (editingTypeIndex < 0) return
    updateType(editingTypeIndex, def)
    setEditingTypeIndex(-1)
  }

  function openTsEdit(index: number) {
    const t = activeTypes[index]
    if (!t) return
    if (!t.name.trim()) {
      ElMessage.warning('请先填写类型名')
      return
    }
    if (!isValidTypeName(t.name.trim())) {
      ElMessage.warning('类型名需以字母或下划线开头')
      return
    }
    setTsEditingTypeIndex(index)
    setTsEditVisible(true)
  }

  function saveTsEdit(def: DataTypeDef) {
    if (tsEditingTypeIndex < 0) return
    updateType(tsEditingTypeIndex, def)
    setTsEditingTypeIndex(-1)
  }

  function handleNameChange(index: number, name: string) {
    const next = name.trim()
    if (next && !isValidTypeName(next)) {
      ElMessage.warning('类型名需以字母或下划线开头，仅含字母数字下划线')
      return
    }
    if (
      next &&
      groups.some((g) =>
        g.types.some((t, i) => {
          if (t.name !== next) return false
          return !(g.id === activeGroup?.id && i === index)
        }),
      )
    ) {
      ElMessage.warning(`类型名「${next}」已存在`)
      return
    }
    updateType(index, { name: next })
  }

  const namedOptionsForConfig = namedOptions.filter((o) => o.id !== editingType?.id)

  const columns = [
    {
      title: '类型名',
      key: 'name',
      minWidth: 200,
      render: (_: unknown, row: DataTypeDef, index: number) => (
        <div className="type-name-cell">
          <Input
            value={row.name}
            placeholder="如 GoodsItem"
            disabled={isPresetTypeRow(row)}
            onChange={(e) => handleNameChange(index, e.target.value)}
          />
          <Button type="link" size="small" onClick={() => openTsEdit(index)}>
            {isPresetTypeRow(row) ? '查看' : '编辑'}
          </Button>
        </div>
      ),
    },
    {
      title: '数据类型',
      key: 'kind',
      minWidth: 200,
      render: (_: unknown, row: DataTypeDef, index: number) => (
        <Cascader
          value={kindCategoryPath(row)}
          options={KIND_CATEGORY_CASCADER_OPTIONS}
          expandTrigger="hover"
          disabled={isPresetTypeRow(row)}
          style={{ width: '100%' }}
          onChange={(path) => handleKindChange(index, path as string[])}
        />
      ),
    },
    {
      title: '表名',
      key: 'tableName',
      minWidth: 120,
      render: (_: unknown, row: DataTypeDef, index: number) => (
        <Input
          value={row.tableName ?? ''}
          placeholder="可选"
          allowClear
          disabled={
            isPresetTypeRow(row) ||
            row.kind !== 'interface' ||
            row.category !== 'entity'
          }
          onChange={(e) => updateType(index, { tableName: e.target.value })}
        />
      ),
    },
    {
      title: '备注',
      key: 'remark',
      minWidth: 140,
      render: (_: unknown, row: DataTypeDef, index: number) => (
        <Input
          value={row.remark}
          placeholder="备注"
          disabled={isPresetTypeRow(row)}
          onChange={(e) => updateType(index, { remark: e.target.value })}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      align: 'center' as const,
      fixed: 'right' as const,
      render: (_: unknown, row: DataTypeDef, index: number) => (
        <>
          {kindNeedsConfig(row.kind) ? (
            <Button type="link" size="small" onClick={() => openConfig(index)}>
              {isPresetTypeRow(row) ? '查看' : '配置'}
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            danger
            disabled={isPresetTypeRow(row)}
            onClick={() => void removeType(index)}
          >
            删除
          </Button>
        </>
      ),
    },
  ]

  return (
    <div className="data-types">
      <div className="data-types-body">
        <aside className="group-pane">
          <div className="pane-head">
            <span className="pane-title">分组</span>
            <Button type="link" icon={<PlusOutlined />} onClick={addGroup}>
              添加
            </Button>
          </div>
          {!groups.length ? (
            <Empty description="先创建分组" styles={{ image: { height: 56 } }} />
          ) : (
            <ul className="group-list">
              {groups.map((group) => (
                <Dropdown
                  key={group.id}
                  trigger={['contextMenu']}
                  menu={{
                    items: [
                      {
                        key: 'rename',
                        label: '重命名',
                        disabled: isSystemCommonGroup(group),
                      },
                      { type: 'divider' },
                      {
                        key: 'delete',
                        label: '删除',
                        danger: true,
                        disabled: isSystemCommonGroup(group),
                      },
                    ],
                    onClick: ({ key }) =>
                      handleGroupMenuCommand(key as GroupMenuCommand, group),
                  }}
                >
                  <li
                    className={`group-item${group.id === activeGroupId ? ' active' : ''}`}
                    onClick={() => setActiveGroupId(group.id)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <span className="group-name" title={group.name}>
                      {group.name}
                    </span>
                    <span className="group-count">{group.types.length}</span>
                  </li>
                </Dropdown>
              ))}
            </ul>
          )}
        </aside>

        <section className="type-pane">
          <div className="pane-head">
            <span className="pane-title">类型定义</span>
            <Button
              type="link"
              icon={<PlusOutlined />}
              disabled={!activeGroup}
              onClick={addType}
            >
              添加
            </Button>
          </div>

          {!activeGroup ? (
            <Empty description="请选择或创建左侧分组" styles={{ image: { height: 64 } }} />
          ) : (
            <div className="type-table">
              {isCommonActive ? (
                <Alert
                  type="info"
                  showIcon
                  closable={false}
                  className="common-readonly-tip"
                  message="common 中 ResultCode / Result / QueryPageDto / QueryPageVo 为系统预设，不可修改；其余类型可正常编辑"
                />
              ) : null}
              <Table
                dataSource={activeTypes}
                columns={columns}
                bordered
                size="small"
                pagination={false}
                rowKey="id"
                locale={{ emptyText: '该分组暂无类型，点击添加' }}
              />
            </div>
          )}
        </section>
      </div>

      <TypeConfigDialog
        open={configVisible}
        onOpenChange={setConfigVisible}
        typeDef={editingType}
        library={library}
        namedOptions={namedOptionsForConfig}
        readonly={editingTypeReadonly}
        onSave={saveConfig}
      />
      <TypeTsEditDialog
        open={tsEditVisible}
        onOpenChange={setTsEditVisible}
        typeDef={tsEditingType}
        library={library}
        readonly={tsEditingTypeReadonly}
        onSave={saveTsEdit}
      />
    </div>
  )
}
