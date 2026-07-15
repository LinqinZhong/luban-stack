import { request } from './index'
import type { IconDefinition, IconLibrary } from '../types/icon-library'

export type { IconDefinition, IconLibrary }

export interface VoiderProjectConfig {
  name: string
  version: string
  author: string
  engineVersion: string
  canvas: {
    width: number
  }
}

export interface ProjectResult {
  path: string
  config: VoiderProjectConfig
}

export interface BrowseEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface BrowseResult {
  path: string
  parent: string | null
  entries: BrowseEntry[]
}

export interface ProjectMeta {
  engineVersion: string
  defaultCanvasWidth: number
  configFile: string
}

export interface CreateProjectPayload {
  path: string
  name: string
  author?: string
  version?: string
  engineVersion?: string
  canvasWidth?: number
}

export function getProjectMeta() {
  return request<ProjectMeta>('/api/projects/meta')
}

export function browseProjectDirectory(dirPath?: string) {
  const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''
  return request<BrowseResult>(`/api/projects/browse${query}`)
}

export function openProject(projectPath: string) {
  return request<ProjectResult>('/api/projects/open', {
    method: 'POST',
    body: JSON.stringify({ path: projectPath }),
  })
}

export function createProject(payload: CreateProjectPayload) {
  return request<ProjectResult>('/api/projects/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getIconLibrary(projectPath: string) {
  return request<IconLibrary>(
    `/api/projects/icons?projectPath=${encodeURIComponent(projectPath)}`,
  )
}

export function saveIconLibrary(payload: {
  projectPath: string
  icons: IconDefinition[]
}) {
  return request<IconLibrary>('/api/projects/icons', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}
