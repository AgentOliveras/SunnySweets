import React from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSettingsSectionProps {
  id?: string;
  sectionKey: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  className?: string;
}

export const CollapsibleSettingsSection: React.FC<CollapsibleSettingsSectionProps> = ({
  id,
  sectionKey,
  title,
  description,
  icon,
  badge,
  isOpen,
  onToggle,
  children,
  className = '',
}) => {
  return (
    <div
      id={id || `settings-section-${sectionKey}`}
      className={`bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl shadow-xs transition-all ${className}`}
    >
      <button
        type="button"
        id={`btn-toggle-section-${sectionKey}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left cursor-pointer min-h-[52px] rounded-xl hover:bg-[#FAF8F5]/60 dark:hover:bg-[#25221F]/60 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/20"
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#EAE6E1] flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-serif font-semibold text-base text-[#5A534B] dark:text-[#EAE6E1] leading-tight truncate">
              {title}
            </h3>
            {description && (
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 line-clamp-1 sm:line-clamp-2">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 ml-2">
          {badge && <div className="hidden sm:block">{badge}</div>}
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1]">
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-5 sm:px-6 sm:pb-6 pt-1 border-t border-[#EEECE8] dark:border-[#2D2925] space-y-4 animate-in fade-in-50 duration-150">
          {badge && <div className="sm:hidden pt-2">{badge}</div>}
          {children}
        </div>
      )}
    </div>
  );
};
