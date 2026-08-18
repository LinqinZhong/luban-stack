import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal } from 'antd'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { DataFieldType } from '../../../../types/page-data'
import type { MethodParam, MethodReturnType } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import { findDataTypeDef } from '../../../../utils/named-type-fields'
import {
  applyPayloadToGenericArgs,
  dataFieldToMethodParamType,
  FLOW_TYPE_EXCLUDE,
  flowDraftToTypeExpr,
  leafNamedRefFromDraft,
  leafNamedRefFromPayload,
  methodTypeToDataField,
  type FlowTypeSelectPayload,
} from '../../../../utils/flow-type-select'
import DataFieldTypeTreeSelect from '../../DataFieldTypeTreeSelect'
import TsCodeEditor from '../../TsCodeEditor'
import TypeGenericArgsDialog from '../../TypeGenericArgsDialog'
import FlowPrintField from '../FlowPrintField'
import './ActionNodeDialog.css'

export type ActionNodeForm = {
  code: string
  description: string
  printExpr: string
  outputType: MethodReturnType
  outputTypeRef: string
  outputItemType: string
  outputItemTypeRef: string
  outputItemItemType: string
  outputItemItemTypeRef: string
  outputGenericArgs: Record<string, string>
  outputVarName: string
}

const EMPTY_FORM: ActionNodeForm = {
  code: '',
  description: '',
  printExpr: '',
  outputType: 'void',
  outputTypeRef: '',
  outputItemType: '',
  outputItemTypeRef: '',
  outputItemItemType: '',
  outputItemItemTypeRef: '',
  outputGenericArgs: {},
  outputVarName: '',
}

