import { useEffect, useRef, type ReactNode } from 'react'

interface BoutModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Accessible overlay: Escape and backdrop close it, focus moves in and returns, and the page behind stops scrolling. */
export function BoutModal({ title, onClose, children }: BoutModalProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close details">Close</button>
        {children}
      </div>
    </div>
  )
}
