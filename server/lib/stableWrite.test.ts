import { describe, expect, it } from 'vitest'
import { sameIgnoringTimestamps } from './stableWrite.ts'

describe('sameIgnoringTimestamps', () => {
  it('ignores timestamps', () => {
    expect(sameIgnoringTimestamps('{"generatedAt":"a","x":1}', '{"generatedAt":"b","x":1}')).toBe(true)
  })

  it('ignores last-digit floating-point noise from another platform', () => {
    expect(sameIgnoringTimestamps('{"p":[0.3286689462892926,0.5]}', '{"p":[0.32866894628929266,0.5]}')).toBe(true)
  })

  it('still sees real changes, including a changed probability or new key', () => {
    expect(sameIgnoringTimestamps('{"p":0.5123}', '{"p":0.5124}')).toBe(false)
    expect(sameIgnoringTimestamps('{"p":1}', '{"p":1,"q":2}')).toBe(false)
    expect(sameIgnoringTimestamps('{"a":[1,2]}', '{"a":[1]}')).toBe(false)
    expect(sameIgnoringTimestamps('{"t":"x"}', '{"t":"y"}')).toBe(false)
  })
})
