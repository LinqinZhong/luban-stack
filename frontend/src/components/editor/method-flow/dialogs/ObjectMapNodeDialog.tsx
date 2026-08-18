import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Input, Modal, Select } from 'antd'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import {
  leafNamedRefFromPayload,
  methodTypeToDataField,
  flowDraftToTypeExpr,
  type FlowTypeSelectPayload,
} from '../../../../utils/flow-type-select'
import {
  buildAutoFieldMappings,
  filterObjectAmbientVars,
  listInterfaceFieldNames,
  mergeSavedFieldMappings,
  readFieldMappings,
  resolveObjectFieldNames,
  type ObjectMapFieldMapping,
} from '../../../../utils/object-map-flow'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect'
import FlowPrintField from '../FlowPrintField'
import './ObjectMapNodeDialog.css'

export type ObjectMapNodeForm = {
  sourcePath: string
  targetTypeRef: string
  targetGenericArgs: Record<string, string>
  targetVarName: string
  fieldMappings: ObjectMapFieldMapping[]
  description: string
  printExpr: string
}

const EMPTY_FORM: ObjectMapNodeForm = {
  sourcePath: '',
  targetTypeRef: '',
  targetGenericArgs: {},
  targetVarName: '',
  fieldMappings: [],
  description: '',
  printExpr: '',
}

export default function ObjectMapNodeDialog({
  open,
  onOpenChange,
  form,
  ambientVars,
  typeLibrary,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: ObjectMapNodeForm
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
  onSave?: (form: ObjectMapNodeForm) => void
}) {
  const [draft, setDraft] = useState<ObjectMapNodeForm>({ ...EMPTY_FORM })
  const prevSyncKeyRef = useRef('')

  const sourceVars = useMemo(
    () => filterObjectAmbientVars(ambientVars, typeLibrary),
    [ambientVars, typeLibrary],
  )

  const sourceVar = useMemo(
    () =>
      sourceVars.find((v) => v.name === draft.sourcePath.trim()) ?? null,
    [sourceVars, draft.sourcePath],
  )

  const sourceFieldOptions = useMemo(() => {
    if (!sourceVar?.typeExpr) return []
    return resolveObjectFieldNames(sourceVar.typeExpr, typeLibrary)
  }, [sourceVar, typeLibrary])

  const targetFieldRows = useMemo(() => {
    const ref = draft.targetTypeRef.trim()
    if (!ref) return []
    return listInterfaceFieldNames(ref, typeLibrary)
  }, [draft.targetTypeRef, typeLibrary])

  const treeType = methodTypeToDataField(
    'object',
    draft.targetTypeRef || undefined,
  )

  const targetTypeExpr = useMemo(() => {
    const typeRef = draft.targetTypeRef.trim()
    if (!typeRef) return null
    return flowDraftToTypeExpr({
      type: 'object',
      typeRef,
      genericArgs: draft.targetGenericArgs,
    })
  }, [draft.targetTypeRef, draft.targetGenericArgs])

  const targetTypeTs = targetTypeExpr
    ? processorTypeExprToTs(targetTypeExpr, typeLibrary)
    : ''

  function varLabel(v: MethodParam): string {
    const ts = processorTypeExprToTs(v.typeExpr, typeLibrary)
    return ts ? `${v.name} · ${ts}` : v.name
  }

  function handleTargetTypeChange(payload: FlowTypeSelectPayload) {
    if (payload.type === 'void') return
    const typeRef = leafNamedRefFromPayload(payload)
    setDraft((d) => ({
      ...d,
      targetTypeRef: typeRef,
      targetGenericArgs: typeRef ? d.targetGenericArgs : {},
    }))
  }

  function syncFieldMappings(
    current: ObjectMapNodeForm,
    preserveSaved = false,
  ): ObjectMapFieldMapping[] {
    const targetFields = (() => {
      const ref = current.targetTypeRef.trim()
      if (!ref) return []
      return listInterfaceFieldNames(ref, typeLibrary)
    })()
    const srcVar =
      sourceVars.find((v) => v.name === current.sourcePath.trim()) ?? null
    const sourceFields = srcVar?.typeExpr
      ? resolveObjectFieldNames(srcVar.typeExpr, typeLibrary)
      : []
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
    const next: ObjectMapNodeForm = {
      ...form,
      targetGenericArgs: { ...(form.targetGenericArgs ?? {}) },
      fieldMappings: readFieldMappings(form.fieldMappings).map((m) => ({
        ...m,
      })),
    }
    next.fieldMappings = syncFieldMappings(next, true)
    prevSyncKeyRef.current = `${next.sourcePath}|${next.targetTypeRef}`
    setDraft(next)
  }, [open, form])

  useEffect(() => {
    if (!open) return
    setDraft((d) => {
      const key = `${d.sourcePath}|${d.targetTypeRef}`
      if (key === prevSyncKeyRef.current) return d
      prevSyncKeyRef.current = key
      return { ...d, fieldMappings: syncFieldMappings(d, false) }
    })
  }, [draft.sourcePath, draft.targetTypeRef, open])

  const sourceError = draft.sourcePath.trim() ? '' : '请选择源对象变量'

  const targetTypeError = draft.targetTypeRef.trim()
    ? ''
    : '请选择目标接口类型'

  const targetVarError = useMemo(() => {
    const name = draft.targetVarName.trim()
    if (!name) return '请填写变量名'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return '变量名须为合法标识符'
    }
    return ''
  }, [draft.targetVarName])

  function handleSave() {
    if (sourceError || targetTypeError || targetVarError) {
      return
    }
    onSave?.({
      sourcePath: draft.sourcePath.trim(),
      targetTypeRef: draft.targetTypeRef.trim(),
      targetGenericArgs: { ...(draft.targetGenericArgs ?? {}) },
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
      title="编辑对象映射节点"
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
            Boolean(targetVarError)
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
        <Form.Item
          label="源对象"
          required
          validateStatus={sourceError ? 'error' : undefined}
          help={sourceError || undefined}
        >
          <Select
            value={draft.sourcePath || undefined}
            showSearch
            allowClear
            placeholder="选择对象变量"
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
              暂无接口类型对象变量，请先定义或输入对象数据
            </p>
          ) : null}
        </Form.Item>

        <Form.Item
          label="目标类型"
          required
          validateStatus={targetTypeError ? 'error' : undefined}
          help={targetTypeError || undefined}
        >
          <div className="type-row">
            <DataFieldTypeTreeSelect
              className="type-select"
              type={treeType}
              typeRef={draft.targetTypeRef || undefined}
              library={typeLibrary}
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
              placeholder="选择目标接口类型"
              onChange={handleTargetTypeChange}
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
            placeholder="写入 scope 的变量名，如 userVo"
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
        ) : draft.targetTypeRef.trim() ? (
          <Form.Item label="字段映射">
            <span className="hint-inline">未能解析目标接口字段</span>
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
