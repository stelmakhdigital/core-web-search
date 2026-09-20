// Build the core: bundle src/index.ts to lib/index.js as Node ESM.
// Third-party deps (cheerio, playwright) stay EXTERNAL — resolved from the
// host's node_modules at runtime. The core has no host (agent) dependencies:
// nothing from @deepseek-ai/* or @earendil-works/* may ever appear here (Q9;
// enforced by the "no host imports" lint rule in CI, roadmap 6.1).
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

// Third-party deps that stay external (resolved from node_modules at runtime).
// `playwright` is optional (browser module, disabled by default).
const externalThirdParty = ['cheerio', 'playwright']

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outdir: join(root, 'lib'),
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  bundle: true,
  external: externalThirdParty,
  sourcemap: false,
  logLevel: 'info',
})
