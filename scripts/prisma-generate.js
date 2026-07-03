/**
 * Cross-platform prisma generate wrapper.
 * Runs `prisma generate` and silently ignores EPERM (DLL locked by dev server on Windows).
 * On Render/Linux this always succeeds normally.
 */
const { execSync } = require('child_process')
const path = require('path')

const schema = path.resolve(__dirname, '..', 'prisma', 'schema.prisma')

try {
  execSync(`npx prisma generate --schema="${schema}"`, { stdio: 'inherit' })
} catch (e) {
  const msg = e.message || ''
  if (msg.includes('EPERM') || msg.includes('operation not permitted')) {
    console.warn('[prisma-generate] DLL locked by running dev server — skipping (already generated)')
  } else {
    console.error('[prisma-generate] Failed:', msg)
    process.exit(1)
  }
}
