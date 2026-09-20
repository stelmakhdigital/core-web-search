import { describe, expect, it } from 'vitest'
import { deadline, timeoutOf, TimeoutReason } from '../src/timeout.ts'
import { CoreError, errorCodeOf, errorMessage, isCoreError, toCoreError } from '../src/errors.ts'

describe('CoreError helpers', () => {
  it('isCoreError distinguishes CoreErrors from other errors', () => {
    expect(isCoreError(new CoreError('x', 'WEB_BAD_REQUEST'))).toBe(true)
    expect(isCoreError(new Error('x'))).toBe(false)
    expect(isCoreError('nope')).toBe(false)
  })

  it('toCoreError wraps unknown throws with the given code and keeps the cause', () => {
    const original = new Error('boom')
    const wrapped = toCoreError(original, 'wrapped failure', 'WEB_INTERNAL')
    expect(wrapped).toBeInstanceOf(CoreError)
    expect(errorCodeOf(wrapped)).toBe('WEB_INTERNAL')
    expect(wrapped.message).toBe('wrapped failure')
    expect(wrapped.cause).toBe(original)
  })

  it('toCoreError passes through existing CoreErrors unchanged', () => {
    const err = new CoreError('x', 'WEB_AUTH')
    expect(toCoreError(err, 'ignored', 'WEB_AUTH')).toBe(err)
  })

  it('errorCodeOf / errorMessage work on unknown values', () => {
    expect(errorCodeOf('plain string')).toBe('WEB_INTERNAL')
    expect(errorCodeOf(new CoreError('x', 'WEB_QUOTA'))).toBe('WEB_QUOTA')
    expect(errorMessage(new Error('boom'))).toContain('boom')
  })
})

describe('deadline / timeoutOf', () => {
  it('a fired deadline carries a TimeoutReason of the requested code', async () => {
    const controller = new AbortController()
    const d = deadline(undefined, 5, 'WEB_SEARCH_TIMEOUT')
    await new Promise((resolve) => setTimeout(resolve, 20))
    d[Symbol.dispose]()
    const timeout = timeoutOf(d.signal, 'WEB_SEARCH_TIMEOUT')
    expect(timeout).toBeInstanceOf(TimeoutReason)
    if (timeout === undefined) throw new Error('expected a timeout reason')
    expect(timeout.code).toBe('WEB_SEARCH_TIMEOUT')
    expect(timeout.timeoutMs).toBe(5)
    expect(d.signal.aborted).toBe(true)
    expect(controller).toBeDefined()
  })

  it('an explicit caller abort wins (reason preserved, not a timeout)', async () => {
    const controller = new AbortController()
    const d = deadline(controller.signal, 5_000, 'WEB_FETCH_TIMEOUT')
    controller.abort(new Error('user cancel'))
    await new Promise((resolve) => setTimeout(resolve, 5))
    d[Symbol.dispose]()
    expect(timeoutOf(d.signal, 'WEB_FETCH_TIMEOUT')).toBeUndefined()
    expect(d.signal.reason).toBeInstanceOf(Error)
  })

  it('the first abort wins (AbortSignal.any semantics)', async () => {
    const controller = new AbortController()
    const d = deadline(controller.signal, 10, 'WEB_ABORTED')
    await new Promise((resolve) => setTimeout(resolve, 20))
    d[Symbol.dispose]()
    expect(timeoutOf(d.signal, 'WEB_ABORTED')).toBeInstanceOf(TimeoutReason)
    controller.abort()
    expect(d.signal.reason).toBeInstanceOf(TimeoutReason)
  })
})
