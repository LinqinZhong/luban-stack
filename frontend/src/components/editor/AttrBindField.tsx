import { useMemo, useState } from 'react'
import { Button, Input, InputNumber, Switch } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type {
  ArraySubField,
  DataField,
  DataFieldType,
  ObjectSubField,
} from '../../types/page-data'
import {
  buildArrayValue,
  buildObjectValue,
  valueToArrayFields,
  valueToObjectFields,
} from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import type { DataTypeLibrary } from '../../types/data-types'
import { unwrapWholeBinding } from '../../utils/binding-expr'
import AttrBindExprDialog, {
  type AttrBindExprKind,
} from './AttrBindExprDialog'
import ColorPicker from './ColorPicker'
import DateTimeValueInput from './DateTimeValueInput'
import IconValueSelect from './IconValueSelect'
import ObjectFieldsDialog from './ObjectFieldsDialog'
import ArrayFieldsDialog from './ArrayFieldsDialog'
import './AttrBindField.css'

export default function AttrBindField({
  value,
  onChange,
  placeholder = '',
  valueType = 'string',
  typeRef,
  itemType,
  itemTypeRef,
  dataFields = [],
  componentProps,
  routeParams,
  pageQueryParams,
  repeatListName,
  iconOptions,
  typeLibrary,
  projectPath,
}: {
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  valueType?: DataFieldType
  typeRef?: string | null
  itemType?: DataFieldType
  itemTypeRef?: string | null
  dataFields?: DataField[]
  componentProps?: ComponentPropDef[] | null
  routeParams?: Record<string, unknown> | null
  pageQueryParams?: PageQueryParamDef[] | null
  repeatListName?: string | null
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  projectPath?: string | null
}) {
  const [dialogVisible, setDialogVisible] = useState(false)
  const [dialogKind, setDialogKind] = useState<AttrBindExprKind>('literal')
  const [objectDialogVisible, setObjectDialogVisible] = useState(false)
  const [arrayDialogVisible, setArrayDialogVisible] = useState(false)
  const [objectFieldsDraft, setObjectFieldsDraft] = useState<ObjectSubField[]>(
    [],
  )
  const [arrayFieldsDraft, setArrayFieldsDraft] = useState<ArraySubField[]>([])

  function commit(next: string) {
    onChange?.(next)
  }

  const bindingExpr = unwrapWholeBinding(String(value ?? ''))
  const isLiteral = bindingExpr == null
  const displayValue = bindingExpr != null ? bindingExpr : String(value ?? '')
  const effectiveType: DataFieldType = valueType || 'string'

  function openDialog() {
    setDialogKind(isLiteral ? 'literal' : 'expression')
    setDialogVisible(true)
  }

  function onValueInput(next: string) {
    if (!isLiteral) return
    commit(next)
  }

  function onNumberUpdate(v: number | null) {
    if (!isLiteral) return
    if (v == null || Number.isNaN(v)) {
      commit('')
      return
    }
    commit(String(v))
  }

  const numberModel = useMemo(() => {
    const raw = String(value ?? '').trim()
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  }, [value])

  const boolModel = useMemo(() => {
    const raw = String(value ?? '').trim().toLowerCase()
    return raw === 'true' || raw === '1'
  }, [value])

  function onBoolUpdate(v: boolean) {
    commit(v ? 'true' : 'false')
  }

  function parseJsonObject(raw: string): Record<string, unknown> {
    const t = raw.trim()
    if (!t) return {}
    try {
      const v = JSON.parse(t) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
    return {}
  }

  function parseJsonArray(raw: string): unknown[] {
    const t = raw.trim()
    if (!t) return []
    try {
      const v = JSON.parse(t) as unknown
      if (Array.isArray(v)) return v
    } catch {
      /* ignore */
    }
    return []
  }

  function openObjectEditor() {
    setObjectFieldsDraft(
      valueToObjectFields(parseJsonObject(String(value ?? ''))),
    )
    setObjectDialogVisible(true)
  }

  function openArrayEditor() {
    setArrayFieldsDraft(valueToArrayFields(parseJsonArray(String(value ?? ''))))
    setArrayDialogVisible(true)
  }

  function onObjectSave(fields: ObjectSubField[]) {
    commit(JSON.stringify(buildObjectValue(fields)))
  }

  function onArraySave(fields: ArraySubField[]) {
    commit(JSON.stringify(buildArrayValue(fields)))
  }

  function complexPreview(): string {
    const raw = String(value ?? '').trim()
    if (!raw) return '空'
    if (effectiveType === 'array') {
      return `${parseJsonArray(raw).length} 项`
    }
    return `${Object.keys(parseJsonObject(raw)).length} 个字段`
  }

  function onDialogSave(serialized: string) {
    commit(serialized)
  }

  return (
    <div className="attr-bind-field">
      {!isLiteral ? (
        <Input
          className="value-input is-binding"
          size="small"
          value={displayValue}
          readOnly
          placeholder={placeholder}
          onClick={openDialog}
        />
      ) : effectiveType === 'color' ? (
        <div className="typed-control">
          <ColorPicker
            compact
            value={value}
            placeholder={placeholder || '选择颜色'}
            onChange={onValueInput}
          />
        </div>
      ) : effectiveType === 'number' ? (
        <InputNumber
          className="typed-control"
          size="small"
          value={numberModel}
          placeholder={placeholder || '数字'}
          onChange={(next) => onNumberUpdate(next)}
        />
      ) : effectiveType === 'boolean' ? (
        <Switch
          className="typed-control typed-switch"
          size="small"
          checked={boolModel}
          onChange={onBoolUpdate}
        />
      ) : effectiveType === 'time' ||
        effectiveType === 'date' ||
        effectiveType === 'datetime' ? (
        <div className="typed-control">
          <DateTimeValueInput
            kind={effectiveType}
            size="small"
            value={value}
            placeholder={placeholder}
            onChange={onValueInput}
          />
        </div>
      ) : effectiveType === 'icon' ? (
        <div className="typed-control">
          <IconValueSelect
            size="small"
            value={value}
            options={iconOptions ?? []}
            allowCreate
            placeholder={placeholder || '选择图标'}
            onChange={onValueInput}
          />
        </div>
      ) : effectiveType === 'json' ||
        effectiveType === 'map' ||
        effectiveType === 'array' ? (
        <div className="complex-control">
          <span className="complex-preview">{complexPreview()}</span>
          <Button
            type="link"
            size="small"
            onClick={() =>
              effectiveType === 'array' ? openArrayEditor() : openObjectEditor()
            }
          >
            编辑
          </Button>
        </div>
      ) : (
        <Input
          className="value-input"
          size="small"
          value={displayValue}
          placeholder={placeholder}
          onChange={(e) => onValueInput(e.target.value)}
        />
      )}

      <Button
        className="edit-btn"
        size="small"
        icon={<EditOutlined />}
        title="编辑绑定"
        onClick={openDialog}
      />

      <AttrBindExprDialog
        open={dialogVisible}
        onOpenChange={setDialogVisible}
        attrValue={value}
        initialKind={dialogKind}
        valueType={effectiveType}
        typeRef={typeRef}
        itemType={itemType}
        itemTypeRef={itemTypeRef}
        dataFields={dataFields}
        componentProps={componentProps}
        routeParams={routeParams}
        pageQueryParams={pageQueryParams}
        repeatListName={repeatListName}
        iconOptions={iconOptions}
        typeLibrary={typeLibrary}
        projectPath={projectPath}
        onSave={onDialogSave}
      />

      <ObjectFieldsDialog
        open={objectDialogVisible}
        onOpenChange={setObjectDialogVisible}
        fields={objectFieldsDraft}
        iconOptions={iconOptions}
        typeLibrary={typeLibrary}
        typeRef={typeRef}
        projectPath={projectPath}
        onSave={onObjectSave}
      />
      <ArrayFieldsDialog
        open={arrayDialogVisible}
        onOpenChange={setArrayDialogVisible}
        fields={arrayFieldsDraft}
        iconOptions={iconOptions}
        typeLibrary={typeLibrary}
        defaultItemType={itemType}
        defaultItemTypeRef={itemTypeRef || undefined}
        projectPath={projectPath}
        onSave={onArraySave}
      />
    </div>
  )
}
