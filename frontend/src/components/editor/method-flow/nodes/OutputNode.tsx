import { useMemo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble'
import './OutputNode.css'

export default function OutputNode({ id, data }: NodeProps) {
  const { debugClass } = useFlowDebugNode(id)

  const summary = useMemo(() => {
    const rec = (data ?? {}) as Record<string, unknown>
    if (rec.channel === 'network') {
      const network =
        rec.network && typeof rec.network === 'object'
          ? (rec.network as Record<string, unknown>)
          : rec
      const method =
        typeof network.httpMethod === 'string' ? network.httpMethod : 'GET'
      const url =
        typeof network.apiUrl === 'string' ? network.apiUrl.trim() : ''
      const description =
        typeof rec.description === 'string' ? rec.description.trim() : ''
      if (description) return description
      return `${method} ${url || '(未填地址)'}`
    }
    const description =
      typeof rec.description === 'string' ? rec.description.trim() : ''
    if (description) return description
    const methodLabel =
      typeof rec.methodLabel === 'string' ? rec.methodLabel.trim() : ''
    if (methodLabel) {
      return methodLabel.replace(/（[^）]*）$/, '')
    }
    return '未绑定写入方法'
  }, [data])

  return (
    <div className={`io-wrap ${debugClass}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <div className="io-shape output-node">
        <div className="io-content">
          <div className="flow-node-kind">输出</div>
          <div className="flow-node-summary" title={summary}>
            {summary}
          </div>
        </div>
      </div>
      <Handle id="default" type="source" position={Position.Bottom} />
      <FlowNodePrintBubble nodeId={id} />
    </div>
  )
}
