import { createSignal, onMount, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { getStackClientApp } from "~/stack/client";
import { isEmailAllowed, getUnauthorizedMessage } from "~/lib/auth/allowList";

export default function SignUp() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
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
        console.error("Auth check error:", error);
      } finally {
        setCheckingAuth(false);
      }
    })();
  });

  const handleSignUp = async (e: Event) => {
    e.preventDefault();
    setError(null);

    if (!email() || !password() || !confirmPassword()) {
      setError("Please fill in all fields");
      return;
    }

    // Check if email is in the allow-list BEFORE attempting signup
    if (!isEmailAllowed(email())) {
      setError(getUnauthorizedMessage());
      return;
    }

    if (password() !== confirmPassword()) {
      setError("Passwords do not match");
      return;
    }

    if (password().length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    setLoading(true);

    try {
      const stackClientApp = getStackClientApp();
      const result = await stackClientApp.signUpWithCredential({
        email: email(),
        password: password(),
      });

      if (result.status === 'error') {
        setError(result.error.humanReadableMessage || "Sign up failed");
      } else {
        navigate("/", { replace: true });
      }
    } catch (error) {
      console.error("Sign up error:", error);
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const stackClientApp = getStackClientApp();
      await stackClientApp.signInWithOAuth('google');
    } catch (error) {
      console.error('Google sign up failed:', error);
      setError("Failed to initialize Google sign up");
      setLoading(false);
    }
  };

  return (
    <Show when={!checkingAuth()} fallback={
      <div class="min-h-screen flex items-center justify-center bg-gray-50">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    }>
      <div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div class="w-full max-w-md bg-white rounded-lg shadow-md p-8">
          <div class="text-center mb-8">
            <img
              src="/ttc-viam-inveniemus.png"
              alt="Trepell - Viam Inveniemus"
              class="mx-auto h-32 mb-6"
            />
            <h2 class="text-3xl font-bold text-gray-900">Create Account</h2>
            <p class="mt-2 text-sm text-gray-600">Sign up to start using TTC Maker</p>
          </div>

          <Show when={error()}>
            <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p class="text-sm text-red-600">{error()}</p>
            </div>
          </Show>

          <form onSubmit={(e) => void handleSignUp(e)} class="space-y-4">
            <div>
              <label for="email" class="block text-sm font-medium text-gray-700 mb-1">
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
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
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
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p class="mt-1 text-xs text-gray-500">Must be at least 8 characters</p>
            </div>

            <div>
              <label for="confirmPassword" class="block text-sm font-medium text-gray-700 mb-1">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                disabled={loading()}
                required
                class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading()}
            >
              {loading() ? "Creating account..." : "Sign Up"}
            </button>
          </form>

          <div class="relative my-6">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-gray-300" />
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="px-2 bg-white text-gray-500">Or continue with</span>
            </div>
          </div>

          <button
            onClick={() => void handleGoogleSignUp()}
            class="w-full py-2 px-4 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading()}
          >
            Sign up with Google
          </button>

          <p class="mt-6 text-center text-sm text-gray-600">
            Already have an account?{" "}
            <A href="/auth/signin" class="font-medium text-blue-600 hover:underline">
              Sign in
            </A>
          </p>
        </div>
      </div>
    </Show>
  );
}
