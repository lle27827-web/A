import { SessionRestoringError } from './auth-session';

/**
 * Clerk remains the token issuer and the API remains the verifier.
 * Never persist tokens or attach them to external URLs/static asset requests.
 */
export function createWebSessionTokenGetter(
  getToken: () => Promise<string | null>,
  origin: string,
  isCurrent: () => boolean,
) {
  return async (requestUrl: string): Promise<string | null> => {
    const target = new URL(requestUrl, origin);
    if (target.origin !== origin || !(target.pathname === '/api' || target.pathname.startsWith('/api/'))) {
      return null;
    }
    if (!isCurrent()) throw new SessionRestoringError();
    const token = await getToken();
    // Signing out/switching accounts while a token is loading must not send an
    // earlier account's credentials or silently downgrade the request to guest.
    if (!isCurrent() || !token) throw new SessionRestoringError();
    return token;
  };
}
