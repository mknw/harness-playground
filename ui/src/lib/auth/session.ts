"use server";

import { StackServerApp, type User } from '@stackframe/js';
import { getRequestEvent } from 'solid-js/web';

/**
 * Retrieves the current Stack Auth user from the server context.
 * This creates a new StackServerApp instance for each request to properly
 * handle authentication in server functions.
 *
 * @returns {Promise<User | null>} The authenticated user or null
 */
export async function getCurrentUser(): Promise<User | null> {
  "use server";

  const event = getRequestEvent();

  if (!event) {
    console.error("[getCurrentUser] No request event found. This function must be called within a server context.");
    return null;
  }

  try {
    // Create a new StackServerApp instance for this specific request context
    const stackServerApp = new StackServerApp({
      tokenStore: event.request,
      secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
      projectId: import.meta.env.VITE_STACK_PROJECT_ID,
      publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
    });
    console.log("[getCurrentUser] Credentials are: ", {
      secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
      projectId: import.meta.env.VITE_STACK_PROJECT_ID,
      publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
    });

    const user = await stackServerApp.getUser();

    console.log("[getCurrentUser] Retrieved user from Stack Auth:", {
      hasUser: !!user,
      userId: user?.id,
      primaryEmail: user?.primaryEmail,
      displayName: user?.displayName,
    });

    return user;
  } catch (error) {
    console.error("[getCurrentUser] Error while retrieving user:", error);
    console.error("[getCurrentUser] Error details:", {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
}
