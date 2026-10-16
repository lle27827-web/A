import type { AuthStatus } from '@workspace/api-client-react';

export class SessionRestoringError extends Error {
  constructor() {
    super('Phiên đăng nhập chưa được máy chủ xác minh.');
    this.name = 'SessionRestoringError';
  }
}

/** Never interpret a restored Clerk session as a guest while cookies are synchronizing. */
export function validateRestoredSession(status: AuthStatus, signedIn: boolean): AuthStatus {
  if (signedIn && !status.authenticated) throw new SessionRestoringError();
  // A stale server response must not grant access after Clerk signs the user out.
  if (!signedIn && status.authenticated) throw new SessionRestoringError();
  return status;
}

export function retrySessionCheck(failureCount: number, error: unknown): boolean {
  return failureCount < (error instanceof SessionRestoringError ? 3 : 1);
}

/** Only local, explicitly supported destinations may follow authentication. */
export function postAuthPath(search: string): '/' | '/personal' {
  return new URLSearchParams(search).get('next') === 'personal' ? '/personal' : '/';
}

export function sessionScreen(state: {
  loaded: boolean; signedIn: boolean; pending: boolean; error: boolean; publicPath: boolean;
}): 'loading' | 'error' | 'ready' {
  if (!state.loaded || (state.pending && (state.signedIn || !state.publicPath))) return 'loading';
  // This includes sign-in/up: their SDK widgets may render nothing for an
  // existing session, so a verification failure must remain visible there.
  if (state.signedIn && state.error) return 'error';
  return 'ready';
}
