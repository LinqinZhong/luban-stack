import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal } from 'antd'
import FlowPrintField from '../FlowPrintField'
import './ThrowNodeDialog.css'

export type ThrowNodeForm = {
  messageExpr: string
  printExpr: string
}

export default function ThrowNodeDialog({
  open,
  onOpenChange,
  form,
  ambientHint,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  form: ThrowNodeForm
  ambientHint: string
  onSave?: (form: ThrowNodeForm) => void
}) {
  const [draft, setDraft] = useState('')
  const [printDraft, setPrintDraft] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(form.messageExpr ?? '')
      setPrintDraft(form.printExpr ?? '')
    }
  }, [open, form.messageExpr, form.printExpr])

  const messageError = useMemo(
    () => (draft.trim() ? '' : '请填写错误信息表达式'),
    [draft],
  )

  function handleSave() {
    if (messageError) return
    onSave?.({
      messageExpr: draft.trim(),
      printExpr: printDraft.trim(),
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑业务异常节点"
      width={520}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button
          type="primary"
          disabled={Boolean(messageError)}
          onClick={handleSave}
        >
          确定
        </Button>
      }
    >
      <Form
        className="flow-node-form"
        labelAlign="right"
        labelCol={{ flex: '96px' }}
        wrapperCol={{ flex: 1 }}
      >
        <Form.Item
          label="错误信息"
          required
          validateStatus={messageError ? 'error' : undefined}
          help={messageError || undefined}
        >
          <Input.TextArea
            value={draft}
            rows={3}
            placeholder={'表达式，如 "库存不足" 或 errMsg'}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Form.Item>
        {ambientHint ? (
          <Form.Item label="可访问变量">
            <span className="hint-inline">{ambientHint}</span>
          </Form.Item>
        ) : null}
        <Form.Item label="打印">
          <FlowPrintField
            value={printDraft}
            onChange={setPrintDraft}
            ambientNames={
              ambientHint
                ? ambientHint
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : []
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
