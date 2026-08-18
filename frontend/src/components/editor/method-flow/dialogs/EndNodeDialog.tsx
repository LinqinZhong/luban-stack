import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Modal } from 'antd'
import type { ProcessorTypeExpr } from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { defaultEmptyReturnHint } from '../../../../utils/empty-return-value'
import TypedBindingCascader from '../TypedBindingCascader'
import FlowPrintField from '../FlowPrintField'
import './EndNodeDialog.css'

export type EndNodeForm = {
  returnExpr: string
  printExpr: string
}

export default function EndNodeDialog({
  open,
  onOpenChange,
  form,
  outputTypeLabel,
  outputType,
  ambientVars,
  typeLibrary,
  requireReturn = true,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: EndNodeForm
  outputTypeLabel: string
  outputType: ProcessorTypeExpr
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
  requireReturn?: boolean
  onSave?: (form: EndNodeForm) => void
}) {
  const [draft, setDraft] = useState('')
  const [printDraft, setPrintDraft] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(form.returnExpr ?? '')
      setPrintDraft(form.printExpr ?? '')
    }
  }, [open, form.returnExpr, form.printExpr])

  const emptyHint = useMemo(
    () => defaultEmptyReturnHint(outputType, typeLibrary),
    [outputType, typeLibrary],
  )

  function handleSave() {
    onSave?.({
      returnExpr: requireReturn ? draft.trim() : '',
      printExpr: printDraft.trim(),
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑终止节点"
      width={480}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button type="primary" onClick={handleSave}>
          确定
        </Button>
      }
    >
      <Form
        className="flow-node-form"
        labelAlign="right"
        labelCol={{ flex: '110px' }}
        wrapperCol={{ flex: 1 }}
      >
        {requireReturn ? (
          <>
            <Form.Item label="出参类型">
              <span className="hint-inline">{outputTypeLabel || '—'}</span>
            </Form.Item>
            <Form.Item label="返回数据">
              <TypedBindingCascader
                value={draft}
                onChange={setDraft}
                ambientVars={ambientVars}
                targetType={outputType}
                typeLibrary={typeLibrary}
                placeholder="可选；留空则按出参类型返回空值"
              />
              {emptyHint ? <p className="hint">{emptyHint}</p> : null}
            </Form.Item>
          </>
        ) : null}
        <Form.Item label="打印">
          <FlowPrintField
            value={printDraft}
            onChange={setPrintDraft}
            ambientNames={ambientVars.map((v) => v.name).filter(Boolean)}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
