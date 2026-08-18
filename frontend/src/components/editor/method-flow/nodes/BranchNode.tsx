import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './BranchNode.css'

export default function BranchNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const summary = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    const expr = typeof rec.expression === 'string' ? rec.expression.trim() : ''
    return expr || '未配置条件'
  }, [data])

  return (
    <div className={`diamond-wrap ${debugClass}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <div className="diamond-shape">
        <div className="diamond-inner">
          <div className="flow-node-kind">判断</div>
          <div className="flow-node-summary" title={summary}>
            {summary}
          </div>
        </div>
      </div>
      <span className="side-label true">是</span>
      <span className="side-label false">否</span>
      <Handle
        id="true"
        type="source"
        position={Position.Right}
        style={{ top: '50%', right: 0, transform: 'translate(50%, -50%)' }}
      />
      <Handle
        id="false"
        type="source"
        position={Position.Left}
        style={{ top: '50%', left: 0, transform: 'translate(-50%, -50%)' }}
      />
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
