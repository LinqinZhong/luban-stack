import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Input,
  InputNumber,
  Modal,
  Switch,
  Tooltip,
} from 'antd'
import {
  CodeOutlined,
  CopyOutlined,
  DesktopOutlined,
  HolderOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import IconValueSelect from './IconValueSelect'
import ColorPicker from './ColorPicker'
import DateTimeValueInput from './DateTimeValueInput'
import ObjectFieldsDialog from './ObjectFieldsDialog'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import ObjectTsCodeEditor from './ObjectTsCodeEditor'
import OssResourcePickerDialog from './OssResourcePickerDialog'
import {
  buildObjectValue,
  defaultValue,
  resolveArrayFields,
  resolveObjectFields,
  type ArraySubField,
  type DataFieldType,
  type DataFieldValue,
  type ObjectSubField,
  type OssBindingConfig,
} from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  isArrayItemTypeLocked,
  objectFieldsFromTypeRef,
  resolveNamedTypeAsField,
} from '../../utils/named-type-fields'
import {
  composeArrayTsCode,
  explainArrayTsParseError,
  getArrayTsCodeError,
  overlaySpecialTypesFromArrayCode,
  parseArrayTsCode,
} from '../../utils/object-ts-code'
import './ArrayFieldsDialog.css'

type EditorMode = 'visual' | 'code'

const CLIPBOARD_MARKER = '__lubanArrayItem'

let sharedClipboard: ArraySubField | null = null

