/** A saved forecast's time as a short, URL-safe id: 2026-10-25T17:36:28.975Z becomes 20261025T173628975Z. */
export const versionId = (iso: string): string => iso.replace(/[-:.]/g, '')
