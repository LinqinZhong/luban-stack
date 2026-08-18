import { useState } from 'react'
import { Button, Empty, Form, Input, Modal, Tooltip } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { ElMessage, ElMessageBox } from '../../ui/feedback'
import {
  isValidPaletteColorName,
  type ColorPalette,
  type PaletteColor,
} from '../../types/color-palette'
import ColorPicker from './ColorPicker'
import './ColorPalettePanel.css'

export default function ColorPalettePanel({
  library,
  onLibraryChange,
}: {
  library: ColorPalette
  onLibraryChange?: (library: ColorPalette) => void
}) {
  const colors = library.colors
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    value: '#409eff',
  })

  function setColors(value: PaletteColor[]) {
    onLibraryChange?.({ colors: value })
  }

  function openCreate() {
    setEditingName(null)
    setForm({ name: '', description: '', value: '#409eff' })
    setDialogOpen(true)
  }

  function openEdit(color: PaletteColor) {
    setEditingName(color.name)
    setForm({
      name: color.name,
      description: color.description,
      value: color.value,
    })
    setDialogOpen(true)
  }

  async function removeColor(color: PaletteColor) {
    try {
      await ElMessageBox.confirm(
        `确定删除颜色「${color.description || color.name}」吗？引用该 key 的控件将无法解析为调色板色值。`,
        '删除颜色',
        {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
        },
      )
    } catch {
      return
    }

    setColors(colors.filter((item) => item.name !== color.name))
    ElMessage.success('已删除颜色')
  }

  function saveColor() {
    const name = form.name.trim()
    if (!isValidPaletteColorName(name)) {
      ElMessage.error('颜色名称需以字母开头，仅含字母、数字、下划线和短横线')
      return
    }

    const value = form.value.trim()
    if (!value) {
      ElMessage.error('请填写颜色值')
      return
    }

    const duplicate = colors.some(
      (item) => item.name === name && item.name !== editingName,
    )
    if (duplicate) {
      ElMessage.error('颜色名称已存在')
      return
    }

    const next: PaletteColor = {
      name,
      description: form.description.trim(),
      value,
    }

    if (editingName) {
      setColors(
        colors.map((item) => (item.name === editingName ? next : item)),
      )
    } else {
      setColors([...colors, next])
    }

    setDialogOpen(false)
    ElMessage.success(editingName ? '已更新颜色' : '已添加颜色')
  }

  return (
    <div className="color-palette-panel">
      <div className="panel-toolbar">
        <div className="toolbar-text">
          <div className="title">调色板</div>
          <div className="desc">
            项目级颜色 token。选择颜色时填入名称 key，构建时生成 CSS 变量
            <code>var(--name)</code>
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          添加颜色
        </Button>
      </div>

      {!colors.length ? (
        <Empty description="暂无颜色，点击添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className="color-grid">
          {colors.map((color) => (
            <div key={color.name} className="color-card">
              <div className="color-main">
                <div
                  className={`color-swatch${color.value === 'transparent' ? ' checker' : ''}`}
                  style={
                    color.value === 'transparent'
                      ? undefined
                      : { background: color.value }
                  }
                />
                <div className="color-meta">
                  <div className="color-name" title={color.name}>
                    {color.name}
                  </div>
                  <div
                    className="color-desc"
                    title={color.description || color.value}
                  >
                    {color.description || color.value}
                  </div>
                  <div className="color-value" title={color.value}>
                    {color.value}
                  </div>
                </div>
              </div>
              <div className="color-actions">
                <Tooltip title="编辑" placement="top">
                  <Button
                    type="text"
                    shape="circle"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation()
                      openEdit(color)
                    }}
                  />
                </Tooltip>
                <Tooltip title="删除" placement="top">
                  <Button
                    type="text"
                    shape="circle"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeColor(color)
                    }}
                  />
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={dialogOpen}
        title={editingName ? '编辑颜色' : '添加颜色'}
        width={440}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setDialogOpen(false)}
        footer={
          <Button type="primary" onClick={saveColor}>
            保存
          </Button>
        }
      >
        <Form layout="vertical">
          <Form.Item label="颜色名称（英文）" required>
            <Input
              value={form.name}
              disabled={Boolean(editingName)}
              placeholder="例如：primary"
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </Form.Item>
          <Form.Item label="说明">
            <Input
              value={form.description}
              placeholder="例如：主色"
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </Form.Item>
          <Form.Item label="颜色值" required>
            <ColorPicker
              value={form.value}
              hidePalette
              placeholder="#409eff / rgba(...)"
              onChange={(next) => setForm((prev) => ({ ...prev, value: next }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
