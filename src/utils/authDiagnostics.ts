/**
 * Authentication & Session Connectivity Diagnostics
 *
 * Maps Firebase Authentication popup errors and post-sign-in Firestore
 * session bootstrap errors into clear, actionable messages while always
 * preserving the exact underlying Firebase error code for field diagnostics
 * (e.g., on production floor tablets running Chrome or Samsung Internet).
 */

export interface AuthErrorDiagnostic {
  code: string;
  title: string;
  message: string;
  tabletHint?: string;
}

export function extractFirebaseErrorCode(err: unknown, fallback = 'auth/unknown-error'): string {
  if (err && typeof err === 'object') {
    const rawCode = (err as { code?: unknown }).code;
    if (typeof rawCode === 'string' && rawCode.trim().length > 0) {
      return rawCode.trim();
    }
  }
  return fallback;
}

export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message.trim();
  }
  if (typeof err === 'string' && err.trim().length > 0) {
    return err.trim();
  }
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim().length > 0) {
      return msg.trim();
    }
  }
  return fallback;
}

/**
 * Formats any error thrown by Google popup sign-in into a user-facing banner
 * payload that always includes the exact Firebase error code.
 */
export function formatGoogleSignInError(err: unknown): AuthErrorDiagnostic {
  const code = extractFirebaseErrorCode(err, 'auth/unknown-error');
  const rawMessage = extractErrorMessage(
    err,
    'Google sign-in could not be completed. Please check your connection and try again.'
  );

  if (/database is closing\/hidden/i.test(rawMessage)) {
    const effectiveCode =
      code === 'auth/unknown-error' ? 'auth/indexeddb-closing-hidden' : code;
    return {
      code: effectiveCode,
      title: 'Browser storage interrupted during sign-in',
      message:
        'Browser session storage closed or became hidden while opening the Google sign-in window (Database is closing/hidden). Keep this browser tab active in the foreground, close any stuck Google sign-in tabs, and tap Sign in with Google again.',
      tabletHint:
        'On Samsung tablets (Chrome or Samsung Internet), avoid switching apps, minimizing the browser, or locking the screen while the sign-in window opens, and verify Secret/Incognito mode is off with site data and cookies allowed.',
    };
  }

  switch (code) {
    case 'auth/popup-closed-by-user':
      return {
        code,
        title: 'Sign-in window closed before completion',
        message:
          'The Google sign-in window closed before an account was confirmed. Please tap Sign in with Google and select your authorized account.',
        tabletHint:
          'If the window closed on its own on a tablet, check that pop-ups, third-party cookies, and site data are allowed for this domain and that you are not in Secret/Incognito mode.',
      };

    case 'auth/popup-blocked':
      return {
        code,
        title: 'Sign-in pop-up was blocked by the browser',
        message:
          'Your browser blocked the Google sign-in window from opening. Allow pop-ups and redirects for this site in your browser settings, then try again.',
        tabletHint:
          'In Chrome or Samsung Internet, open Site Settings for this address and set Pop-ups and redirects to Allowed.',
      };

    case 'auth/cancelled-popup-request':
      return {
        code,
        title: 'Duplicate sign-in window cancelled',
        message:
          'Another Google sign-in window was already opening. Wait a moment and tap Sign in with Google once.',
      };

    case 'auth/web-storage-unsupported':
    case 'auth/operation-not-supported-in-this-environment':
      return {
        code,
        title: 'Browser storage or cookies are restricted',
        message:
          'Google sign-in requires browser storage and cookies to stay enabled. Disable Secret/Private browsing and allow site data/cookies for this site.',
        tabletHint:
          'In Samsung Internet, verify Smart Anti-Tracking is not blocking Google sign-in cookies and Secret Mode is turned off.',
      };

    case 'auth/network-request-failed':
      return {
        code,
        title: 'Network connection failed during sign-in',
        message:
          'Unable to reach Google Authentication services. Verify Wi-Fi connectivity on this device and try again.',
      };

    case 'auth/unauthorized-domain':
      return {
        code,
        title: 'Domain not authorized for Firebase Sign-In',
        message:
          'This application URL is not listed in Firebase Authentication Authorized Domains. Contact the workspace administrator.',
      };

    case 'auth/user-disabled':
      return {
        code,
        title: 'Account disabled',
        message:
          'This Google account has been disabled in Firebase Authentication. Contact the workspace owner.',
      };

    case 'auth/internal-error':
      return {
        code,
        title: 'Browser authentication session error',
        message:
          'Google Authentication encountered an internal browser error. Close any stuck sign-in tabs, ensure cookies/pop-ups are allowed, and try again.',
        tabletHint:
          'On Android tablets, clearing stuck site data for firebaseapp.com / google.com or allowing third-party cookies for sign-in often resolves internal popup failures.',
      };

    default:
      return {
        code,
        title: 'Google sign-in failed',
        message: rawMessage,
      };
  }
}

/**
 * Formats a post-authentication workspace discovery or membership verification
 * failure into a retryable initialization message with its diagnostic code.
 */
export function formatWorkspaceBootstrapError(err: unknown, phase: 'discovery' | 'membership'): string {
  const code = extractFirebaseErrorCode(err, 'firestore/session-bootstrap-failed');
  const detail = extractErrorMessage(err, 'Cloud Firestore request failed.');
  const prefix =
    phase === 'discovery'
      ? 'Signed in, but workspace discovery could not be completed due to a cloud or network error.'
      : 'Signed in, but workspace membership could not be verified due to a cloud or network error.';
  return `${prefix} (${code}: ${detail})`;
}
