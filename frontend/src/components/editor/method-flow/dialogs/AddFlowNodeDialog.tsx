import { Modal } from 'antd'
import type { FlowNodeKind } from '../../../../types/backend-services'
import './AddFlowNodeDialog.css'

export type AddableFlowNodeKind = Exclude<FlowNodeKind, 'start'>

const NODE_OPTIONS: {
  kind: AddableFlowNodeKind
  label: string
  desc: string
}[] = [
  { kind: 'input', label: '输入', desc: '调用方法或读取请求头写入变量' },
  { kind: 'define', label: '定义数据', desc: '声明局部变量并赋初值' },
  { kind: 'branch', label: '判断', desc: '按表达式分支到「是 / 否」' },
  { kind: 'action', label: '操作', desc: '执行自定义代码片段' },
  { kind: 'output', label: '输出', desc: '调用数据层写入方法' },
  { kind: 'pageMap', label: '分页映射', desc: '分页或数组映射为 QueryPageVo<T>（只需选 T）' },
  { kind: 'objectMap', label: '对象映射', desc: '对象字段映射为接口类型（同名自动填写）' },
  { kind: 'throw', label: '业务异常', desc: '中断流程并返回业务错误（400）' },
  { kind: 'end', label: '终止', desc: '结束流程并可返回结果' },
]

export default function AddFlowNodeDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  onSelect?: (kind: AddableFlowNodeKind) => void
}) {
  function pick(kind: AddableFlowNodeKind) {
    onSelect?.(kind)
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title="添加节点"
      width={560}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={null}
    >
      <div className="node-options">
        {NODE_OPTIONS.map((opt) => (
          <button
            key={opt.kind}
            type="button"
            className="node-option"
            onClick={() => pick(opt.kind)}
          >
            <div className="option-title">{opt.label}</div>
            <div className="option-tag">{opt.kind}</div>
            <div className="option-desc">{opt.desc}</div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
