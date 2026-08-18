import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Radio, Select } from 'antd'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import {
  leafNamedRefFromPayload,
  methodTypeToDataField,
  type FlowTypeSelectPayload,
} from '../../../../utils/flow-type-select'
import {
  buildAutoFieldMappings,
  buildQueryPageVoTypeExpr,
  filterArrayAmbientVars,
  filterPageAmbientVars,
  listInterfaceFieldNames,
  listPageTypeIds,
  mergeSavedFieldMappings,
  QUERY_PAGE_VO_TYPE_ID,
  readFieldMappings,
  resolveArrayItemFieldNames,
  resolveItemFieldNames,
  resolvePageMapItemTypeRef,
  resolveQueryPageVoGenericName,
  type PageMapFieldMapping,
  type PageMapSourceKind,
} from '../../../../utils/page-map-flow'
import { coarseToProcessorTypeExpr } from '../../../../utils/typed-binding-paths'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect'
import FlowPrintField from '../FlowPrintField'
import TypedBindingCascader from '../TypedBindingCascader'
import './PageMapNodeDialog.css'

export type PageMapNodeForm = {
  sourceKind: PageMapSourceKind
  sourcePath: string
  currentExpr: string
  pageSizeExpr: string
  totalExpr: string
  hasNextExpr: string
  /** 固定为 QueryPageVo */
  targetTypeRef: string
  /** { T: itemTypeId } */
  targetGenericArgs: Record<string, string>
  targetVarName: string
  fieldMappings: PageMapFieldMapping[]
  description: string
  printExpr: string
}

const EMPTY_FORM: PageMapNodeForm = {
  sourceKind: 'page',
  sourcePath: '',
  currentExpr: '',
  pageSizeExpr: '',
  totalExpr: '',
  hasNextExpr: '',
  targetTypeRef: QUERY_PAGE_VO_TYPE_ID,
  targetGenericArgs: {},
  targetVarName: '',
  fieldMappings: [],
  description: '',
  printExpr: '',
}

const numberTargetType = coarseToProcessorTypeExpr('number')
const booleanTargetType = coarseToProcessorTypeExpr('boolean')

