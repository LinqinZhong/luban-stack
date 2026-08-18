import { createContext } from 'react'
import type { ComponentRenderMap } from '../types/component-render'
import type { PageData } from '../types/page-data'

/**
 * 画布组件渲染表：用 Context 下发，避免作为 prop 层层传递。
 */
export const ComponentRenderMapContext = createContext<
  ComponentRenderMap | undefined
>(undefined)

/**
 * 当前组件实例的 live 数据池（setData 写入处）。
 */
export const ComponentLivePageDataContext = createContext<PageData | undefined>(
  undefined,
)

/**
 * 当前组件实例的 live `$props`（随宿主 `{field}` 绑定刷新）。
 */
export const ComponentLiveDollarPropsContext = createContext<
  Record<string, unknown> | undefined
>(undefined)

/**
 * 页面级 live 数据池。
 */
export const PageLivePageDataContext = createContext<PageData | undefined>(
  undefined,
)
