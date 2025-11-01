/**
 * Client-side cookie utility functions for managing Stack Auth user data
 */

/**
 * Sets a cookie with the user's email for server-side authentication
 * This is needed because Stack Auth JWT tokens don't include the email
 */
export function setAuthEmailCookie(email: string | null | undefined) {
  if (!email) return;

  // Set cookie with same expiration as Stack Auth cookies (usually 1 hour)
  const expirationDate = new Date();
  expirationDate.setHours(expirationDate.getHours() + 1);

  document.cookie = `stack-auth-email=${encodeURIComponent(email)}; path=/; expires=${expirationDate.toUTCString()}; SameSite=Lax`;
}

/**
 * Removes the auth email cookie
 */
export function removeAuthEmailCookie() {
  document.cookie = 'stack-auth-email=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax';
}

/**
 * Gets the current auth email from cookie
 */
export function getAuthEmailCookie(): string | null {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'stack-auth-email') {
      return decodeURIComponent(value);
    }
  }
  return null;
}
