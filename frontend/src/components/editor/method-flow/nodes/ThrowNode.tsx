import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './ThrowNode.css'

export default function ThrowNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const messageExpr = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    return typeof rec.messageExpr === 'string' ? rec.messageExpr.trim() : ''
  }, [data])

  return (
    <div className={`flow-node throw-node ${debugClass}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <div className="flow-node-title">业务异常</div>
      <div className="flow-node-summary" title={messageExpr || '未配置错误信息'}>
        {messageExpr || '未配置错误信息'}
      </div>
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