function readGenericArgs(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export default function ActionNodeDialog({
  open,
  onOpenChange,
  form,
  ambientVars,
  ambientExtra,
  ambientHint,
  typeLibrary,
  reservedNames,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: ActionNodeForm
  ambientVars: MethodParam[]
  ambientExtra?: string
  ambientHint: string
  typeLibrary?: DataTypeLibrary | null
  reservedNames: string[]
  onSave?: (form: ActionNodeForm) => void
}) {
  const [draft, setDraft] = useState<ActionNodeForm>({ ...EMPTY_FORM })
  const [genericDialogVisible, setGenericDialogVisible] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft({
      code: form.code ?? '',
      description: form.description ?? '',
      printExpr: form.printExpr ?? '',
      outputType: form.outputType || 'void',
      outputTypeRef: form.outputTypeRef ?? '',
      outputItemType: form.outputItemType ?? '',
      outputItemTypeRef: form.outputItemTypeRef ?? '',
      outputItemItemType: form.outputItemItemType ?? '',
      outputItemItemTypeRef: form.outputItemItemTypeRef ?? '',
      outputGenericArgs: { ...readGenericArgs(form.outputGenericArgs) },
      outputVarName: form.outputVarName ?? '',
    })
  }, [open, form])

  function genericNamesOf(typeRef: string): string[] {
    return (findDataTypeDef(typeLibrary, typeRef)?.generics ?? [])
      .map((g) => g.name.trim())
      .filter(Boolean)
  }

  const treeType = useMemo(
    (): DataFieldType | 'void' =>
      methodTypeToDataField(draft.outputType, draft.outputTypeRef),
    [draft.outputType, draft.outputTypeRef],
  )

  const treeItemType = (draft.outputItemType || undefined) as
    | DataFieldType
    | undefined
  const treeItemItemType = (draft.outputItemItemType || undefined) as
    | DataFieldType
    | undefined

  const leafNamed = useMemo(
    () =>
      leafNamedRefFromDraft({
        type: draft.outputType,
        typeRef: draft.outputTypeRef,
        itemType: draft.outputItemType,
        itemTypeRef: draft.outputItemTypeRef,
        itemItemType: draft.outputItemItemType,
        itemItemTypeRef: draft.outputItemItemTypeRef,
      }),
    [
      draft.outputType,
      draft.outputTypeRef,
      draft.outputItemType,
      draft.outputItemTypeRef,
      draft.outputItemItemType,
      draft.outputItemItemTypeRef,
    ],
  )

  const outputGenericNames = useMemo(
    () => genericNamesOf(leafNamed),
    [leafNamed, typeLibrary],
  )
  const hasOutputGenerics = outputGenericNames.length > 0

  const outputTypeName = useMemo(() => {
    if (!leafNamed) return ''
    return findDataTypeDef(typeLibrary, leafNamed)?.name?.trim() || ''
  }, [leafNamed, typeLibrary])

  const genericTypeOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        const name = t.name.trim()
        if (!name) continue
        opts.push({
          id: t.id,
          label: t.remark ? `${name} · ${t.remark}` : name,
        })
      }
    }
    return opts
  }, [typeLibrary])

  function handleOutputTypeChange(payload: FlowTypeSelectPayload) {
    const prevNamed = leafNamed
    if (payload.type === 'void') {
      setDraft((d) => ({
        ...d,
        outputType: 'void',
        outputTypeRef: '',
        outputItemType: '',
        outputItemTypeRef: '',
        outputItemItemType: '',
        outputItemItemTypeRef: '',
        outputGenericArgs: {},
        outputVarName: '',
      }))
      return
    }

    const methodType = dataFieldToMethodParamType(payload.type)
    const named = leafNamedRefFromPayload(payload)
    const names = genericNamesOf(named)
    setDraft((d) => ({
      ...d,
      outputType: methodType as MethodReturnType,
      outputTypeRef: payload.typeRef ?? '',
      outputItemType: payload.itemType ?? '',
      outputItemTypeRef: payload.itemTypeRef ?? '',
      outputItemItemType: payload.itemItemType ?? '',
      outputItemItemTypeRef: payload.itemItemTypeRef ?? '',
      outputGenericArgs: applyPayloadToGenericArgs(
        payload,
        prevNamed,
        d.outputGenericArgs,
        names,
      ),
    }))
    if (named && names.length && named !== prevNamed) {
      setGenericDialogVisible(true)
    }
  }

  const hasOutput = draft.outputType !== 'void' || Boolean(draft.outputTypeRef)

  const editorReturnType: MethodReturnType = (() => {
    if (draft.outputType === 'void' && !draft.outputTypeRef) return 'void'
    if (draft.outputTypeRef || draft.outputType === 'object') return 'object'
    return draft.outputType || 'void'
  })()

  const editorReturnTypeTs = useMemo(() => {
    if (draft.outputType === 'void' && !draft.outputTypeRef) return ''
    return processorTypeExprToTs(
      flowDraftToTypeExpr({
        type: draft.outputType,
        typeRef: draft.outputTypeRef,
        itemType: draft.outputItemType,
        itemTypeRef: draft.outputItemTypeRef,
        itemItemType: draft.outputItemItemType,
        itemItemTypeRef: draft.outputItemItemTypeRef,
        genericArgs: draft.outputGenericArgs,
      }),
      typeLibrary,
    )
  }, [
    draft.outputType,
    draft.outputTypeRef,
    draft.outputItemType,
    draft.outputItemTypeRef,
    draft.outputItemItemType,
    draft.outputItemItemTypeRef,
    draft.outputGenericArgs,
    typeLibrary,
  ])

  const outputTypeLabel = editorReturnTypeTs

  const varNameError = useMemo(() => {
    if (!hasOutput) return ''
    const name = draft.outputVarName.trim()
    if (!name) return '请填写出参变量名'
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return '变量名须为合法标识符'
    }
    if (reservedNames.includes(name)) {
      return '与方法入参或其他节点变量重名'
    }
    return ''
  }, [hasOutput, draft.outputVarName, reservedNames])

  function openGenerics() {
    if (!hasOutputGenerics) return
    setGenericDialogVisible(true)
  }

  function saveGenericArgs(args: Record<string, string>) {
    setDraft((d) => ({ ...d, outputGenericArgs: { ...args } }))
  }

  function handleSave() {
    if (varNameError) return
    const isVoid = draft.outputType === 'void' && !draft.outputTypeRef
    onSave?.({
      code: draft.code,
      description: draft.description.trim(),
      printExpr: draft.printExpr.trim(),
      outputType: isVoid
        ? 'void'
        : draft.outputTypeRef
          ? 'object'
          : draft.outputType || 'void',
      outputTypeRef: isVoid ? '' : draft.outputTypeRef,
      outputItemType: isVoid ? '' : draft.outputItemType,
      outputItemTypeRef: isVoid ? '' : draft.outputItemTypeRef,
      outputItemItemType: isVoid ? '' : draft.outputItemItemType,
      outputItemItemTypeRef: isVoid ? '' : draft.outputItemItemTypeRef,
      outputGenericArgs: leafNamed ? { ...(draft.outputGenericArgs ?? {}) } : {},
      outputVarName: hasOutput ? draft.outputVarName.trim() : '',
    })
    onOpenChange?.(false)
  }

  function stopEditorKeys(event: React.KeyboardEvent) {
    if (event.key === ' ' || event.key === 'Tab' || event.code === 'Space') {
      event.stopPropagation()
    }
  }

  return (
    <>
      <Modal
        open={open}
        title="编辑操作节点"
        width={720}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        className="action-node-dialog"
        onCancel={() => onOpenChange?.(false)}
        footer={
          <Button
            type="primary"
            disabled={Boolean(varNameError)}
            onClick={handleSave}
          >
            确定
          </Button>
        }
      >
        {ambientHint ? (
          <p className="hint">可访问变量：{ambientHint}</p>
        ) : null}

        <Form
          className="flow-node-form"
          labelAlign="right"
          labelCol={{ flex: '110px' }}
          wrapperCol={{ flex: 1 }}
        >
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
          <Form.Item label="出参类型">
            <div className="type-row">
              <DataFieldTypeTreeSelect
                className="type-select"
                type={treeType}
                typeRef={draft.outputTypeRef || undefined}
                itemType={treeItemType}
                itemTypeRef={draft.outputItemTypeRef || undefined}
                itemItemType={treeItemItemType}
                itemItemTypeRef={draft.outputItemItemTypeRef || undefined}
                library={typeLibrary}
                excludeTypes={FLOW_TYPE_EXCLUDE}
                allowRef={false}
                allowVoid
                clearable
                placeholder="选择出参类型"
                onChange={handleOutputTypeChange}
              />
              {hasOutputGenerics ? (
                <>
                  <Button type="link" onClick={openGenerics}>
                    泛型
                  </Button>
                  <span className="type-preview" title={outputTypeLabel}>
                    {outputTypeLabel}
                  </span>
                </>
              ) : null}
            </div>
          </Form.Item>
          <Form.Item
            label="出参变量名"
            validateStatus={varNameError ? 'error' : undefined}
            help={varNameError || undefined}
          >
            <Input
              value={draft.outputVarName}
              disabled={!hasOutput}
              placeholder={
                hasOutput ? '后续节点可访问该变量' : '出参为 void 时无需填写'
              }
              onChange={(e) =>
                setDraft((d) => ({ ...d, outputVarName: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="代码">
            <div
              className="editor-wrap nokey"
              onKeyDown={stopEditorKeys}
              onKeyUp={stopEditorKeys}
            >
              {open ? (
                <TsCodeEditor
                  value={draft.code}
                  onChange={(code) => setDraft((d) => ({ ...d, code }))}
                  functionName="action"
                  ambientVars={ambientVars}
                  ambientExtra={ambientExtra}
                  returnType={editorReturnType}
                  returnTypeTs={editorReturnTypeTs}
                />
              ) : null}
            </div>
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

      <TypeGenericArgsDialog
        open={genericDialogVisible}
        onOpenChange={setGenericDialogVisible}
        typeName={outputTypeName}
        genericNames={outputGenericNames}
        args={draft.outputGenericArgs}
        typeOptions={genericTypeOptions}
        onSave={saveGenericArgs}
      />
    </>
  )
}
