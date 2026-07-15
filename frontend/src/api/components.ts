import { request } from './index'
import type { PageData } from '../types/page-data'
import type { ComponentConfig, ComponentSummary } from '../types/component'
import type { PageMethod } from '../types/page-method'

export interface ComponentDetail {
  id: string
  path: string
  config: ComponentConfig
  xml: string
  data: PageData
}

export function listComponents(projectPath: string) {
  return request<{ components: ComponentSummary[] }>(
    `/api/components?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function getComponent(projectPath: string, componentId: string) {
  return request<ComponentDetail>(
    `/api/components/${encodeURIComponent(componentId)}?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function createComponent(payload: {
  projectPath: string
  id: string
  name: string
  title?: string
}) {
  return request<ComponentDetail>('/api/components', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function saveComponentConfig(payload: {
  projectPath: string
  componentId: string
  config: ComponentConfig
}) {
  return request<ComponentDetail>(
    `/api/components/${encodeURIComponent(payload.componentId)}/config`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        config: payload.config,
      }),
    },
  )
}

export function saveComponentXml(payload: {
  projectPath: string
  componentId: string
  xml: string
}) {
  return request<ComponentDetail>(
    `/api/components/${encodeURIComponent(payload.componentId)}/xml`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        xml: payload.xml,
      }),
    },
  )
}

export function saveComponentData(payload: {
  projectPath: string
  componentId: string
  data: PageData
}) {
  return request<ComponentDetail>(
    `/api/components/${encodeURIComponent(payload.componentId)}/data`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        data: payload.data,
      }),
    },
  )
}

export function listComponentMethods(projectPath: string, componentId: string) {
  return request<{ methods: PageMethod[] }>(
    `/api/components/${encodeURIComponent(componentId)}/functions?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveComponentMethod(payload: {
  projectPath: string
  componentId: string
  method: PageMethod
  previousName?: string
}) {
  return request<{ method: PageMethod }>(
    `/api/components/${encodeURIComponent(payload.componentId)}/functions/${encodeURIComponent(payload.method.name)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        previousName: payload.previousName,
        method: payload.method,
      }),
    },
  )
}

export function deleteComponentMethod(payload: {
  projectPath: string
  componentId: string
  name: string
}) {
  return request<{ ok: boolean }>(
    `/api/components/${encodeURIComponent(payload.componentId)}/functions/${encodeURIComponent(payload.name)}?projectPath=${encodeURIComponent(payload.projectPath)}`,
    { method: 'DELETE' },
  )
}

export function getComponentLifecycle(projectPath: string, componentId: string) {
  return request<{ lifecycle: import('../types/lifecycle').LifecycleConfig }>(
    `/api/components/${encodeURIComponent(componentId)}/lifecycle?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveComponentLifecycle(payload: {
  projectPath: string
  componentId: string
  lifecycle: import('../types/lifecycle').LifecycleConfig
}) {
  return request<{ lifecycle: import('../types/lifecycle').LifecycleConfig }>(
    `/api/components/${encodeURIComponent(payload.componentId)}/lifecycle`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        lifecycle: payload.lifecycle,
      }),
    },
  )
}
