import {
  KIND_LABELS,
  PROJECT_STATUS_LABELS,
  MOVEMENT_TYPE_LABELS,
  ROLE_LABELS,
  PARTNER_KIND_LABELS,
} from '../lib/formatters'

export function KindBadge({ kind }) {
  const isReusable = kind === 'reusable'
  return (
    <span className={`badge ${isReusable ? 'badge-reusable' : 'badge-consumable'}`}>
      {KIND_LABELS[kind] || kind}
    </span>
  )
}

export function ProjectStatusBadge({ status }) {
  return (
    <span className={`badge badge-status-${status}`}>
      {PROJECT_STATUS_LABELS[status] || status}
    </span>
  )
}

export function MovementTypeBadge({ type }) {
  return (
    <span className={`badge badge-move-${type}`}>
      {MOVEMENT_TYPE_LABELS[type] || type}
    </span>
  )
}

export function RoleBadge({ role }) {
  return (
    <span className={`badge badge-role-${role}`}>
      {ROLE_LABELS[role] || role}
    </span>
  )
}

export function PartnerKindBadge({ kind }) {
  return (
    <span className={`badge ${kind === 'supplier' ? 'badge-reusable' : 'badge-consumable'}`}>
      {PARTNER_KIND_LABELS[kind] || kind}
    </span>
  )
}
