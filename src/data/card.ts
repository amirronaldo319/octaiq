import type { BookLine, Fight, Fighter } from '../engine/types'

/**
 * DEMO DATA: every fighter below is fictional. Replace this module with a
 * UFCStats / odds-API adapter that returns the same `Fight[]` shape.
 */
export const CARD_TITLE = 'OctaIQ Demo Card'

function fighter(id: string, name: string, record: string, rest: Omit<Fighter, 'id' | 'name' | 'record'>): Fighter {
  return { id, name, record, ...rest }
}

const BOOKS = ['Alpha Book', 'Borealis', 'Cobalt Sports', 'Delta Lines']

/** Build per-book lines around a base price with small deterministic offsets. */
function lines(baseA: number, baseB: number): BookLine[] {
  const offsets = [0, 5, -5, 10]
  return BOOKS.map((book, i) => ({
    book,
    a: shift(baseA, offsets[i]),
    b: shift(baseB, -offsets[i]),
  }))
}

function shift(american: number, delta: number): number {
  const next = american + delta
  if (american > 0 && next < 100) return 100
  if (american < 0 && next > -100) return -100
  return next
}

const kaito = fighter('f1', 'Kaito Brennan', '19-3-0', {
  age: 29, reachCm: 188, style: 'Striker', slpm: 5.4, strikeAcc: 0.51, strikeDef: 0.62, tdPer15: 0.4,
  tdDef: 0.78, subPer15: 0.1, finishRate: 0.74, chin: 0.72, cardio: 0.8, layoffDays: 160,
})
const marcus = fighter('f2', 'Marcus Voss', '16-4-0', {
  age: 33, reachCm: 183, style: 'Wrestler', slpm: 3.1, strikeAcc: 0.44, strikeDef: 0.55, tdPer15: 4.2,
  tdDef: 0.7, subPer15: 0.6, finishRate: 0.38, chin: 0.64, cardio: 0.86, layoffDays: 210,
})
const dario = fighter('f3', 'Dario Ximenes', '24-6-0', {
  age: 35, reachCm: 178, style: 'Grappler', slpm: 2.6, strikeAcc: 0.42, strikeDef: 0.5, tdPer15: 2.8,
  tdDef: 0.6, subPer15: 2.1, finishRate: 0.71, chin: 0.52, cardio: 0.6, layoffDays: 520,
})
const leon = fighter('f4', 'Leon Achterberg', '13-1-0', {
  age: 26, reachCm: 193, style: 'Pressure', slpm: 4.9, strikeAcc: 0.48, strikeDef: 0.58, tdPer15: 1.1,
  tdDef: 0.82, subPer15: 0.3, finishRate: 0.69, chin: 0.78, cardio: 0.9, layoffDays: 140,
})
const tomas = fighter('f5', 'Tomas Rhee', '11-2-0', {
  age: 30, reachCm: 175, style: 'Counter', slpm: 3.8, strikeAcc: 0.55, strikeDef: 0.68, tdPer15: 0.7,
  tdDef: 0.74, subPer15: 0.2, finishRate: 0.45, chin: 0.7, cardio: 0.75, layoffDays: 240,
})
const andre = fighter('f6', 'Andre Okonkwo', '15-5-0', {
  age: 32, reachCm: 180, style: 'Pressure', slpm: 4.4, strikeAcc: 0.46, strikeDef: 0.52, tdPer15: 1.9,
  tdDef: 0.66, subPer15: 0.5, finishRate: 0.6, chin: 0.6, cardio: 0.72, layoffDays: 300,
})
const silas = fighter('f7', 'Silas Moreau', '9-0-0', {
  age: 24, reachCm: 185, style: 'Striker', slpm: 5.1, strikeAcc: 0.5, strikeDef: 0.57, tdPer15: 0.5,
  tdDef: 0.7, subPer15: 0.1, finishRate: 0.89, chin: 0.62, cardio: 0.78, layoffDays: 120,
})
const rafael = fighter('f8', 'Rafael Quintero', '21-7-0', {
  age: 34, reachCm: 182, style: 'Grappler', slpm: 3.0, strikeAcc: 0.43, strikeDef: 0.53, tdPer15: 3.4,
  tdDef: 0.64, subPer15: 1.4, finishRate: 0.62, chin: 0.58, cardio: 0.68, layoffDays: 380,
})
const jun = fighter('f9', 'Jun-ho Park', '14-2-0', {
  age: 28, reachCm: 173, style: 'Wrestler', slpm: 3.5, strikeAcc: 0.47, strikeDef: 0.6, tdPer15: 3.6,
  tdDef: 0.8, subPer15: 0.8, finishRate: 0.5, chin: 0.74, cardio: 0.88, layoffDays: 190,
})
const viktor = fighter('f10', 'Viktor Hale', '18-6-1', {
  age: 31, reachCm: 176, style: 'Counter', slpm: 3.9, strikeAcc: 0.49, strikeDef: 0.59, tdPer15: 1.0,
  tdDef: 0.68, subPer15: 0.3, finishRate: 0.55, chin: 0.66, cardio: 0.74, layoffDays: 260,
})

export const FIGHTS: Fight[] = [
  { id: 'e1', weightClass: 'Lightweight', rounds: 5, mainEvent: true, a: kaito, b: marcus,
    books: lines(-210, 175), history: [-170, -180, -190, -195, -205, -210] },
  { id: 'e2', weightClass: 'Welterweight', rounds: 5, mainEvent: false, a: leon, b: dario,
    books: lines(-340, 270), history: [-300, -310, -320, -330, -335, -340] },
  { id: 'e3', weightClass: 'Middleweight', rounds: 3, mainEvent: false, a: tomas, b: andre,
    books: lines(-120, 100), history: [110, 105, -105, -110, -115, -120] },
  { id: 'e4', weightClass: 'Featherweight', rounds: 3, mainEvent: false, a: silas, b: rafael,
    books: lines(-260, 215), history: [-250, -255, -250, -260, -265, -260] },
  { id: 'e5', weightClass: 'Bantamweight', rounds: 3, mainEvent: false, a: jun, b: viktor,
    books: lines(-145, 125), history: [-130, -135, -135, -140, -145, -145] },
]
