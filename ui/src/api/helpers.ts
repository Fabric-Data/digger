import { withAuth } from '@/authkit/ssr/session';

function redirectWithFallback(redirectUri: string, headers?: Headers) {
    const newHeaders = headers ? new Headers(headers) : new Headers();
    newHeaders.set('Location', redirectUri);

    return new Response(null, { status: 307, headers: newHeaders });
  }

  function errorResponseWithFallback(errorBody: { error: { message: string; description: string } }) {
    return new Response(JSON.stringify(errorBody), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

/**
 * Requires authentication and returns session-derived user identity.
 * Use this instead of accepting userId/organizationId from client input
 * to prevent IDOR vulnerabilities.
 */
export async function requireAuth() {
  const auth = await withAuth();
  if (!auth.user) {
    throw new Error('Unauthorized');
  }
  return {
    userId: auth.user.id,
    email: auth.user.email!,
    organizationId: auth.organizationId!,
  };
}

export { redirectWithFallback, errorResponseWithFallback };