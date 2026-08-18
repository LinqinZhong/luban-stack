import { useMemo } from 'react'
import { useFlowDebug } from './flow-debug-inject'
import './FlowNodePrintBubble.css'

export default function FlowNodePrintBubble({ nodeId }: { nodeId: string }) {
  const debug = useFlowDebug()

  const printText = useMemo(() => {
    const map = debug?.printByNode
    const text = map?.[nodeId]
    return typeof text === 'string' && text.trim() ? text : ''
  }, [debug?.printByNode, nodeId])

  const isCursor = Boolean(debug?.cursorId) && debug?.cursorId === nodeId
  const visible = Boolean(printText)

  const bubbleStyle = useMemo(() => {
    const text = printText
    const lines = text.split(/\r?\n/)
    let maxLen = 0
    for (const line of lines) {
      let w = 0
      for (const ch of line) {
        w += /[\u4e00-\u9fff]/.test(ch) ? 1 : 0.55
      }
      maxLen = Math.max(maxLen, w)
    }
    const widthPx = Math.min(320, Math.max(120, Math.ceil(maxLen * 13 + 28)))
    return {
      width: `${widthPx}px`,
      maxWidth: '320px',
    }
  }, [printText])

  if (!visible) return null

  return (
    <div
      className={`print-bubble${isCursor ? ' is-cursor' : ''}`}
      style={bubbleStyle}
      title={printText}
    >
      <pre className="print-bubble-body">{printText}</pre>
    </div>
  )
}
