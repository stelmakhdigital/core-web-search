/**
 * Screenshot file output for the `browser_screenshot` tool. Screenshots are
 * written to a per-deployment directory (default: `<stateDir>/browser-screenshots`);
 * the directory is created lazily so the default path works out of the box.
 * @module @agents-web-search/core/browser/screenshot
 */
/**
 * Write one PNG screenshot to `dir` (created recursively when absent) and
 * return the file path. The file name is a UUID so concurrent sessions never
 * collide.
 */
export declare function writeScreenshot(buffer: Buffer, dir: string): Promise<string>;
