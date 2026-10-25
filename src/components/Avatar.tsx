interface AvatarProps {
  name: string
  corner: 'a' | 'b'
  size?: 'sm' | 'md' | 'lg'
}

/** Initials in an octagon, the shape of the cage, tinted by the fighter's corner. */
export function Avatar({ name, corner, size = 'md' }: AvatarProps) {
  const parts = name.replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
  return (
    <span className={`avatar ${corner} ${size}`} aria-hidden="true">
      <span>{initials || '?'}</span>
    </span>
  )
}
