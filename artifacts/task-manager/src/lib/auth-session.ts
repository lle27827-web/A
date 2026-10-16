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
