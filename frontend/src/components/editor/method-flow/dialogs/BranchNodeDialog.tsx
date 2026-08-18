import { useEffect, useState } from 'react'
import { Button, Form, Input, Modal } from 'antd'
import FlowPrintField from '../FlowPrintField'
import './BranchNodeDialog.css'

export default function BranchNodeDialog({
  open,
  onOpenChange,
  expression,
  printExpr,
  ambientHint,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  expression: string
  printExpr: string
  ambientHint: string
  onSave?: (payload: { expression: string; printExpr: string }) => void
}) {
  const [draft, setDraft] = useState('')
  const [printDraft, setPrintDraft] = useState('')

  useEffect(() => {
    if (open) {
      setDraft(expression)
      setPrintDraft(printExpr ?? '')
    }
  }, [open, expression, printExpr])

  function handleSave() {
    onSave?.({
      expression: draft.trim(),
      printExpr: printDraft.trim(),
    })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑判断节点"
      width={520}
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
        <Form.Item label="条件表达式">
          <Input.TextArea
            value={draft}
            rows={4}
            placeholder="例如：goodsList.length > 0"
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
