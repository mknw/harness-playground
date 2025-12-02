"use server";

import { getCurrentUser } from "~/lib/auth/session";
import { requireAllowedEmail } from "~/lib/auth/allowList";

/**
 * Retrieves and validates the authenticated user for a server function.
 * This function should be called at the beginning of any protected server function.
 * Also checks if the user's email is in the allow-list.
 *
 * @returns {Promise<{ id: string; email: string; displayName?: string }>} The user object
 * @throws {Error} If the user is not authenticated or not authorized
 */
export async function getAuthenticatedUser() {
  "use server";

  const user = await getCurrentUser();

  console.log("[getAuthenticatedUser] Stack Auth user object:", {
    hasUser: !!user,
    id: user?.id,
    primaryEmail: user?.primaryEmail,
    displayName: user?.displayName,
  });

  if (!user) {
    throw new Error("Authentication required: No user found in session.");
  }

  if (!user.primaryEmail) {
    console.warn("[getAuthenticatedUser] User has no primaryEmail:", {
      id: user.id,
      displayName: user.displayName,
    });
    throw new Error("Authentication required: User has no email address.");
  }

  // Check if user's email is in the allow-list
  requireAllowedEmail(user.primaryEmail);

  console.log(`[getAuthenticatedUser] Successfully authenticated user: ${user.displayName || user.primaryEmail}`);

  return {
    id: user.id,
    email: user.primaryEmail,
    displayName: user.displayName,
  };
}
