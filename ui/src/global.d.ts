/// <reference types="@solidjs/start/env" />

declare namespace NodeJS {
  interface ProcessEnv {
    MISTRAL_API_KEY: string;
    STACK_SECRET_SERVER_KEY: string;
  }
}

interface ImportMetaEnv {
  readonly VITE_STACK_PROJECT_ID: string;
  readonly VITE_STACK_PUBLISHABLE_CLIENT_KEY: string;
  readonly VITE_ALLOWED_EMAILS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
