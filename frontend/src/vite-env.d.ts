/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the platform API (no trailing slash). Unset: http://localhost:8000.
   * `/`: same origin as the SPA (deployed behind CloudFront).
   */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
