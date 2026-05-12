import { createSignal, onMount, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { getStackClientApp } from "~/lib/auth/client";
import { isEmailAllowed, getUnauthorizedMessage } from "~/lib/auth/allowList";

export default function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [checkingAuth, setCheckingAuth] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    void (async () => {
      // Check if user is already signed in
      try {
        const stackClientApp = getStackClientApp();
        const user = await stackClientApp.getUser();
        if (user) {
          navigate("/", { replace: true });
        }
      } catch (error) {
        console.error("-- Auth check error:", error);
      } finally {
        setCheckingAuth(false);
      }
    })();
  });

  const handleEmailSignIn = async (e: Event) => {
    e.preventDefault();
    setError(null);

    if (!email() || !password()) {
      setError("Please enter both email and password");
      return;
    }

    // Check if email is in the allow-list BEFORE attempting signin
    if (!isEmailAllowed(email())) {
      setError(getUnauthorizedMessage());
      return;
    }

    setLoading(true);

    try {
      const stackClientApp = getStackClientApp();
      const result = await stackClientApp.signInWithCredential({
        email: email(),
        password: password(),
      });

      if (result.status === 'error') {
        setError(result.error.humanReadableMessage || "Invalid credentials");
      } else {
        navigate("/", { replace: true });
      }
    } catch (error) {
      console.error("Sign in error:", error);
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const stackClientApp = getStackClientApp();
      await stackClientApp.signInWithOAuth('google');
    } catch (error) {
      console.error('Google sign in failed:', error);
      setError("Failed to initialize Google sign in");
      setLoading(false);
    }
  };

  const handleMicrosoftSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const stackClientApp = getStackClientApp();
      await stackClientApp.signInWithOAuth('microsoft');
    } catch (error) {
      console.error('Microsoft sign in failed:', error);
      setError("Failed to initialize Microsoft sign in");
      setLoading(false);
    }
  };

  return (
    <Show when={!checkingAuth()} fallback={
      <div class="bg-gray-50 flex min-h-screen items-center justify-center">
        <div class="border-b-2 border-blue-600 rounded-full h-12 w-12 animate-spin" />
      </div>
    }>
      <div class="px-4 py-12 bg-gray-50 flex min-h-screen items-center justify-center lg:px-8 sm:px-6">
        <div class="p-8 rounded-lg bg-white max-w-md w-full shadow-md">
          <div class="mb-8 text-center">
            <img
              src="/seederis.ai.png"
              alt="seederis.ai — build with purpose."
              class="mx-auto mb-6 h-32"
            />
            <h2 class="text-3xl text-gray-900 font-bold">seederis.ai Knowledge System</h2>
            <p class="text-sm text-gray-600 mt-2">Sign in to your account to continue</p>
          </div>

          <Show when={error()}>
            <div class="mb-4 p-3 border border-red-200 rounded-md bg-red-50">
              <p class="text-sm text-red-600">{error()}</p>
            </div>
          </Show>

          <form onSubmit={(e) => void handleEmailSignIn(e)} class="space-y-4">
            <div>
              <label for="email" class="text-sm text-gray-700 font-medium mb-1 block">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                disabled={loading()}
                required
                class="px-3 py-2 border border-gray-300 rounded-md w-full shadow-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label for="password" class="text-sm text-gray-700 font-medium mb-1 block">
                Password
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                disabled={loading()}
                required
                class="px-3 py-2 border border-gray-300 rounded-md w-full shadow-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              class="text-white font-medium px-4 py-2 rounded-md bg-blue-600 w-full shadow-sm focus:outline-none hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              disabled={loading()}
            >
              {loading() ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <div class="my-6 relative">
            <div class="flex items-center inset-0 absolute">
              <div class="border-t border-gray-300 w-full" />
            </div>
            <div class="text-sm flex justify-center relative">
              <span class="text-gray-500 px-2 bg-white">Or continue with</span>
            </div>
          </div>

          <button
            onClick={() => void handleGoogleSignIn()}
            class="text-gray-700 font-medium px-4 py-2 border border-gray-300 rounded-md bg-white w-full shadow-sm focus:outline-none hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            disabled={loading()}
          >
            Sign in with Google
          </button>

          <button
            onClick={() => void handleMicrosoftSignIn()}
            class="text-gray-700 font-medium mt-3 px-4 py-2 border border-gray-300 rounded-md bg-white w-full shadow-sm focus:outline-none hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            disabled={loading()}
          >
            Sign in with Microsoft
          </button>

          <p class="text-sm text-gray-600 mt-6 text-center">
            Don't have an account?{" "}
            <A href="/auth/signup" class="text-blue-600 font-medium hover:underline">
              Sign up
            </A>
          </p>
        </div>
      </div>
    </Show>
  );
}
