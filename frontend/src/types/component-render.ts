import type { PageData } from './page-data'
import type { ComponentConfig } from './component'
import type { LifecycleConfig } from './lifecycle'

/** 画布渲染时用到的组件详情（含 xml） */
export interface ComponentRenderInfo {
  id: string
  config: ComponentConfig
  xml: string
  data: PageData
  /** 组件 lifecycle.json，预览挂载嵌套实例时执行 */
  lifecycle?: LifecycleConfig
}

export type ComponentRenderMap = Record<string, ComponentRenderInfo>
