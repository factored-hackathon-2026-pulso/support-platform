/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the platform API (no trailing slash). Default http://localhost:8000. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
