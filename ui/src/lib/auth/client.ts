import { StackClientApp } from '@stackframe/js';

// Create and export a single instance of StackClientApp
// This will be used throughout the client-side code
let stackClientApp: StackClientApp | null = null;

export function getStackClientApp(): StackClientApp {
  // Lazy initialization - only create when needed and in browser
  if (!stackClientApp && typeof window !== 'undefined') {
    stackClientApp = new StackClientApp({
      tokenStore: 'cookie',
      projectId: import.meta.env.VITE_STACK_PROJECT_ID as string,
      publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY as string,
      urls: {
        signIn: '/auth/signin',
        signUp: '/auth/signup',
        oauthCallback: window.location.origin + '/auth/callback',
        afterSignOut: '/auth/signin',
      },
    });
  }

  if (!stackClientApp) {
    throw new Error('Stack Auth client can only be initialized on the client side');
  }

  return stackClientApp;
}

// Re-export as a getter for consistency with server.ts
export { getStackClientApp as stackClientApp };
