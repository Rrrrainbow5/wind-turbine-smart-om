import { createServer } from 'vite'
import React from 'react'
import { renderToString } from 'react-dom/server'

// A production build alone does not execute component initialization.
const server = await createServer({ configLoader: 'runner', server: { middlewareMode: true } })
try {
  const { default: App } = await server.ssrLoadModule('/src/App.tsx')
  const html = renderToString(React.createElement(App))
  if (!html.includes('app-shell')) throw new Error('Initial render missing app shell')
  console.log(`Initial render passed: ${html.length} characters`)
} finally {
  await server.close()
}
