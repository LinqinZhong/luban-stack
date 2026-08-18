import { Modal } from 'antd'
import { WIDGET_OPTIONS, type WidgetTag } from '../../utils/xml-node'
import './AddWidgetDialog.css'

export default function AddWidgetDialog({
  open = false,
  onOpenChange,
  onSelect,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelect?: (tag: WidgetTag) => void
}) {
  function pick(tag: WidgetTag) {
    onSelect?.(tag)
    onOpenChange?.(false)
  }

  function shortLabel(label: string) {
    return label.split(/\s+/)[0] || label
  }

  return (
    <Modal
      open={open}
      title="添加控件"
      width={560}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      footer={null}
      onCancel={() => onOpenChange?.(false)}
    >
      <div className="widget-options">
        {WIDGET_OPTIONS.map((opt) => (
          <button
            key={opt.tag}
            type="button"
            className="widget-option"
            title={opt.description}
            onClick={() => pick(opt.tag)}
          >
            <div className="option-title">{shortLabel(opt.label)}</div>
            <div className="option-tag">{opt.tag}</div>
            <div className="option-desc">{opt.description}</div>
          </button>
        ))}
      </div>
    </Modal>
  )
}
