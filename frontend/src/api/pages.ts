import { request } from './index'
import type { PageData } from '../types/page-data'

export interface PageConfig {
  name: string
  title?: string
}

export interface PageSummary {
  id: string
  name: string
  title: string
  path: string
  isEntry?: boolean
}

export interface PageDetail {
  id: string
  path: string
  config: PageConfig
  xml: string
  data: PageData
}

export function listPages(projectPath: string) {
  return request<{ pages: PageSummary[] }>(
    `/api/pages?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function getPage(projectPath: string, pageId: string) {
  return request<PageDetail>(
    `/api/pages/${encodeURIComponent(pageId)}?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function createPage(payload: {
  projectPath: string
  id: string
  name: string
  title?: string
}) {
  return request<PageDetail>('/api/pages', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function savePageConfig(payload: {
  projectPath: string
  pageId: string
  name: string
  title?: string
}) {
  return request<PageDetail>(
    `/api/pages/${encodeURIComponent(payload.pageId)}/config`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        name: payload.name,
        title: payload.title,
      }),
    },
  )
}

export function copyPage(payload: {
  projectPath: string
  pageId: string
  newId: string
  name?: string
  title?: string
}) {
  return request<PageDetail>(
    `/api/pages/${encodeURIComponent(payload.pageId)}/copy`,
    {
      method: 'POST',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        newId: payload.newId,
        name: payload.name,
        title: payload.title,
      }),
    },
  )
}

export function deletePage(payload: { projectPath: string; pageId: string }) {
  return request<{ ok: boolean; entryCleared: boolean }>(
    `/api/pages/${encodeURIComponent(payload.pageId)}?projectPath=${encodeURIComponent(payload.projectPath)}`,
    { method: 'DELETE' },
  )
}

export function savePageXml(payload: {
  projectPath: string
  pageId: string
  xml: string
}) {
  return request<PageDetail>(
    `/api/pages/${encodeURIComponent(payload.pageId)}/xml`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        xml: payload.xml,
      }),
    },
  )
}

export function savePageData(payload: {
  projectPath: string
  pageId: string
  data: PageData
}) {
  return request<PageDetail>(
    `/api/pages/${encodeURIComponent(payload.pageId)}/data`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        data: payload.data,
      }),
    },
  )
}

export function listPageMethods(projectPath: string, pageId: string) {
  return request<{ methods: import('../types/page-method').PageMethod[] }>(
    `/api/pages/${encodeURIComponent(pageId)}/functions?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function savePageMethod(payload: {
  projectPath: string
  pageId: string
  method: import('../types/page-method').PageMethod
  previousName?: string
}) {
  return request<{ method: import('../types/page-method').PageMethod }>(
    `/api/pages/${encodeURIComponent(payload.pageId)}/functions/${encodeURIComponent(payload.method.name)}`,
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

export function deletePageMethod(payload: {
  projectPath: string
  pageId: string
  name: string
}) {
  return request<{ ok: boolean }>(
    `/api/pages/${encodeURIComponent(payload.pageId)}/functions/${encodeURIComponent(payload.name)}?projectPath=${encodeURIComponent(payload.projectPath)}`,
    { method: 'DELETE' },
  )
}

export function getPageLifecycle(projectPath: string, pageId: string) {
  return request<{ lifecycle: import('../types/lifecycle').LifecycleConfig }>(
    `/api/pages/${encodeURIComponent(pageId)}/lifecycle?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function savePageLifecycle(payload: {
  projectPath: string
  pageId: string
  lifecycle: import('../types/lifecycle').LifecycleConfig
}) {
  return request<{ lifecycle: import('../types/lifecycle').LifecycleConfig }>(
    `/api/pages/${encodeURIComponent(payload.pageId)}/lifecycle`,
    {
      method: 'PUT',
      body: JSON.stringify({
        projectPath: payload.projectPath,
        lifecycle: payload.lifecycle,
      }),
    },
  )
}
