import type { Role } from './types'

export function isAdmin(role: Role | null | undefined): boolean {
  return role === 'admin'
}

export function isWriter(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'uploader'
}

export function isViewer(role: Role | null | undefined): boolean {
  return role === 'viewer'
}