export default function PageMapNodeDialog({
  open,
  onOpenChange,
  form,
  ambientVars,
  typeLibrary,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: PageMapNodeForm
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
  onSave?: (form: PageMapNodeForm) => void
}) {
  const [draft, setDraft] = useState<PageMapNodeForm>({ ...EMPTY_FORM })
  const [itemTypeRef, setItemTypeRef] = useState('')
  const prevKindRef = useRef<PageMapSourceKind>('page')
  const prevSyncKeyRef = useRef('')

  const pageVars = useMemo(
    () => filterPageAmbientVars(ambientVars, typeLibrary),
    [ambientVars, typeLibrary],
  )

  const arrayVars = useMemo(
    () => filterArrayAmbientVars(ambientVars),
    [ambientVars],
  )

  const sourceVars = draft.sourceKind === 'array' ? arrayVars : pageVars

  const sourceVar =
    sourceVars.find((v) => v.name === draft.sourcePath.trim()) ?? null

  const targetTypeExpr = useMemo(() => {
    const item = itemTypeRef.trim()
    if (!item) return null
    return buildQueryPageVoTypeExpr(item, typeLibrary)
  }, [itemTypeRef, typeLibrary])

  const sourceFieldOptions = useMemo(() => {
    if (!sourceVar?.typeExpr) return []
    if (draft.sourceKind === 'array') {
      return resolveArrayItemFieldNames(sourceVar.typeExpr, typeLibrary)
    }
    return resolveItemFieldNames(sourceVar.typeExpr, typeLibrary)
  }, [sourceVar, draft.sourceKind, typeLibrary])

  const targetFieldRows = useMemo(() => {
    const item = itemTypeRef.trim()
    if (!item) return []
    return listInterfaceFieldNames(item, typeLibrary)
  }, [itemTypeRef, typeLibrary])

  const excludePageTypeIds = useMemo(
    () => listPageTypeIds(typeLibrary),
    [typeLibrary],
  )

  const treeType = methodTypeToDataField(
    'object',
    itemTypeRef || undefined,
  )

  const targetTypeTs = targetTypeExpr
    ? processorTypeExprToTs(targetTypeExpr, typeLibrary)
    : ''

  function varLabel(v: MethodParam): string {
    const ts = processorTypeExprToTs(v.typeExpr, typeLibrary)
    return ts ? `${v.name} · ${ts}` : v.name
  }

  function applyItemTypeToDraft(
    current: PageMapNodeForm,
    itemRef: string,
  ): PageMapNodeForm {
    const item = itemRef.trim()
    const g = resolveQueryPageVoGenericName(typeLibrary)
    return {
      ...current,
      targetTypeRef: QUERY_PAGE_VO_TYPE_ID,
      targetGenericArgs: item ? { [g]: item } : {},
    }
  }

  function handleItemTypeChange(payload: FlowTypeSelectPayload) {
    if (payload.type === 'void') return
    const item = leafNamedRefFromPayload(payload)
    setItemTypeRef(item)
    setDraft((d) => applyItemTypeToDraft(d, item))
  }

  function syncFieldMappings(
    current: PageMapNodeForm,
    itemRef: string,
    preserveSaved = false,
  ): PageMapFieldMapping[] {
    const item = itemRef.trim()
    const targetFields = item
      ? listInterfaceFieldNames(item, typeLibrary)
      : []
    const vars = current.sourceKind === 'array' ? arrayVars : pageVars
    const srcVar =
      vars.find((v) => v.name === current.sourcePath.trim()) ?? null
    const sourceFields = !srcVar?.typeExpr
      ? []
      : current.sourceKind === 'array'
        ? resolveArrayItemFieldNames(srcVar.typeExpr, typeLibrary)
        : resolveItemFieldNames(srcVar.typeExpr, typeLibrary)
    if (!targetFields.length) return []
    if (preserveSaved) {
      return mergeSavedFieldMappings(
        targetFields,
        sourceFields,
        readFieldMappings(current.fieldMappings),
      )
    }
    return buildAutoFieldMappings(targetFields, sourceFields)
  }

  useEffect(() => {
    if (!open) return
    let next: PageMapNodeForm = {
      ...form,
      sourceKind: form.sourceKind === 'array' ? 'array' : 'page',
      targetGenericArgs: { ...(form.targetGenericArgs ?? {}) },
      fieldMappings: readFieldMappings(form.fieldMappings).map((m) => ({
        ...m,
      })),
    }
    const item = resolvePageMapItemTypeRef(form, typeLibrary)
    setItemTypeRef(item)
    next = applyItemTypeToDraft(next, item)
    next.fieldMappings = syncFieldMappings(next, item, true)
    prevKindRef.current = next.sourceKind
    prevSyncKeyRef.current = `${next.sourceKind}|${next.sourcePath}|${item}`
    setDraft(next)
  }, [open, form])

  useEffect(() => {
    if (!open) return
    setDraft((d) => {
      const key = `${d.sourceKind}|${d.sourcePath}|${itemTypeRef}`
      if (key === prevSyncKeyRef.current) return d
      prevSyncKeyRef.current = key
      return {
        ...d,
        fieldMappings: syncFieldMappings(d, itemTypeRef, false),
      }
    })
  }, [draft.sourceKind, draft.sourcePath, itemTypeRef, open])

  useEffect(() => {
    if (!open) return
    setDraft((d) => {
      if (d.sourceKind === prevKindRef.current) return d
      prevKindRef.current = d.sourceKind
      return { ...d, sourcePath: '' }
    })
  }, [draft.sourceKind, open])

  const sourceError = draft.sourcePath.trim() ? '' : '请选择数据源变量'

  const targetTypeError = itemTypeRef.trim() ? '' : '请选择元素类型 T'

  const targetVarError = useMemo(() => {
    const name = draft.targetVarName.trim()
    if (!name) return '请填写变量名'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return '变量名须为合法标识符'
    }
    return ''
  }, [draft.targetVarName])

  const arrayMetaError = useMemo(() => {
    if (draft.sourceKind !== 'array') return ''
    if (!draft.currentExpr.trim()) return '请填写 current 表达式'
    if (!draft.pageSizeExpr.trim()) return '请填写 pageSize 表达式'
    if (!draft.totalExpr.trim()) return '请填写 total 表达式'
    return ''
  }, [
    draft.sourceKind,
    draft.currentExpr,
    draft.pageSizeExpr,
    draft.totalExpr,
  ])

  function handleSave() {
    if (sourceError || targetTypeError || targetVarError || arrayMetaError) {
      return
    }
    const item = itemTypeRef.trim()
    const g = resolveQueryPageVoGenericName(typeLibrary)
    onSave?.({
      sourceKind: draft.sourceKind,
      sourcePath: draft.sourcePath.trim(),
      currentExpr: draft.currentExpr.trim(),
      pageSizeExpr: draft.pageSizeExpr.trim(),
      totalExpr: draft.totalExpr.trim(),
      hasNextExpr: draft.hasNextExpr.trim(),
      targetTypeRef: QUERY_PAGE_VO_TYPE_ID,
      targetGenericArgs: { [g]: item },
      targetVarName: draft.targetVarName.trim(),
      fieldMappings: draft.fieldMappings
        .map((m) => ({
          targetField: m.targetField.trim(),
          sourceField: m.sourceField.trim(),
        }))
        .filter((m) => m.targetField),
      description: draft.description.trim(),
      printExpr: draft.printExpr.trim(),
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑分页映射节点"
      width={640}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button
          type="primary"
          disabled={
            Boolean(sourceError) ||
            Boolean(targetTypeError) ||
            Boolean(targetVarError) ||
            Boolean(arrayMetaError)
          }
          onClick={handleSave}
        >
          确定
        </Button>
      }
    >
      <Form
        className="flow-node-form"
        labelAlign="right"
        labelCol={{ flex: '120px' }}
        wrapperCol={{ flex: 1 }}
      >
        <Form.Item label="数据源类型" required>
          <Radio.Group
            value={draft.sourceKind}
            onChange={(e) =>
              setDraft((d) => ({ ...d, sourceKind: e.target.value }))
            }
          >
            <Radio value="page">分页</Radio>
            <Radio value="array">[]</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          label="数据源"
          required
          validateStatus={sourceError ? 'error' : undefined}
          help={sourceError || undefined}
        >
          <Select
            value={draft.sourcePath || undefined}
            showSearch
            allowClear
            placeholder={
              draft.sourceKind === 'array' ? '选择数组变量' : '选择分页变量'
            }
            style={{ width: '100%' }}
            options={sourceVars.map((v) => ({
              value: v.name,
              label: varLabel(v),
            }))}
            onChange={(sourcePath) =>
              setDraft((d) => ({ ...d, sourcePath: sourcePath ?? '' }))
            }
          />
          {!sourceVars.length ? (
            <p className="hint">
              {draft.sourceKind === 'array'
                ? '暂无数组类型变量'
                : '暂无分页类型变量，请先定义 QueryPageVo 等分页对象'}
            </p>
          ) : null}
        </Form.Item>

        {draft.sourceKind === 'array' ? (
          <>
            <Form.Item
              label="current"
              required
              validateStatus={
                arrayMetaError === '请填写 current 表达式' ? 'error' : undefined
              }
              help={
                arrayMetaError === '请填写 current 表达式'
                  ? arrayMetaError
                  : undefined
              }
            >
              <TypedBindingCascader
                value={draft.currentExpr}
                onChange={(currentExpr) =>
                  setDraft((d) => ({ ...d, currentExpr }))
                }
                ambientVars={ambientVars}
                targetType={numberTargetType}
                typeLibrary={typeLibrary}
                placeholder="选择 current 变量或字段"
              />
            </Form.Item>
            <Form.Item
              label="pageSize"
              required
              validateStatus={
                arrayMetaError === '请填写 pageSize 表达式'
                  ? 'error'
                  : undefined
              }
              help={
                arrayMetaError === '请填写 pageSize 表达式'
                  ? arrayMetaError
                  : undefined
              }
            >
              <TypedBindingCascader
                value={draft.pageSizeExpr}
                onChange={(pageSizeExpr) =>
                  setDraft((d) => ({ ...d, pageSizeExpr }))
                }
                ambientVars={ambientVars}
                targetType={numberTargetType}
                typeLibrary={typeLibrary}
                placeholder="选择 pageSize 变量或字段"
              />
            </Form.Item>
            <Form.Item
              label="total"
              required
              validateStatus={
                arrayMetaError === '请填写 total 表达式' ? 'error' : undefined
              }
              help={
                arrayMetaError === '请填写 total 表达式'
                  ? arrayMetaError
                  : undefined
              }
            >
              <TypedBindingCascader
                value={draft.totalExpr}
                onChange={(totalExpr) =>
                  setDraft((d) => ({ ...d, totalExpr }))
                }
                ambientVars={ambientVars}
                targetType={numberTargetType}
                typeLibrary={typeLibrary}
                placeholder="选择 total 变量或字段"
              />
            </Form.Item>
            <Form.Item label="hasNext">
              <TypedBindingCascader
                value={draft.hasNextExpr}
                onChange={(hasNextExpr) =>
                  setDraft((d) => ({ ...d, hasNextExpr }))
                }
                ambientVars={ambientVars}
                targetType={booleanTargetType}
                typeLibrary={typeLibrary}
                placeholder="可选；留空则按 current×pageSize < total 计算"
              />
            </Form.Item>
          </>
        ) : null}

        <Form.Item
          label="元素类型 T"
          required
          validateStatus={targetTypeError ? 'error' : undefined}
          help={targetTypeError || undefined}
        >
          <div className="type-row">
            <DataFieldTypeTreeSelect
              className="type-select"
              type={treeType}
              typeRef={itemTypeRef || undefined}
              library={typeLibrary}
              excludeNamedIds={excludePageTypeIds}
              excludeTypes={[
                'string',
                'number',
                'boolean',
                'color',
                'ref',
                'icon',
                'resource',
                'array',
              ]}
              allowRef={false}
              placeholder="选择 records 元素类型 T"
              onChange={handleItemTypeChange}
            />
            {targetTypeTs ? (
              <span className="type-preview" title={targetTypeTs}>
                → {targetTypeTs}
              </span>
            ) : null}
          </div>
        </Form.Item>

        <Form.Item
          label="变量名"
          required
          validateStatus={targetVarError ? 'error' : undefined}
          help={targetVarError || undefined}
        >
          <Input
            value={draft.targetVarName}
            placeholder="写入 scope 的变量名，如 goodsPage"
            maxLength={64}
            onChange={(e) =>
              setDraft((d) => ({ ...d, targetVarName: e.target.value }))
            }
          />
        </Form.Item>

        {targetFieldRows.length ? (
          <Form.Item label="字段映射">
            <div className="mapping-table">
              <div className="mapping-head">
                <span>目标字段</span>
                <span>源字段</span>
              </div>
              {draft.fieldMappings.map((row, index) => (
                <div key={row.targetField} className="mapping-row">
                  <span className="field-name" title={row.targetField}>
                    {row.targetField}
                  </span>
                  <Select
                    value={row.sourceField || undefined}
                    showSearch
                    allowClear
                    placeholder="留空则跳过"
                    style={{ width: '100%' }}
                    options={sourceFieldOptions.map((name) => ({
                      value: name,
                      label: name,
                    }))}
                    onChange={(sourceField) =>
                      setDraft((d) => {
                        const fieldMappings = d.fieldMappings.map((m, i) =>
                          i === index
                            ? { ...m, sourceField: sourceField ?? '' }
                            : m,
                        )
                        return { ...d, fieldMappings }
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <p className="hint">
              同名字段已自动映射，可手动调整；源字段留空则跳过该目标字段
            </p>
          </Form.Item>
        ) : itemTypeRef.trim() ? (
          <Form.Item label="字段映射">
            <span className="hint-inline">未能解析元素类型字段</span>
          </Form.Item>
        ) : null}

        <Form.Item label="说明">
          <Input
            value={draft.description}
            maxLength={80}
            showCount
            placeholder="显示在流程节点上"
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
        </Form.Item>
        <Form.Item label="打印">
          <FlowPrintField
            value={draft.printExpr}
            onChange={(printExpr) => setDraft((d) => ({ ...d, printExpr }))}
            ambientNames={ambientVars.map((v) => v.name).filter(Boolean)}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
