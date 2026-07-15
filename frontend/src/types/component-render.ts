import type { PageData } from './page-data'
import type { ComponentConfig } from './component'

/** 画布渲染时用到的组件详情（含 xml） */
export interface ComponentRenderInfo {
  id: string
  config: ComponentConfig
  xml: string
  data: PageData
}

export type ComponentRenderMap = Record<string, ComponentRenderInfo>
