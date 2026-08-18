import { useEffect, useMemo, useState } from 'react'
import { Button, Modal } from 'antd'
import type { MethodParam } from '../../types/page-method'
import TsCodeEditor from './TsCodeEditor'
import { DM } from './edit-data-method-copy'
import './EnableConditionDialog.css'

export default function EnableConditionDialog({
  open,
  onOpenChange,
  expression,
  ambientVars,
  ambientHint,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  expression: string
  ambientVars?: MethodParam[]
  ambientHint?: string
  onSave?: (expression: string) => void
}) {
  const [draft, setDraft] = useState('')

  const editorAmbientVars = useMemo((): MethodParam[] => {
    if (ambientVars?.length) return ambientVars
    const names = (ambientHint ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return names.map(
      (name) =>
        ({
          name,
          type: 'any',
          tsType: 'any',
        }) satisfies MethodParam,
    )
  }, [ambientVars, ambientHint])

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
      title={DM.enableCondTitle}
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
        <code>function condition(): boolean</code>
        方法体内编写逻辑；留空表示始终启用。
      </p>
      <div
        className="editor-wrap nokey"
        onKeyDown={stopEditorKeys}
        onKeyUp={stopEditorKeys}
      >
        {open && (
          <TsCodeEditor
            value={draft}
            onChange={setDraft}
            functionName="condition"
            returnType="boolean"
            ambientVars={editorAmbientVars}
          />
        )}
      </div>
      {editorAmbientVars.length > 0 && (
        <p className="ambient-hint">
          {DM.enableCondHint}：
          {editorAmbientVars.map((v) => v.name).filter(Boolean).join(', ')}
        </p>
      )}
    </Modal>
  )
}
