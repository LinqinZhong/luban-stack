import { useEffect, useState } from 'react'
import { Button, Form, Modal } from 'antd'
import FlowPrintField from '../FlowPrintField'
import './StartNodeDialog.css'

export default function StartNodeDialog({
  open,
  onOpenChange,
  printExpr,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  printExpr: string
  onSave?: (payload: { printExpr: string }) => void
}) {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (open) setDraft(printExpr ?? '')
  }, [open, printExpr])

  function handleSave() {
    onSave?.({ printExpr: draft.trim() })
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="编辑开始节点"
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
        onFinish={(e) => e.preventDefault?.()}
      >
        <Form.Item label="打印">
          <FlowPrintField value={draft} onChange={setDraft} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
