import { useEffect, useMemo, useState } from 'react'
import { Button, Modal } from 'antd'
import type { MethodParam } from '../../../../types/page-method'
import TsCodeEditor from '../../TsCodeEditor'
import './NetworkParamComputeDialog.css'

export default function NetworkParamComputeDialog({
  open,
  onOpenChange,
  expression,
  paramName,
  ambientVars,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  expression: string
  paramName?: string
  ambientVars?: MethodParam[]
  onSave?: (expression: string) => void
}) {
  const [draft, setDraft] = useState('')

  const title = useMemo(() => {
    const name = (paramName ?? '').trim()
    return name ? `配置计算 · ${name}` : '配置计算'
  }, [paramName])

  useEffect(() => {
    if (open) setDraft(expression ?? '')
  }, [open, expression])

  function stopEditorKeys(e: React.KeyboardEvent) {
    e.stopPropagation()
  }

  function handleSave() {
    onSave?.(draft.replace(/\s+$/, ''))
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={title}
      width={640}
      destroyOnHidden
      maskClosable={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <>
          <Button onClick={() => onOpenChange?.(false)}>取消</Button>
          <Button type="primary" onClick={handleSave}>
            确定
          </Button>
        </>
      }
    >
      <p className="hint">
        在
        <code>function value(): string</code>
        方法体内编写逻辑；签名不可编辑。可直接使用入参变量。
      </p>
      <div
        className="editor-wrap nokey"
        onKeyDown={stopEditorKeys}
        onKeyUp={stopEditorKeys}
      >
        {open ? (
          <TsCodeEditor
            value={draft}
            onChange={setDraft}
            functionName="value"
            returnType="string"
            ambientVars={ambientVars ?? []}
          />
        ) : null}
      </div>
      {(ambientVars ?? []).length ? (
        <p className="ambient-hint">
          可访问变量：
          {(ambientVars ?? [])
            .map((v) => v.name)
            .filter(Boolean)
            .join(', ')}
        </p>
      ) : null}
    </Modal>
  )
}