function bumpClipboard(item: ArraySubField | null) {
  sharedClipboard = item
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

interface DraftItem {
  key: string
  type: DataFieldType
  value: DataFieldValue
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  arrayFields: ArraySubField[]
  objectFields: ObjectSubField[]
}

export default function ArrayFieldsDialog({
  open,
  onOpenChange,
  fields,
  iconOptions,
  typeLibrary,
  defaultItemType,
  defaultItemTypeRef,
  defaultNestedItemType,
  defaultNestedItemTypeRef,
  projectPath,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  fields: ArraySubField[]
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  defaultItemType?: DataFieldType
  defaultItemTypeRef?: string
  defaultNestedItemType?: DataFieldType
  defaultNestedItemTypeRef?: string
  projectPath?: string | null
  onSave?: (fields: ArraySubField[]) => void
}) {
  const [draft, setDraft] = useState<DraftItem[]>([])
  const [dragIndex, setDragIndex] = useState(-1)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [objectDialogVisible, setObjectDialogVisible] = useState(false)
  const [objectEditingKey, setObjectEditingKey] = useState('')
  const [nestedDialogVisible, setNestedDialogVisible] = useState(false)
  const [nestedEditingKey, setNestedEditingKey] = useState('')
  const [ossPickerVisible, setOssPickerVisible] = useState(false)
  const [ossEditingKey, setOssEditingKey] = useState('')
  const [mode, setMode] = useState<EditorMode>('visual')
  const [codeText, setCodeText] = useState('const items = [\n  \n]')
  const [codeError, setCodeError] = useState<string | null>(null)

  const itemTypeLocked = isArrayItemTypeLocked(defaultItemType)

  const codeFields = useMemo(
    () => draft.map((item) => toArraySubField(item)),
    [draft],
  )

  const arrayCodeOptions = useMemo(
    () => ({
      typeLibrary,
      constName: 'items' as const,
      itemType: defaultItemType,
      itemTypeRef: defaultItemTypeRef,
    }),
    [typeLibrary, defaultItemType, defaultItemTypeRef],
  )

  useEffect(() => {
    if (!open) {
      window.removeEventListener('keydown', handleGlobalKeydown, true)
      return
    }
    setMode('visual')
    setCodeError(null)
    const next = fields.map((item) => toDraftItem(item))
    const ensured = next.length ? next : [createDraftItem()]
    setDraft(ensured)
    setDragIndex(-1)
    setSelectedIndex(ensured.length ? 0 : -1)
    setObjectEditingKey('')
    setNestedEditingKey('')
    setCodeText(
      composeArrayTsCode(
        ensured.map((item) => toArraySubField(item)),
        'items',
        {
          typeLibrary,
          itemType: defaultItemType,
          itemTypeRef: defaultItemTypeRef,
        },
      ),
    )
    window.addEventListener('keydown', handleGlobalKeydown, true)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function createKey() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  function resolveDefaultItemShape(): {
    type: DataFieldType
    typeRef?: string
    itemType?: DataFieldType
    itemTypeRef?: string
    objectFields: ObjectSubField[]
    arrayFields: ArraySubField[]
    value: DataFieldValue
  } {
    const rawType = defaultItemType || 'string'
    const typeRef = defaultItemTypeRef

    if (typeRef) {
      const resolved = resolveNamedTypeAsField(typeRef, typeLibrary)
      if (resolved.type === 'json' && resolved.typeRef) {
        return {
          type: 'json',
          typeRef: resolved.typeRef,
          objectFields: objectFieldsFromTypeRef(resolved.typeRef, typeLibrary),
          arrayFields: [],
          value: {},
        }
      }
      return {
        type: resolved.type,
        objectFields: [],
        arrayFields: [],
        value: defaultValue(resolved.type),
      }
    }

    if (rawType === 'json') {
      return {
        type: 'json',
        objectFields: [],
        arrayFields: [],
        value: {},
      }
    }

    if (rawType === 'array') {
      return {
        type: 'array',
        itemType: defaultNestedItemType || 'string',
        itemTypeRef: defaultNestedItemTypeRef,
        objectFields: [],
        arrayFields: [],
        value: [],
      }
    }

    if (rawType === 'any') {
      return {
        type: 'string',
        objectFields: [],
        arrayFields: [],
        value: '',
      }
    }

    return {
      type: rawType,
      objectFields: [],
      arrayFields: [],
      value: defaultValue(rawType),
    }
  }

  function hydrateNamedObjectFields(item: {
    type: DataFieldType
    typeRef?: string
    objectFields?: ObjectSubField[]
    value?: DataFieldValue
  }): ObjectSubField[] {
    if (item.type !== 'json' || !item.typeRef) {
      return resolveObjectFields(item.objectFields, item.value)
    }
    return objectFieldsFromTypeRef(
      item.typeRef,
      typeLibrary,
      resolveObjectFields(item.objectFields, item.value),
    )
  }

  function existingObjectFieldsOf(item: ArraySubField): ObjectSubField[] {
    if (item.type === 'json') {
      return resolveObjectFields(item.objectFields, item.value)
    }
    if (
      item.value &&
      typeof item.value === 'object' &&
      !Array.isArray(item.value)
    ) {
      return resolveObjectFields(undefined, item.value)
    }
    return []
  }

  function applyLockedTypeToItem(item: ArraySubField): ArraySubField {
    const shape = resolveDefaultItemShape()
    if (shape.type === 'json') {
      const existing = existingObjectFieldsOf(item)
      if (shape.typeRef) {
        return {
          type: 'json',
          typeRef: shape.typeRef,
          objectFields: objectFieldsFromTypeRef(
            shape.typeRef,
            typeLibrary,
            existing,
          ),
        }
      }
      return {
        type: 'json',
        objectFields: existing,
      }
    }
    if (shape.type === 'array') {
      return {
        type: 'array',
        itemType: item.type === 'array' ? item.itemType : shape.itemType,
        itemTypeRef: item.type === 'array' ? item.itemTypeRef : shape.itemTypeRef,
        arrayFields: item.type === 'array' ? item.arrayFields ?? [] : [],
      }
    }
    if (item.type === shape.type) {
      return {
        type: shape.type,
        value: item.value ?? defaultValue(shape.type),
      }
    }
    return {
      type: shape.type,
      value: defaultValue(shape.type),
    }
  }

  function toDraftItem(item: ArraySubField): DraftItem {
    const source = itemTypeLocked ? applyLockedTypeToItem(item) : item

    if (source.type === 'array') {
      return {
        key: createKey(),
        type: 'array',
        value: [],
        typeRef: source.typeRef,
        itemType: source.itemType,
        itemTypeRef: source.itemTypeRef,
        arrayFields: source.arrayFields ?? [],
        objectFields: [],
      }
    }
    if (source.type === 'json') {
      return {
        key: createKey(),
        type: 'json',
        value: {},
        typeRef: source.typeRef,
        arrayFields: [],
        objectFields: hydrateNamedObjectFields(source),
      }
    }
    return {
      key: createKey(),
      type: source.type,
      typeRef: source.typeRef,
      value: source.value ?? defaultValue(source.type),
      arrayFields: [],
      objectFields: [],
    }
  }

  function createDraftItem(): DraftItem {
    if (itemTypeLocked || defaultItemTypeRef || defaultItemType) {
      const shape = resolveDefaultItemShape()
      return {
        key: createKey(),
        type: shape.type,
        typeRef: shape.typeRef,
        value: shape.value,
        itemType: shape.itemType,
        itemTypeRef: shape.itemTypeRef,
        arrayFields: shape.arrayFields,
        objectFields: shape.objectFields,
      }
    }
    return {
      key: createKey(),
      type: 'string',
      value: '',
      arrayFields: [],
      objectFields: [],
    }
  }

  function toArraySubField(item: DraftItem): ArraySubField {
    if (item.type === 'array') {
      return {
        type: 'array',
        typeRef: item.typeRef,
        itemType: item.itemType,
        itemTypeRef: item.itemTypeRef,
        arrayFields: deepClone(item.arrayFields),
      }
    }
    if (item.type === 'json') {
      return {
        type: 'json',
        typeRef: item.typeRef,
        objectFields: deepClone(item.objectFields),
      }
    }
    return {
      type: item.type,
      typeRef: item.typeRef,
      value: deepClone(item.value),
    }
  }

  function cloneArraySubField(item: ArraySubField): ArraySubField {
    return deepClone(item)
  }

  function findDraftItem(key: string) {
    return draft.find((item) => item.key === key)
  }

  function patchItem(key: string, mut: (item: DraftItem) => void) {
    setDraft((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        const next = { ...item }
        mut(next)
        return next
      }),
    )
  }

  function close() {
    onOpenChange?.(false)
  }

  function addField() {
    setDraft((prev) => {
      const next = [...prev, createDraftItem()]
      setSelectedIndex(next.length - 1)
      return next
    })
  }

  function removeField(index: number) {
    setDraft((prev) => {
      const next = prev.filter((_, i) => i !== index)
      const ensured = next.length ? next : [createDraftItem()]
      setSelectedIndex((sel) =>
        sel >= ensured.length ? ensured.length - 1 : sel,
      )
      return ensured
    })
  }

  function handleTypeChange(item: DraftItem, payload: TypeSelectPayload) {
    const nextType = payload.type
    if (
      itemTypeLocked ||
      payload.cleared ||
      nextType === 'void' ||
      nextType === 'generic'
    ) {
      return
    }
    patchItem(item.key, (row) => {
      row.type = nextType
      row.typeRef = payload.typeRef
      row.value = defaultValue(nextType)
      row.arrayFields = []
      row.objectFields = []
      row.itemType =
        payload.type === 'array'
          ? payload.itemType === 'generic'
            ? 'any'
            : payload.itemType || 'string'
          : undefined
      row.itemTypeRef =
        payload.type === 'array' ? payload.itemTypeRef : undefined
      if (payload.type === 'json' && payload.typeRef) {
        row.objectFields = objectFieldsFromTypeRef(payload.typeRef, typeLibrary)
      }
    })
  }

  function onDragStart(index: number) {
    setDragIndex(index)
    setSelectedIndex(index)
  }

  function onDrop(index: number) {
    if (dragIndex < 0 || dragIndex === index) return
    setDraft((prev) => {
      const items = [...prev]
      const [moved] = items.splice(dragIndex, 1)
      if (!moved) return prev
      items.splice(index, 0, moved)
      return items
    })
    setSelectedIndex(index)
    setDragIndex(-1)
  }

  function openObjectEditor(key: string) {
    const item = findDraftItem(key)
    if (item?.type === 'json' && item.typeRef) {
      patchItem(key, (row) => {
        row.objectFields = objectFieldsFromTypeRef(
          row.typeRef!,
          typeLibrary,
          row.objectFields,
        )
      })
    }
    setObjectEditingKey(key)
    setObjectDialogVisible(true)
  }

  function openNestedArrayEditor(key: string) {
    setNestedEditingKey(key)
    setNestedDialogVisible(true)
  }

  function openOssPicker(key: string) {
    if (!projectPath?.trim()) {
      ElMessage.warning('未打开项目，无法选择对象存储资源')
      return
    }
    setOssEditingKey(key)
    setOssPickerVisible(true)
  }

  function onOssPicked(config: OssBindingConfig) {
    const item = findDraftItem(ossEditingKey)
    if (!item || item.type !== 'resource') return
    patchItem(ossEditingKey, (row) => {
      row.value = (config.url || '').trim()
    })
  }

  function saveObjectFields(nextFields: ObjectSubField[]) {
    const item = findDraftItem(objectEditingKey)
    if (!item) return
    patchItem(objectEditingKey, (row) => {
      row.objectFields = nextFields
    })
  }

  function saveNestedArrayFields(nextFields: ArraySubField[]) {
    const item = findDraftItem(nestedEditingKey)
    if (!item) return
    patchItem(nestedEditingKey, (row) => {
      row.arrayFields = nextFields
    })
  }

  const editingObjectItem = findDraftItem(objectEditingKey)
  const editingObjectFields =
    editingObjectItem?.type === 'json'
      ? editingObjectItem.objectFields ?? []
      : []
  const editingObjectTypeRef =
    editingObjectItem?.typeRef || defaultItemTypeRef || ''
  const editingObjectSchemaLocked = Boolean(editingObjectTypeRef)
  const nestedItem = findDraftItem(nestedEditingKey)
  const editingNestedFields =
    nestedItem?.type === 'array' ? nestedItem.arrayFields ?? [] : []

  function objectContentPreview(item: DraftItem): string {
    const fromFields = item.objectFields?.length
      ? buildObjectValue(item.objectFields)
      : null
    const fromValue =
      item.value && typeof item.value === 'object' && !Array.isArray(item.value)
        ? (item.value as Record<string, unknown>)
        : null
    const obj =
      fromFields && Object.keys(fromFields).length
        ? fromFields
        : (fromValue ?? fromFields ?? {})
    try {
      return JSON.stringify(obj)
    } catch {
      return '{}'
    }
  }

  async function copyField(index: number) {
    const item = draft[index]
    if (!item) return
    setSelectedIndex(index)
    try {
      const payload = toArraySubField(item)
      bumpClipboard(payload)
      try {
        await navigator.clipboard.writeText(
          JSON.stringify({ [CLIPBOARD_MARKER]: true, item: payload }),
        )
      } catch {
        /* ignore */
      }
      ElMessage.success('已复制该项')
    } catch (err) {
      console.error(err)
      ElMessage.error('复制失败')
    }
  }

  async function readClipboardItem(): Promise<ArraySubField | null> {
    if (sharedClipboard) {
      return cloneArraySubField(sharedClipboard)
    }
    try {
      const text = await navigator.clipboard.readText()
      if (text?.trim()) {
        const parsed = JSON.parse(text) as {
          [key: string]: unknown
          item?: ArraySubField
        }
        if (
          parsed?.[CLIPBOARD_MARKER] &&
          parsed.item &&
          typeof parsed.item.type === 'string'
        ) {
          return cloneArraySubField(parsed.item)
        }
      }
    } catch {
      /* ignore */
    }
    return null
  }

  async function pasteField(afterIndex?: number) {
    const item = await readClipboardItem()
    if (!item) {
      ElMessage.warning('剪贴板中没有可粘贴的数组项')
      return
    }
    bumpClipboard(cloneArraySubField(item))
    setDraft((prev) => {
      const insertAt =
        typeof afterIndex === 'number' && afterIndex >= 0
          ? afterIndex + 1
          : selectedIndex >= 0
            ? selectedIndex + 1
            : prev.length
      const next = [...prev]
      next.splice(insertAt, 0, toDraftItem(item))
      setSelectedIndex(insertAt)
      return next
    })
    ElMessage.success('已粘贴项')
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return Boolean(
      target.closest('input, textarea, select, [contenteditable="true"]'),
    )
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (!open) return
    if (mode === 'code') return
    if (objectDialogVisible || nestedDialogVisible) return
    const mod = event.ctrlKey || event.metaKey
    if (!mod) return
    const key = event.key.toLowerCase()
    if (key !== 'c' && key !== 'v') return
    if (isTypingTarget(event.target)) return

    if (key === 'c') {
      if (selectedIndex < 0) return
      event.preventDefault()
      event.stopPropagation()
      void copyField(selectedIndex)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    void pasteField()
  }

  function syncCodeFromVisual() {
    setCodeText(
      composeArrayTsCode(codeFields, 'items', {
        typeLibrary,
        itemType: defaultItemType,
        itemTypeRef: defaultItemTypeRef,
      }),
    )
    setCodeError(null)
  }

  function parseCodeDocument(): ReturnType<typeof parseArrayTsCode> {
    const opts = arrayCodeOptions
    const err = getArrayTsCodeError(codeText, opts)
    if (err) {
      setCodeError(err)
      ElMessage.error(err)
      return null
    }
    const parsed = parseArrayTsCode(codeText, codeFields, opts)
    if (!parsed) {
      const message = explainArrayTsParseError(codeText, opts)
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
    const existing = codeFields

    let merged: ArraySubField[]
    if (itemTypeLocked) {
      const base = parsed.fields.map((item) => applyLockedTypeToItem(item))
      const withValues = resolveArrayFields(base, parsed.value)
      merged = overlaySpecialTypesFromArrayCode(withValues, parsed.fields)
    } else {
      const withValues = resolveArrayFields(existing, parsed.value)
      merged = overlaySpecialTypesFromArrayCode(withValues, parsed.fields)
      if (!merged.length && parsed.fields.length) {
        merged = parsed.fields
      }
    }

    const next = merged.map((item) => toDraftItem(item))
    setDraft(next)
    setDragIndex(-1)
    setSelectedIndex(next.length ? 0 : -1)
    return true
  }

  function switchMode(next: EditorMode) {
    if (next === mode) return
    if (mode === 'code' && next === 'visual') {
      if (codeError) {
        ElMessage.error(codeError)
        return
      }
      if (!applyCodeToVisual()) return
    } else if (mode === 'visual' && next === 'code') {
      syncCodeFromVisual()
    }
    setMode(next)
  }

  function handleSave() {
    if (mode === 'code') {
      if (codeError) {
        ElMessage.error(codeError)
        return
      }
      if (!applyCodeToVisual()) return
    }
    onSave?.(draft.map((item) => toArraySubField(item)))
    close()
  }

  return (
    <Modal
      open={open}
      title="编辑数组字段"
      width={760}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={close}
      footer={
        <Button type="primary" onClick={handleSave}>
          保存
        </Button>
      }
    >
      <div className="dialog-toolbar">
        {mode === 'code' ? (
          <p className="hint">
            只写静态数据；特殊类型用 Color("")；对象用 @common.Message({'{'} ...
            {'}'})；枚举用 @common.ResultCode("OK")。禁止 new 与方法调用。
          </p>
        ) : null}
        <div className="dialog-mode-tabs" role="tablist">
          <Tooltip title="可视化模式">
            <button
              type="button"
              className={`dialog-mode-tab${mode === 'visual' ? ' active' : ''}`}
              role="tab"
              aria-selected={mode === 'visual'}
              onClick={() => switchMode('visual')}
            >
              <DesktopOutlined />
            </button>
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
      </div>

      {mode === 'visual' ? (
        <>
          <div className="field-list">
            {draft.map((item, index) => (
              <div
                key={item.key}
                className={`field-row${dragIndex === index ? ' dragging' : ''}${
                  selectedIndex === index ? ' selected' : ''
                }${itemTypeLocked ? ' no-type' : ''}`}
                onClick={() => setSelectedIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(index)}
              >
                <HolderOutlined
                  className="drag-handle"
                  draggable
                  onDragStart={() => onDragStart(index)}
                  onDragEnd={() => setDragIndex(-1)}
                />
                {!itemTypeLocked ? (
                  <DataFieldTypeTreeSelect
                    type={item.type}
                    typeRef={item.typeRef}
                    itemType={item.itemType}
                    itemTypeRef={item.itemTypeRef}
                    library={typeLibrary}
                    composable
                    onChange={(payload) => handleTypeChange(item, payload)}
                  />
                ) : null}
                <div className="value-cell">
                  {item.type === 'string' || item.type === 'any' ? (
                    <Input
                      value={String(item.value ?? '')}
                      placeholder="数据值"
                      onChange={(e) =>
                        patchItem(item.key, (row) => {
                          row.value = e.target.value
                        })
                      }
                    />
                  ) : item.type === 'number' ? (
                    <InputNumber
                      value={Number(item.value ?? 0)}
                      onChange={(next) =>
                        patchItem(item.key, (row) => {
                          row.value = Number(next ?? 0)
                        })
                      }
                    />
                  ) : item.type === 'boolean' ? (
                    <Switch
                      checked={Boolean(item.value)}
                      onChange={(checked) =>
                        patchItem(item.key, (row) => {
                          row.value = checked
                        })
                      }
                    />
                  ) : item.type === 'time' ||
                    item.type === 'date' ||
                    item.type === 'datetime' ? (
                    <DateTimeValueInput
                      kind={item.type}
                      value={String(item.value ?? '')}
                      onChange={(next) =>
                        patchItem(item.key, (row) => {
                          row.value = next
                        })
                      }
                    />
                  ) : item.type === 'icon' ? (
                    <IconValueSelect
                      value={String(item.value ?? '')}
                      options={iconOptions}
                      onChange={(next) =>
                        patchItem(item.key, (row) => {
                          row.value = next
                        })
                      }
                    />
                  ) : item.type === 'color' ? (
                    <ColorPicker
                      value={String(item.value ?? '')}
                      placeholder="#409eff / rgba(...)"
                      onChange={(next) =>
                        patchItem(item.key, (row) => {
                          row.value = next
                        })
                      }
                    />
                  ) : item.type === 'resource' ? (
                    <div className="resource-value">
                      <Input
                        value={String(item.value ?? '')}
                        allowClear
                        placeholder="资源地址"
                        onChange={(e) =>
                          patchItem(item.key, (row) => {
                            row.value = e.target.value
                          })
                        }
                      />
                      <Button
                        type="link"
                        onClick={(e) => {
                          e.stopPropagation()
                          openOssPicker(item.key)
                        }}
                      >
                        对象存储
                      </Button>
                    </div>
                  ) : item.type === 'json' ? (
                    <div className="complex-value object-value">
                      <div
                        className="object-preview"
                        title={objectContentPreview(item)}
                      >
                        <code className="object-preview-json">
                          {objectContentPreview(item)}
                        </code>
                      </div>
                      <Button
                        type="link"
                        onClick={(e) => {
                          e.stopPropagation()
                          openObjectEditor(item.key)
                        }}
                      >
                        编辑
                      </Button>
                    </div>
                  ) : (
                    <div className="complex-value">
                      <span className="value-preview">
                        {item.arrayFields.length} 项
                      </span>
                      <Button
                        type="link"
                        onClick={(e) => {
                          e.stopPropagation()
                          openNestedArrayEditor(item.key)
                        }}
                      >
                        编辑
                      </Button>
                    </div>
                  )}
                </div>
                <div className="row-actions">
                  <Button
                    type="link"
                    onClick={(e) => {
                      e.stopPropagation()
                      void copyField(index)
                    }}
                  >
                    复制
                  </Button>
                  <Button
                    type="link"
                    danger
                    onClick={(e) => {
                      e.stopPropagation()
                      removeField(index)
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="list-actions">
            <Button type="link" icon={<PlusOutlined />} onClick={addField}>
              添加项
            </Button>
            <Button
              type="link"
              icon={<CopyOutlined />}
              onClick={() => void pasteField()}
            >
              粘贴项
            </Button>
          </div>
        </>
      ) : (
        <div className="code-panel">
          <ObjectTsCodeEditor
            value={codeText}
            onChange={setCodeText}
            kind="array"
            arrayFields={codeFields}
            constName="items"
            typesLocked={itemTypeLocked}
            itemTypeRef={defaultItemTypeRef}
            typeLibrary={typeLibrary}
            iconOptions={iconOptions}
            minHeight={320}
            onErrorChange={setCodeError}
          />
        </div>
      )}

      <ObjectFieldsDialog
        open={objectDialogVisible}
        onOpenChange={setObjectDialogVisible}
        fields={editingObjectFields}
        iconOptions={iconOptions}
        typeLibrary={typeLibrary}
        typeRef={editingObjectTypeRef}
        schemaLocked={editingObjectSchemaLocked}
        projectPath={projectPath}
        onSave={saveObjectFields}
      />
      <ArrayFieldsDialog
        open={nestedDialogVisible}
        onOpenChange={setNestedDialogVisible}
        fields={editingNestedFields}
        iconOptions={iconOptions}
        typeLibrary={typeLibrary}
        defaultItemType={nestedItem?.itemType}
        defaultItemTypeRef={nestedItem?.itemTypeRef}
        projectPath={projectPath}
        onSave={saveNestedArrayFields}
      />
      <OssResourcePickerDialog
        open={ossPickerVisible}
        onOpenChange={setOssPickerVisible}
        projectPath={projectPath}
        onConfirm={onOssPicked}
      />
    </Modal>
  )
}
