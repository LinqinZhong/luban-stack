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
