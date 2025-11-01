import { A } from "@solidjs/router";

export default function AccessDenied() {
  return (
    <div class="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div class="w-full max-w-md bg-white rounded-lg shadow-md p-8">
        <div class="text-center">
          {/* Error Icon */}
          <div class="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-4">
            <svg
              class="h-10 w-10 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <h2 class="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>

          <div class="mb-6 text-left bg-gray-50 border border-gray-200 rounded-md p-4">
            <p class="text-sm text-gray-700 mb-3">
              Your account is not authorized to access this application.
            </p>
            <p class="text-sm text-gray-600 mb-3">
              Access to TTC Maker is restricted to authorized users only. If you believe you should have access, please contact the administrator.
            </p>
            <div class="border-t border-gray-300 pt-3 mt-3">
              <p class="text-xs text-gray-500 font-semibold mb-1">Need access?</p>
              <p class="text-xs text-gray-600">
                Contact your system administrator to request access to this application.
              </p>
            </div>
          </div>

          <A
            href="/auth/signin"
            class="inline-block w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Return to Sign In
          </A>
        </div>
      </div>
    </div>
  );
}
