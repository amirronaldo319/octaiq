import { usePhoto } from '../lib/photos'

interface AvatarProps {
  name: string
  corner: 'a' | 'b' | 'n'
  size?: 'sm' | 'md' | 'lg'
}

/** A licensed portrait when the site has one, otherwise initials in an octagon, the shape of the cage, tinted by the fighter's corner. */
export function Avatar({ name, corner, size = 'md' }: AvatarProps) {
  const photo = usePhoto(name)
  const parts = name.replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean)
  const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
  return (
    <span className={`avatar ${corner} ${size}`} aria-hidden="true" title={photo ? `Photo: ${photo.credit} (${photo.licence})` : undefined}>
      {photo ? <img src={photo.url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initials || '?'}</span>}
    </span>
  )
}
