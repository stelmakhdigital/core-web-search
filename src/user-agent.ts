/**
 * The product User-Agent for all outbound web requests from the core.
 *
 * A single source of truth so the version never drifts across modules
 * (search engines, cached fetch, platform endpoints). The
 * `agents-web-search` token identifies the core product; host adapters append
 * their own identity (e.g. `dsh/0.1.5`) at composition time (see
 * `createWebStack`). Never a browser disguise (ADR-005 §5).
 * @module @agents-web-search/core/user-agent
 */

/** The core version embedded in the User-Agent. */
export const PRODUCT_VERSION = '0.1.0'

/** The product User-Agent for outbound web requests (host identity appended by the stack). */
export const PRODUCT_USER_AGENT = `agents-web-search/${PRODUCT_VERSION} (+https://github.com/agents-web-search/core)`

/**
 * A browser-like User-Agent for platforms that block the product UA (YouTube,
 * Bilibili, V2EX). The version token is shared with {@link PRODUCT_VERSION}.
 */
export const BROWSER_LIKE_USER_AGENT = `Mozilla/5.0 (compatible; agents-web-search/${PRODUCT_VERSION})`
