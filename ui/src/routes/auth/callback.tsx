import { onMount, createSignal, Show } from "solid-js";
import { getStackClientApp } from "~/stack/client";

export default function OAuthCallback() {
  const [processing, setProcessing] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    void (async () => {
      try {
        const stackClientApp = getStackClientApp();

        // Process OAuth callback
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const error_param = params.get('error');

        if (error_param) {
          throw new Error(`OAuth error: ${error_param}`);
        }

        if (code && state) {
          const user = await stackClientApp.callOAuthCallback();
          if (user) {
            // Use window.location for a full page refresh to update auth state
            window.location.href = "/";
          } else {
            throw new Error("OAuth callback completed but no user returned");
          }
        } else {
          // Check if user is already authenticated (in case of page refresh)
          const existingUser = await stackClientApp.getUser();
          if (existingUser) {
            window.location.href = "/";
            return;
          }
          throw new Error("Missing OAuth parameters");
        }
      } catch (err) {
        console.error('OAuth callback error:', err);
        const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
        setError(errorMessage);

        // Redirect to signin after error
        setTimeout(() => {
          window.location.href = "/auth/signin";
        }, 3000);
      } finally {
        setProcessing(false);
      }
    })();
  });

  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50">
      <div class="text-center">
        <Show
          when={!error()}
          fallback={
            <div class="max-w-md mx-auto">
              <div class="text-red-500 text-xl mb-4">Authentication Error</div>
              <div class="text-gray-600 mb-4">{error()}</div>
              <div class="text-sm text-gray-500">
                Redirecting to sign in page...
              </div>
            </div>
          }
        >
          <Show
            when={processing()}
            fallback={
              <div class="text-green-500 text-xl">
                Authentication successful! Redirecting...
              </div>
            }
          >
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <div class="text-xl font-medium text-gray-900 mb-2">
              Completing Authentication
            </div>
            <div class="text-gray-600">
              Please wait while we sign you in...
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
