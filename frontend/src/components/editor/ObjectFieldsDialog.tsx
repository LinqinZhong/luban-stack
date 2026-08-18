import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Tooltip,
  Tree,
  type InputRef,
} from 'antd'
import {
  CodeOutlined,
  DeleteOutlined,
  DesktopOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import {
  buildObjectValue,
  createEditorNode,
  defaultValue,
  editorNodeTreeParts,
  editorNodesToObjectFields,
  markEditorNodesSchemaLocked,
  objectFieldsToEditorNodes,
  resolveObjectFields,
  typeCodeLabel,
  type ObjectEditorNode,
  type ObjectSubField,
  type OssBindingConfig,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  objectFieldsFromTypeRef,
  resolveNamedTypeAsField,
} from '../../utils/named-type-fields'
import {
  composeObjectTsCode,
  defaultEnumMemberValue,
  enumMemberOptions,
  explainObjectTsParseError,
  getObjectTsCodeError,
  isNamedEnumTypeRef,
  namedTypeDisplayPath,
  overlaySpecialTypesFromCode,
  parseObjectTsCode,
} from '../../utils/object-ts-code'
import IconValueSelect from './IconValueSelect'
import ColorPicker from './ColorPicker'
import DateTimeValueInput from './DateTimeValueInput'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import ObjectTsCodeEditor from './ObjectTsCodeEditor'
import OssResourcePickerDialog from './OssResourcePickerDialog'
import './ObjectFieldsDialog.css'

type EditorMode = 'visual' | 'code'

interface TreeItem {
  key: string
  title?: React.ReactNode
  children?: TreeItem[]
}

export default function ObjectFieldsDialog({
  open,
  onOpenChange,
  fields,
  iconOptions,
  typeLibrary,
  typeRef,
  schemaLocked = false,
  projectPath,
  readonly = false,
  valueName = 'value',
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  fields: ObjectSubField[]
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  typeRef?: string | null
  schemaLocked?: boolean
  projectPath?: string | null
  readonly?: boolean
  valueName?: string | null
  onSave?: (fields: ObjectSubField[]) => void
}) {
  const rootsRef = useRef<ObjectEditorNode[]>([])
  const [, setTick] = useState(0)
  function bump() {
    setTick((n) => n + 1)
  }

  const [selectedKey, setSelectedKey] = useState('')
  const [mode, setMode] = useState<EditorMode>('visual')
  const [codeText, setCodeText] = useState('const value = {\n  \n}')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<string[]>([])
  const [treeData, setTreeData] = useState<TreeItem[]>([])
  const [ossPickerVisible, setOssPickerVisible] = useState(false)
  const fieldNameInputRef = useRef<InputRef>(null)

  const isSchemaLocked =
    Boolean(schemaLocked) || Boolean(typeRef?.trim()) || Boolean(readonly)

  const codeFields = editorNodesToObjectFields(rootsRef.current)

  function buildTreeItems(nodes: ObjectEditorNode[]): TreeItem[] {
    return nodes.map((node) => ({
      key: node.key,
      children: node.children.length
        ? buildTreeItems(node.children)
        : undefined,
    }))
  }

  function collectExpandableKeys(nodes: ObjectEditorNode[]): string[] {
    const keys: string[] = []
    for (const node of nodes) {
      if (node.children.length) {
        keys.push(node.key)
        keys.push(...collectExpandableKeys(node.children))
      }
    }
    return keys
  }

  function collectExpandableKeysFromTreeItems(items: TreeItem[]): string[] {
    const keys: string[] = []
    for (const item of items) {
      if (item.children?.length) {
        keys.push(item.key)
        keys.push(...collectExpandableKeysFromTreeItems(item.children))
      }
    }
    return keys
  }

  function refreshTreeData(opts?: { expandAll?: boolean }) {
    const prevExpanded = new Set(expandedKeys)
    const prevKnown = new Set(collectExpandableKeysFromTreeItems(treeData))
    const nextTree = buildTreeItems(rootsRef.current)
    setTreeData(nextTree)
    const all = collectExpandableKeys(rootsRef.current)
    if (opts?.expandAll) {
      setExpandedKeys(all)
      bump()
      return
    }
    const next: string[] = []
    for (const key of all) {
      if (prevExpanded.has(key) || !prevKnown.has(key)) next.push(key)
    }
    if (selectedKey && all.includes(selectedKey) && !next.includes(selectedKey)) {
      next.push(selectedKey)
    }
    setExpandedKeys(next)
    bump()
  }

  function expandNamedJsonChildren(
    node: ObjectEditorNode,
    existing?: ObjectSubField[],
  ) {
    const ref = node.typeRef?.trim()
    if (node.type !== 'json' || !ref) return
    const namedFields = objectFieldsFromTypeRef(ref, typeLibrary, existing)
    node.children = objectFieldsToEditorNodes(namedFields)
    markEditorNodesSchemaLocked(node.children)
    node.value = undefined
  }

  function ensureNamedTypeStructure(nodes: ObjectEditorNode[]) {
    for (const node of nodes) {
      if (node.type === 'json' && node.typeRef?.trim()) {
        const existing = node.children.length
          ? editorNodesToObjectFields(node.children)
          : undefined
        expandNamedJsonChildren(node, existing)
        ensureNamedTypeStructure(node.children)
        continue
      }
      if (node.type === 'array') {
        const itemRef = node.itemTypeRef?.trim()
        for (const child of node.children) {
          if (itemRef && (node.itemType === 'json' || child.type === 'json')) {
            child.type = 'json'
            child.typeRef = child.typeRef?.trim() || itemRef
            const existing = child.children.length
              ? editorNodesToObjectFields(child.children)
              : undefined
            expandNamedJsonChildren(child, existing)
            ensureNamedTypeStructure(child.children)
          } else {
            ensureNamedTypeStructure(child.children)
          }
        }
        continue
      }
      if (node.children.length) ensureNamedTypeStructure(node.children)
    }
  }

  function syncCodeFromVisual() {
    const nextFields = editorNodesToObjectFields(rootsRef.current)
    const obj = buildObjectValue(nextFields)
    setCodeText(
      composeObjectTsCode(nextFields, obj, valueName, {
        typeLibrary,
      }),
    )
    setCodeError(null)
  }

  function loadFromFields(nextFields: ObjectSubField[]) {
    const namedRef = typeRef?.trim()
    const incoming = namedRef
      ? objectFieldsFromTypeRef(namedRef, typeLibrary, nextFields)
      : nextFields
    rootsRef.current = objectFieldsToEditorNodes(incoming)
    if (isSchemaLocked) {
      markEditorNodesSchemaLocked(rootsRef.current)
    } else {
      ensureNamedTypeStructure(rootsRef.current)
    }
    setSelectedKey(rootsRef.current[0]?.key ?? '')
    refreshTreeData({ expandAll: true })
    const built = editorNodesToObjectFields(rootsRef.current)
    const obj = buildObjectValue(built)
    setCodeText(
      composeObjectTsCode(built, obj, valueName, { typeLibrary }),
    )
    setCodeError(null)
  }

  useEffect(() => {
    if (!open) return
    setMode('visual')
    setCodeError(null)
    loadFromFields(fields)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function findNode(
    key: string,
    nodes: ObjectEditorNode[] = rootsRef.current,
  ): ObjectEditorNode | null {
    for (const node of nodes) {
      if (node.key === key) return node
      const child = findNode(key, node.children)
      if (child) return child
    }
    return null
  }

  function findParentInfo(
    key: string,
    nodes: ObjectEditorNode[] = rootsRef.current,
    parent: ObjectEditorNode | null = null,
  ): {
    parent: ObjectEditorNode | null
    list: ObjectEditorNode[]
    index: number
  } | null {
    const index = nodes.findIndex((node) => node.key === key)
    if (index >= 0) return { parent, list: nodes, index }
    for (const node of nodes) {
      const found = findParentInfo(key, node.children, node)
      if (found) return found
    }
    return null
  }

  function treeNodeParts(key: string): { name: string; type: string } {
    const node = findNode(key)
    if (!node) return { name: '', type: '' }
    const info = findParentInfo(key)
    const parts = editorNodeTreeParts(node, info?.index ?? 0)
    if (node.typeRef?.trim()) {
      const path = namedTypeDisplayPath(node.typeRef, typeLibrary)
      if (path) return { name: parts.name, type: path }
    }
    return parts
  }

  const selectedNode = selectedKey ? findNode(selectedKey) : null
  const selectedStructureLocked =
    isSchemaLocked || Boolean(selectedNode?.schemaLocked)

  const canAddChild = useMemo(() => {
    if (isSchemaLocked) return false
    const node = selectedNode
    if (!node) return false
    if (node.type === 'array') return true
    if (node.schemaLocked) return false
    if (node.type === 'json') return !node.typeRef?.trim()
    return false
  }, [isSchemaLocked, selectedNode, selectedKey])

  const canRemoveSelected =
    !isSchemaLocked && Boolean(selectedKey) && !selectedNode?.schemaLocked

  const canSave = !readonly && !(mode === 'code' && codeError)
  const canSwitchToVisual = mode !== 'code' || !codeError

  function close() {
    onOpenChange?.(false)
  }

  function focusFieldNameInput() {
    queueMicrotask(() => fieldNameInputRef.current?.focus?.())
  }

  function selectedFieldNameEmpty(): boolean {
    const node = selectedNode
    if (!node || node.isArrayItem || selectedStructureLocked) return false
    return !node.name.trim()
  }

  function findUnnamedField(
    nodes: ObjectEditorNode[] = rootsRef.current,
  ): ObjectEditorNode | null {
    for (const node of nodes) {
      if (!node.isArrayItem && !node.schemaLocked && !node.name.trim()) {
        return node
      }
      const child = findUnnamedField(node.children)
      if (child) return child
    }
    return null
  }

  function ensureFieldNameFilled(opts?: { checkAll?: boolean }): boolean {
    if (opts?.checkAll) {
      const unnamed = findUnnamedField()
      if (!unnamed) return true
      ElMessage.warning('请先填写字段名')
      setSelectedKey(unnamed.key)
      focusFieldNameInput()
      return false
    }
    if (!selectedFieldNameEmpty()) return true
    ElMessage.warning('请先填写字段名')
    return false
  }

  function onTreeNodeClick(key: string) {
    if (key === selectedKey) return
    if (!ensureFieldNameFilled()) return
    setSelectedKey(key)
  }

  function addRootField() {
    if (isSchemaLocked) return
    if (!ensureFieldNameFilled()) return
    const node = createEditorNode(false)
    rootsRef.current.push(node)
    setSelectedKey(node.key)
    refreshTreeData()
    focusFieldNameInput()
  }

  function addChild() {
    if (!canAddChild) return
    if (!ensureFieldNameFilled()) return
    const parent = selectedNode
    if (!parent) return
    if (parent.type === 'array') {
      const child = createEditorNode(true)
      if (parent.itemType) {
        child.type = parent.itemType
        child.typeRef = parent.itemTypeRef
        if (parent.itemType === 'json' && parent.itemTypeRef?.trim()) {
          expandNamedJsonChildren(child)
        } else if (parent.itemType === 'array' || parent.itemType === 'json') {
          child.value = undefined
          child.children = []
        } else {
          child.value = defaultValue(parent.itemType)
        }
      }
      parent.children.push(child)
      setSelectedKey(child.key)
      refreshTreeData()
      return
    }
    if (parent.type === 'json' && !parent.typeRef?.trim()) {
      const child = createEditorNode(false)
      parent.children.push(child)
      setSelectedKey(child.key)
      refreshTreeData()
      focusFieldNameInput()
    }
  }

  function removeSelected() {
    if (!canRemoveSelected) return
    if (!selectedKey) return
    const info = findParentInfo(selectedKey)
    if (!info) return
    info.list.splice(info.index, 1)
    setSelectedKey(
      info.list[Math.max(0, info.index - 1)]?.key ||
        info.parent?.key ||
        rootsRef.current[0]?.key ||
        '',
    )
    refreshTreeData()
  }

  function handleTypeChange(payload: TypeSelectPayload) {
    if (
      selectedStructureLocked ||
      payload.cleared ||
      payload.type === 'void' ||
      payload.type === 'generic'
    ) {
      return
    }
    const node = selectedNode
    if (!node) return
    if (payload.isNull) {
      node.value = null
      node.children = []
      refreshTreeData()
      return
    }

    if (payload.typeRef?.trim()) {
      const resolved = resolveNamedTypeAsField(payload.typeRef, typeLibrary)
      node.type = resolved.type
      node.typeRef = resolved.typeRef || payload.typeRef
      node.children = []
      node.itemType = undefined
      node.itemTypeRef = undefined
      if (resolved.type === 'json' && node.typeRef) {
        expandNamedJsonChildren(node)
        refreshTreeData()
        return
      }
      if (isNamedEnumTypeRef(node.typeRef, typeLibrary)) {
        node.value = defaultEnumMemberValue(node.typeRef, typeLibrary)
      } else {
        node.value = defaultValue(resolved.type)
      }
      refreshTreeData()
      return
    }

    node.type = payload.type
    node.typeRef = undefined
    node.children = []
    node.itemType =
      payload.type === 'array'
        ? payload.itemType === 'generic'
          ? 'any'
          : payload.itemType || 'string'
        : undefined
    node.itemTypeRef =
      payload.type === 'array' ? payload.itemTypeRef || undefined : undefined

    if (payload.type === 'json' || payload.type === 'array') {
      node.value = undefined
      refreshTreeData()
      return
    }
    node.value = defaultValue(payload.type)
    refreshTreeData()
  }

  const selectedEnumOptions = (() => {
    const node = selectedNode
    if (!node?.typeRef?.trim()) return null
    if (!isNamedEnumTypeRef(node.typeRef, typeLibrary)) return null
    return enumMemberOptions(node.typeRef, typeLibrary)
  })()

  const selectedTypeDisplay = (() => {
    const node = selectedNode
    if (!node) return ''
    if (node.value === null) return 'NULL'
    if (node.typeRef?.trim()) {
      return (
        namedTypeDisplayPath(node.typeRef, typeLibrary) ||
        typeCodeLabel(node.type, node.typeRef)
      )
    }
    return typeCodeLabel(node.type, node.typeRef)
  })()

  function parseCodeDocument(): ReturnType<typeof parseObjectTsCode> {
    const err = getObjectTsCodeError(codeText, {
      typeLibrary,
      constName: valueName,
    })
    if (err) {
      setCodeError(err)
      ElMessage.error(err)
      return null
    }
    const existing = editorNodesToObjectFields(rootsRef.current)
    const parsed = parseObjectTsCode(codeText, existing, {
      typeLibrary,
    })
    if (!parsed) {
      const message = explainObjectTsParseError(codeText, {
        typeLibrary,
        constName: valueName,
      })
      setCodeError(message)
      ElMessage.error(message)
      return null
    }
    setCodeError(null)
    return parsed
  }

  function applyCodeToVisual(): boolean {
    const parsed = parseCodeDocument()
    if (!parsed) return false
    const namedRef = typeRef?.trim()
    const prevSelected = selectedKey

    if (namedRef) {
      const base = objectFieldsFromTypeRef(namedRef, typeLibrary, parsed.fields)
      const withValues = resolveObjectFields(base, parsed.value)
      const merged = overlaySpecialTypesFromCode(withValues, parsed.fields)
      rootsRef.current = objectFieldsToEditorNodes(merged)
    } else if (isSchemaLocked) {
      const existing = editorNodesToObjectFields(rootsRef.current)
      const withValues = resolveObjectFields(existing, parsed.value)
      const merged = overlaySpecialTypesFromCode(withValues, parsed.fields)
      rootsRef.current = objectFieldsToEditorNodes(merged)
    } else {
      rootsRef.current = objectFieldsToEditorNodes(parsed.fields)
    }

    if (isSchemaLocked) {
      markEditorNodesSchemaLocked(rootsRef.current)
    } else {
      ensureNamedTypeStructure(rootsRef.current)
    }
    const nextKey =
      (prevSelected && findNode(prevSelected) ? prevSelected : null) ||
      rootsRef.current[0]?.key ||
      ''
    setSelectedKey(nextKey)
    refreshTreeData({ expandAll: true })
    return true
  }

  function switchMode(next: EditorMode) {
    if (next === mode) return
    if (mode === 'visual' && !ensureFieldNameFilled({ checkAll: true })) return
    if (mode === 'code' && next === 'visual') {
      const err = getObjectTsCodeError(codeText, {
        typeLibrary,
        constName: valueName,
      })
      if (err) {
        setCodeError(err)
        ElMessage.error(err)
        return
      }
      if (!applyCodeToVisual()) return
    } else if (mode === 'visual' && next === 'code') {
      syncCodeFromVisual()
    }
    setMode(next)
  }

  function openOssPicker() {
    if (!projectPath?.trim()) {
      ElMessage.warning('未打开项目，无法选择对象存储资源')
      return
    }
    setOssPickerVisible(true)
  }

  function onOssPicked(config: OssBindingConfig) {
    const node = selectedNode
    if (!node || node.type !== 'resource') return
    node.value = (config.url || '').trim()
    bump()
  }

  function handleSave() {
    if (mode === 'visual' && !ensureFieldNameFilled({ checkAll: true })) return
    if (mode === 'code') {
      const err = getObjectTsCodeError(codeText, {
        typeLibrary,
        constName: valueName,
      })
      if (err) {
        setCodeError(err)
        ElMessage.error(err)
        return
      }
      if (!applyCodeToVisual()) return
    }
    onSave?.(editorNodesToObjectFields(rootsRef.current))
    close()
  }

  function patchSelected(mut: (node: ObjectEditorNode) => void) {
    if (!selectedNode) return
    mut(selectedNode)
    bump()
  }

  return (
    <Modal
      open={open}
      title={readonly ? '查看对象' : '编辑对象'}
      width={920}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={close}
      footer={
        readonly ? (
          <Button onClick={close}>关闭</Button>
        ) : (
          <Button type="primary" disabled={!canSave} onClick={handleSave}>
            保存
          </Button>
        )
      }
    >
      <div className="dialog-toolbar">
        {readonly ? (
          <p className="hint">只读查看，无法修改。</p>
        ) : isSchemaLocked ? (
          <p className="hint">字段来自类型定义，请直接编辑各字段的数据值。</p>
        ) : (
          <p className="hint">
            只写静态数据；特殊类型用 Color("")；对象用 @common.GoodsItem({'{'} ...
            {'}'})；枚举用 @common.ResultCode("OK")。禁止 new 与方法调用。
          </p>
        )}
        {!readonly ? (
          <div className="dialog-mode-tabs" role="tablist">
            <Tooltip
              title={
                !canSwitchToVisual && codeError
                  ? `代码有误，无法切换：${codeError}`
                  : '可视化模式'
              }
            >
              <span className="dialog-mode-tab-wrap">
                <button
                  type="button"
                  className={`dialog-mode-tab${mode === 'visual' ? ' active' : ''}${
                    !canSwitchToVisual ? ' disabled' : ''
                  }`}
                  role="tab"
                  aria-selected={mode === 'visual'}
                  disabled={!canSwitchToVisual}
                  onClick={() => switchMode('visual')}
                >
                  <DesktopOutlined />
                </button>
              </span>
            </Tooltip>
            <Tooltip title="代码模式">
              <button
                type="button"
                className={`dialog-mode-tab${mode === 'code' ? ' active' : ''}`}
                role="tab"
                aria-selected={mode === 'code'}
                onClick={() => switchMode('code')}
              >
                <CodeOutlined />
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>

      <div
        className="editor-layout"
        style={{ display: mode === 'visual' ? undefined : 'none' }}
      >
        <div className="tree-panel">
          {!isSchemaLocked ? (
            <div className="tree-toolbar">
              <Button type="link" icon={<PlusOutlined />} onClick={addRootField}>
                添加字段
              </Button>
              <Button
                type="link"
                icon={<PlusOutlined />}
                disabled={!canAddChild}
                onClick={addChild}
              >
                添加子项
              </Button>
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                disabled={!canRemoveSelected}
                onClick={removeSelected}
              >
                删除
              </Button>
            </div>
          ) : null}
          {!treeData.length ? (
            <Empty
              description={
                isSchemaLocked ? '类型暂无字段' : '暂无字段，点击上方添加'
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <Tree
              treeData={treeData}
              selectedKeys={selectedKey ? [selectedKey] : []}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys.map(String))}
              onSelect={(keys) => {
                const key = String(keys[0] ?? '')
                if (key) onTreeNodeClick(key)
              }}
              titleRender={(data) => {
                const parts = treeNodeParts(String(data.key))
                return (
                  <span className="tree-node-label">
                    <span className="tree-node-name">{parts.name}</span>
                    {parts.type ? (
                      <span className="tree-node-type">: {parts.type}</span>
                    ) : null}
                  </span>
                )
              }}
            />
          )}
        </div>

        {selectedNode ? (
          <div className={`props-panel${readonly ? ' is-readonly' : ''}`}>
            <div className="props-title">
              {selectedStructureLocked ? '字段值' : '字段属性'}
            </div>

            {!selectedNode.isArrayItem ? (
              <div className="field-row">
                <label>字段名</label>
                {!selectedStructureLocked ? (
                  <Input
                    ref={fieldNameInputRef}
                    value={selectedNode.name}
                    placeholder="字段名"
                    onChange={(e) =>
                      patchSelected((n) => {
                        n.name = e.target.value
                      })
                    }
                  />
                ) : (
                  <span className="readonly-text">
                    {selectedNode.name || '—'}
                  </span>
                )}
              </div>
            ) : null}

            {!selectedStructureLocked ? (
              <div className="field-row">
                <label>数据类型</label>
                <DataFieldTypeTreeSelect
                  type={selectedNode.type}
                  typeRef={selectedNode.typeRef}
                  itemType={selectedNode.itemType}
                  itemTypeRef={selectedNode.itemTypeRef}
                  library={typeLibrary}
                  dualCategory
                  allowNull
                  allowAny
                  nullSelected={selectedNode.value === null}
                  onChange={handleTypeChange}
                />
              </div>
            ) : (
              <div className="field-row">
                <label>数据类型</label>
                <span className="readonly-text">{selectedTypeDisplay}</span>
              </div>
            )}

            {selectedNode.value === null ? (
              <div className="field-row">
                <label>数据值</label>
                <span className="null-value-hint">null</span>
              </div>
            ) : selectedEnumOptions ? (
              <div className="field-row">
                <label>数据值</label>
                <Select
                  value={String(selectedNode.value ?? '')}
                  showSearch
                  placeholder="选择枚举成员"
                  style={{ width: '100%' }}
                  options={selectedEnumOptions.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                  }))}
                  onChange={(next) =>
                    patchSelected((n) => {
                      n.value = String(next ?? '')
                    })
                  }
                />
              </div>
            ) : selectedNode.type === 'string' || selectedNode.type === 'any' ? (
              <div className="field-row">
                <label>数据值</label>
                <Input
                  value={String(selectedNode.value ?? '')}
                  placeholder="数据值"
                  onChange={(e) =>
                    patchSelected((n) => {
                      n.value = e.target.value
                    })
                  }
                />
              </div>
            ) : selectedNode.type === 'number' ? (
              <div className="field-row">
                <label>数据值</label>
                <InputNumber
                  value={Number(selectedNode.value ?? 0)}
                  onChange={(next) =>
                    patchSelected((n) => {
                      n.value = Number(next ?? 0)
                    })
                  }
                />
              </div>
            ) : selectedNode.type === 'boolean' ? (
              <div className="field-row">
                <label>数据值</label>
                <Switch
                  checked={Boolean(selectedNode.value)}
                  onChange={(checked) =>
                    patchSelected((n) => {
                      n.value = checked
                    })
                  }
                />
              </div>
            ) : selectedNode.type === 'time' ||
              selectedNode.type === 'date' ||
              selectedNode.type === 'datetime' ? (
              <div className="field-row">
                <label>数据值</label>
                <DateTimeValueInput
                  kind={selectedNode.type}
                  value={String(selectedNode.value ?? '')}
                  onChange={(next) =>
                    patchSelected((n) => {
                      n.value = next
                    })
                  }
                />
              </div>
            ) : selectedNode.type === 'icon' ? (
              <div className="field-row">
                <label>数据值</label>
                <IconValueSelect
                  value={String(selectedNode.value ?? '')}
                  options={iconOptions}
                  onChange={(next) =>
                    patchSelected((n) => {
                      n.value = next
                    })
                  }
                />
              </div>
            ) : selectedNode.type === 'color' ? (
              <div className="field-row">
                <label>数据值</label>
                <ColorPicker
                  value={String(selectedNode.value ?? '')}
                  placeholder="#409eff / rgba(...)"
                  onChange={(next) =>
                    patchSelected((n) => {
                      n.value = next
                    })
                  }
                />
              </div>
            ) : selectedNode.type === 'resource' ? (
              <div className="field-row">
                <label>数据值</label>
                <div className="resource-value">
                  <Input
                    value={String(selectedNode.value ?? '')}
                    allowClear
                    placeholder="资源地址"
                    onChange={(e) =>
                      patchSelected((n) => {
                        n.value = e.target.value
                      })
                    }
                  />
                  <Button type="link" onClick={openOssPicker}>
                    对象存储
                  </Button>
                </div>
              </div>
            ) : selectedNode.type === 'json' ? (
              <Alert
                type="info"
                showIcon
                closable={false}
                message={
                  selectedNode.typeRef?.trim()
                    ? '子字段已按类型定义补全，请在左侧编辑各字段值（结构不可增删改）'
                    : '对象类型的子字段请在左侧树中管理'
                }
              />
            ) : (
              <Alert
                type="info"
                showIcon
                closable={false}
                message="数组类型的子项请在左侧树中管理"
              />
            )}
          </div>
        ) : null}
      </div>

      {mode === 'code' ? (
        <div className="code-panel">
          <ObjectTsCodeEditor
            value={codeText}
            onChange={setCodeText}
            fields={codeFields}
            constName={valueName}
            typesLocked={isSchemaLocked}
            typeLibrary={typeLibrary}
            iconOptions={iconOptions}
            minHeight={360}
            readonly={readonly}
            onErrorChange={setCodeError}
          />
        </div>
      ) : null}

      <OssResourcePickerDialog
        open={ossPickerVisible}
        onOpenChange={setOssPickerVisible}
        projectPath={projectPath}
        onConfirm={onOssPicked}
      />
    </Modal>
  )
}
