import type { ComponentConfig } from './component'

/** 预览态点击组件操纵杆后，向调试面板传递的检视目标 */
export type PreviewInspectPayload = {
  nodeId: string
  componentId: string
  label: string
  config: ComponentConfig
  hostAttrs: Record<string, string>
  /** 宿主数据池所属组件；空=页面 */
  hostDataOwnerId: string
}
