import { lazy } from 'react'

// Vite hashes asset filenames. After a deploy, an open tab still has the OLD
// index.html in memory and references chunk filenames that no longer exist on
// the server (404). When the user finally triggers the lazy import (e.g. opens
// the cake editor), the dynamic import rejects.
//
// Pattern used here: catch chunk-loading errors once, set a session flag, and
// reload. The reload pulls a fresh index.html with the new hashed filenames.
// The flag prevents an infinite loop if the failure is something else.

const RELOAD_FLAG = 'cake-editor-chunk-reload'

const EditorCanvas = lazy(() =>
  import('./EditorCanvas').catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    const name = err instanceof Error ? err.name : ''
    const isChunkError =
      name === 'ChunkLoadError' ||
      message.includes('dynamically imported module') ||
      message.includes('Failed to fetch') ||
      message.includes('Importing a module script failed')

    if (isChunkError && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1')
      window.location.reload()
      // Return a never-resolving promise so React's Suspense keeps showing the
      // fallback during the reload (no error flash).
      return new Promise<never>(() => {})
    }
    throw err
  }),
)

export default EditorCanvas
