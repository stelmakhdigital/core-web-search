/**
 * Shared helpers for provider-native engines (ADR-004): a single JSON POST
 * with uniform status classification. The core speaks these provider APIs
 * over plain HTTP — no host LLM SDK, no vendor packages (Q9).
 * @module @agents-web-search/core/search/engines/provider-native/common
 */

import { CoreError } from '../../../errors.ts'
import { classifyWebError, readCappedText } from '../../http.ts'

/** Maximum response body for provider-native search responses (1 MiB). */
const MAX_RESPONSE_BYTES = 1_048_576

export interface ProviderJsonOptions {
  readonly endpoint: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly engineLabel: string
  readonly signal: AbortSignal
}

/**
 * POST one JSON document and parse the JSON response, classifying transport
 * and provider failures into `CoreError` codes (401/403 → WEB_AUTH,
 * 402/429 → WEB_QUOTA, 404/405/501 → WEB_UNSUPPORTED, else WEB_PROVIDER_ERROR).
 */
export async function providerJson<T>(options: ProviderJsonOptions): Promise<T> {
  let response: Response
  try {
    response = await fetch(options.endpoint, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    throw classifyWebError(error, options.signal, `${options.engineLabel} search request failed`)
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel()
    throw new CoreError(`${options.engineLabel} rejected the credentials (HTTP ${response.status})`, 'WEB_AUTH', { cause: response })
  }
  if (response.status === 402 || response.status === 429) {
    await response.body?.cancel()
    throw new CoreError(`${options.engineLabel} quota/rate limit exceeded (HTTP ${response.status})`, 'WEB_QUOTA', { cause: response })
  }
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    await response.body?.cancel()
    throw new CoreError(`${options.engineLabel} does not support hosted web search on this endpoint (HTTP ${response.status})`, 'WEB_UNSUPPORTED', { cause: response })
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new CoreError(`${options.engineLabel} search request failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR', { cause: response })
  }
  let text: string
  try {
    text = await readCappedText(response, MAX_RESPONSE_BYTES)
  } catch (error) {
    throw classifyWebError(error, options.signal, `${options.engineLabel} search body read failed`)
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new CoreError(`${options.engineLabel} returned a non-JSON response`, 'WEB_PARSE_ERROR', { cause: error })
  }
}

/** Normalize an unknown field to a non-empty string (or undefined). */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
