import { createContext, createSignal, createResource, Show, useContext, JSX, onMount, createMemo, createEffect } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { isServer } from "solid-js/web";
import { getStackClientApp } from "~/stack/client";
import type { User } from "@stackframe/js";
import { isEmailAllowed } from "~/lib/auth/allowList";

// Auth context type
interface AuthContextType {
  user: () => User | null;
  loading: () => boolean;
  refetch: () => void;
  signOut: () => Promise<void>;
}

// Create context
const AuthContext = createContext<AuthContextType>();

// Custom hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

interface AuthProviderProps {
  children: JSX.Element;
}

export function AuthProvider(props: AuthProviderProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Use a client-only signal for mounting state
  const [mounted, setMounted] = createSignal(false);
  const [authChecked, setAuthChecked] = createSignal(false);

  // Only set mounted on client after hydration
  onMount(() => {
    setMounted(true);
  });

  // Create resource that only fetches after mounting on client
  const [user, { refetch }] = createResource(
    mounted, // Only fetch when mounted is true
    async () => {
      if (isServer) {
        setAuthChecked(true);
        return null; // Return null on server
      }

      try {
        const stackClientApp = getStackClientApp();
        const currentUser = await stackClientApp.getUser();
        setAuthChecked(true);
        return currentUser;
      } catch (error) {
        console.error("Auth check error:", error);
        setAuthChecked(true);
        return null;
      }
    },
    {
      initialValue: null // Start with null for consistent hydration
    }
  );

  // Handle auth state changes
  createEffect(() => {
    if (mounted() && authChecked() && !user.loading) {
      const currentUser = user();
      const pathname = location.pathname;
      const isAuthRoute = pathname.startsWith('/auth/');
      const isAccessDeniedRoute = pathname === '/auth/access-denied';

      // Check if authenticated user's email is allowed
      if (currentUser && !isAccessDeniedRoute) {
        const userEmail = currentUser.primaryEmail;

        if (!isEmailAllowed(userEmail)) {
          console.warn("[AuthProvider] User email not in allow-list, signing out:", userEmail);

          // Sign out the user
          void (async () => {
            try {
              await currentUser.signOut();
              setAuthChecked(false);
              void refetch();
              // Redirect to access denied page
              navigate('/auth/access-denied', { replace: true });
            } catch (error) {
              console.error("Error signing out unauthorized user:", error);
              // Still redirect to access denied even if signout fails
              navigate('/auth/access-denied', { replace: true });
            }
          })();
          return;
        }
      }

      // If user is authenticated and on auth page, redirect to home
      if (currentUser && isAuthRoute && pathname !== '/auth/callback' && !isAccessDeniedRoute) {
        console.log("[AuthProvider] User authenticated on auth page, redirecting to home");
        navigate("/", { replace: true });
      }
      // If user is not authenticated and not on auth page, redirect to signin
      else if (!currentUser && !isAuthRoute) {
        console.log("[AuthProvider] User not authenticated, redirecting to signin");
        void navigate('/auth/signin', { replace: true });
      }
    }
  });

  const signOut = async () => {
    if (isServer) return;

    try {
      const currentUser = user();
      if (currentUser) {
        await currentUser.signOut();
        setAuthChecked(false); // Reset auth check
        void refetch();
      }
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const isAuthRoute = () => {
    const pathname = location.pathname;
    return pathname.startsWith('/auth/');
  };

  // Memoize context value
  const authContextValue = createMemo<AuthContextType>(() => ({
    user,
    loading: () => mounted() && user.loading, // Only loading after mount
    refetch: () => {
      setAuthChecked(false);
      void refetch();
    },
    signOut,
  }));

  return (
    <AuthContext.Provider value={authContextValue()}>
      {/* Show content only when mounted AND (user authenticated OR on auth route) */}
      <Show
        when={mounted() && (isAuthRoute() || (user() && !user.loading))}
        fallback={
          <div class="min-h-screen flex items-center justify-center bg-gray-50">
            <div class="text-center">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <div class="text-xl font-medium text-gray-900 mb-2">
                Loading TTC Maker
              </div>
              <div class="text-gray-600">
                Please wait while we verify your authentication...
              </div>
            </div>
          </div>
        }
      >
        {props.children}
      </Show>
    </AuthContext.Provider>
  );
}
