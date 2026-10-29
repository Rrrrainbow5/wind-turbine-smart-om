import { createServer } from 'vite'

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  resolve: { preserveSymlinks: true },
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
})
try {
  const checks = await server.ssrLoadModule('/tests/cad-mapping-check.ts')
  checks.runChecks()
} finally {
  await server.close()
}
