import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  sectionTitle?: string;
  fallbackMessage?: string;
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class SettingsSectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[SettingsSectionErrorBoundary] Error in section "${this.props.sectionTitle || 'Unknown'}":`, error, errorInfo);
  }

  handleRetry = (): void => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="bg-white dark:bg-[#1E1B18] border border-red-200 dark:border-red-900/40 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1]">
                {this.props.sectionTitle || 'Settings Section'}
              </h3>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                {this.props.fallbackMessage || 'Unable to load this section. Please try again.'}
              </p>
              {this.state.error?.message && (
                <p className="text-[11px] font-mono text-[#8B7E74] dark:text-[#A39E93] mt-1 truncate">
                  Details: {this.state.error.message}
                </p>
              )}
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#FAF8F5] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] hover:bg-[#F0ECE4] text-[#5A534B] dark:text-[#EAE6E1] text-xs font-semibold rounded-lg transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
