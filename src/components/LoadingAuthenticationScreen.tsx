import React, { useState, useEffect } from 'react';
import { ChefHat, Loader2, RotateCw } from 'lucide-react';

interface LoadingAuthenticationScreenProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const LoadingAuthenticationScreen: React.FC<LoadingAuthenticationScreenProps> = ({
  title = 'Sunny Sweets Platform',
  message = 'Verifying identity & workspace membership...',
  onRetry,
}) => {
  const [showRetryOption, setShowRetryOption] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowRetryOption(true);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#141210] flex items-center justify-center p-6 font-sans select-none">
      <div className="flex flex-col items-center text-center space-y-4 max-w-xs">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-[#5A534B] dark:bg-[#3D3732] flex items-center justify-center text-[#D4A373] shadow-md">
            <ChefHat className="w-7 h-7" />
          </div>
          <div className="absolute -bottom-1 -right-1 p-1 bg-white dark:bg-[#1C1A18] rounded-full shadow-xs">
            <Loader2 className="w-4 h-4 text-[#D4A373] animate-spin" />
          </div>
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-bold text-[#5A534B] dark:text-[#EAE6E1] tracking-tight">
            {title}
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            {message}
          </p>
        </div>

        {showRetryOption && onRetry && (
          <div className="pt-2 animate-fade-in">
            <button
              id="loading-retry-button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#5A534B] dark:text-[#D4A373] bg-[#EAE6E1] dark:bg-[#25221F] hover:bg-[#DDD8D1] dark:hover:bg-[#332F2B] transition-colors shadow-xs"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry Verification</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
