import React from 'react';
import { ChefHat, Loader2 } from 'lucide-react';

export const LoadingAuthenticationScreen: React.FC = () => {
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
            Sunny Sweets Platform
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Verifying identity & workspace membership...
          </p>
        </div>
      </div>
    </div>
  );
};
