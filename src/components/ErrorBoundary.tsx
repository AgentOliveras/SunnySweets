import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCw, ShieldAlert } from 'lucide-react';
import { store } from '../services/store';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Development preview may log stack trace to console
    console.error('[ErrorBoundary] Caught runtime component exception:', error, errorInfo);
  }

  private handleRetry = async (): Promise<void> => {
    try {
      await store.recheckAccess();
    } catch (e) {
      console.warn('[ErrorBoundary] Error during recheckAccess:', e);
    }
    this.setState({ hasError: false, error: null });
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          id="app-error-boundary"
          className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-6 font-sans select-none"
        >
          <div className="max-w-md w-full bg-white dark:bg-[#1E1B18] rounded-2xl p-6 sm:p-8 border border-[#EAE6E1] dark:border-[#332F2B] shadow-lg text-center space-y-5">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-bold text-[#5A534B] dark:text-[#EAE6E1]">
                Something went wrong while loading the application.
              </h2>
              <p className="text-sm text-[#8B7E74] dark:text-[#A39E93] leading-relaxed">
                An unexpected interface error occurred. Please click below to refresh and re-evaluate your application state.
              </p>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                id="error-boundary-retry-button"
                onClick={this.handleRetry}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#5A534B] hover:bg-[#48423C] dark:bg-[#D4A373] dark:text-[#1E1B18] dark:hover:bg-[#C29263] transition-colors shadow-xs"
              >
                <RotateCw className="w-4 h-4" />
                <span>Retry</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
