import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  RotateCcw,
  Undo2,
  Check,
  Play,
  ArrowLeft,
  AlertTriangle,
  ChefHat,
  Sparkles,
} from 'lucide-react';
import { CalculationResult, CalculatedIngredient } from '../types';
import { formatNumber } from '../utils/units';
import { store } from '../services/store';

interface GuidedMixingModeProps {
  calculation: CalculationResult;
  onExit: () => void;
  decimalPlaces?: number;
}

export const GuidedMixingMode: React.FC<GuidedMixingModeProps> = ({ calculation, onExit, decimalPlaces }) => {
  const [currentBatch, setCurrentBatch] = useState(1);
  const totalBatches = calculation.suggestedBatches || 1;

  // Track checked ingredient IDs
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  // History stack for Undo
  const [actionHistory, setActionHistory] = useState<string[]>([]);
  // Accidental completion toast feedback
  const [lastToggledName, setLastToggledName] = useState<string | null>(null);

  // Load saved active checklist progress from store if available
  useEffect(() => {
    const saved = store.getActiveChecklist();
    if (saved && (saved.recipeName === calculation.recipe.name || saved.calculation?.recipe?.name === calculation.recipe.name)) {
      if (saved.completedIngredientIds) setCompletedIds(saved.completedIngredientIds);
      if (saved.currentBatch) setCurrentBatch(saved.currentBatch);
    }
  }, [calculation]);

  // Save active checklist state whenever completedIds or batch changes
  useEffect(() => {
    store.setActiveChecklist({
      recipeName: calculation.recipe.name,
      totalBatches,
      currentBatch,
      completedIngredientIds: completedIds,
      calculation,
    });
  }, [completedIds, currentBatch, calculation, totalBatches]);

  const handleToggleIngredient = (ing: CalculatedIngredient) => {
    const isCompleted = completedIds.includes(ing.id);
    let next: string[];

    if (isCompleted) {
      next = completedIds.filter((id) => id !== ing.id);
    } else {
      next = [...completedIds, ing.id];
    }

    setCompletedIds(next);
    setActionHistory([...actionHistory, ing.id]);
    setLastToggledName(ing.name);

    setTimeout(() => {
      setLastToggledName(null);
    }, 2500);
  };

  const handleUndo = () => {
    if (actionHistory.length === 0) return;
    const lastId = actionHistory[actionHistory.length - 1];
    const nextHistory = actionHistory.slice(0, -1);

    if (completedIds.includes(lastId)) {
      setCompletedIds(completedIds.filter((id) => id !== lastId));
    } else {
      setCompletedIds([...completedIds, lastId]);
    }

    setActionHistory(nextHistory);
  };

  const handleReset = () => {
    setCompletedIds([]);
    setActionHistory([]);
    setCurrentBatch(1);
    store.setActiveChecklist({
      recipeName: calculation.recipe.name,
      totalBatches,
      currentBatch: 1,
      completedIngredientIds: [],
      calculation,
    });
    setLastToggledName('Checklist reset to beginning');
    setTimeout(() => {
      setLastToggledName(null);
    }, 2500);
  };

  const handleDiscardRun = () => {
    store.clearActiveChecklist();
    onExit();
  };

  const handleCompleteBatch = () => {
    if (currentBatch < totalBatches) {
      setCurrentBatch(currentBatch + 1);
      setCompletedIds([]);
      setActionHistory([]);
    } else {
      store.clearActiveChecklist();
      onExit();
    }
  };

  const totalIngredientsCount = calculation.calculatedIngredients.length;
  const progressPercent =
    totalIngredientsCount > 0
      ? Math.round((completedIds.length / totalIngredientsCount) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 bg-[#FDFCFB] dark:bg-[#141210] flex flex-col overflow-hidden">
      {/* Top Touch Header Bar */}
      <header className="bg-[#5A534B] dark:bg-[#1E1B18] text-white p-4 flex items-center justify-between shadow-md shrink-0 border-b border-[#47413A] dark:border-[#2D2925]">
        <div className="flex items-center gap-3">
          <button
            onClick={onExit}
            className="p-2 bg-[#47413A] dark:bg-[#25221F] hover:bg-[#3D3732] rounded-xl transition cursor-pointer"
          >
            <ArrowLeft className="w-6 h-6 text-[#EAE6E1]" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <ChefHat className="w-4 h-4 text-[#D4A373]" />
              <span className="text-xs font-semibold text-[#D4CEC7] uppercase tracking-wider">
                Guided Mixing Checklist
              </span>
            </div>
            <h2 className="font-serif font-bold text-lg leading-tight text-white">{calculation.recipe.name}</h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Batch Selector if multi-batch */}
          {totalBatches > 1 && (
            <div className="bg-[#47413A] dark:bg-[#25221F] border border-[#6B635A] dark:border-[#332F2B] px-3 py-1.5 rounded-xl text-xs font-bold text-[#EAE6E1] flex items-center gap-2 font-mono">
              <span>Batch {currentBatch} of {totalBatches}</span>
            </div>
          )}
          <button
            onClick={handleDiscardRun}
            title="Discard this session"
            className="px-3 py-1.5 bg-[#47413A] hover:bg-red-900/40 text-red-200 border border-red-500/30 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Discard
          </button>
        </div>
      </header>

      {/* Touch Progress Bar */}
      <div className="bg-[#F5F2ED] dark:bg-[#1E1B18] px-4 py-3 shrink-0 border-b border-[#E5E1DA] dark:border-[#2D2925] flex items-center gap-4">
        <div className="flex-1 bg-[#EEECE8] dark:bg-[#25221F] h-4 rounded-full overflow-hidden p-0.5 border border-[#E5E1DA] dark:border-[#332F2B]">
          <div
            className="bg-[#D4A373] h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="font-bold text-sm text-[#5A534B] dark:text-[#EAE6E1] min-w-[50px] text-right font-mono">
          {progressPercent}%
        </span>
      </div>

      {/* Undo Toast Banner */}
      {lastToggledName && (
        <div className="bg-[#2D2926] text-white px-4 py-2 text-xs flex items-center justify-between shrink-0 shadow-inner">
          <span>Updated: <strong>{lastToggledName}</strong></span>
          <button
            onClick={handleUndo}
            className="text-[#D4A373] font-bold underline flex items-center gap-1 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
            <span>Undo</span>
          </button>
        </div>
      )}

      {/* Touch Checklist Main Body */}
      <main className="flex-1 overflow-y-auto p-4 space-y-3">
        {totalBatches > 1 && (
          <div className="bg-[#F9F8F6] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] rounded-xl p-3 text-xs text-[#5A534B] dark:text-[#EAE6E1] font-medium">
            💡 Showing ingredient quantities scaled for <strong>Batch {currentBatch}</strong> of {totalBatches}.
          </div>
        )}

        <div className="space-y-3">
          {calculation.calculatedIngredients.map((ing) => {
            const isDone = completedIds.includes(ing.id);
            const batchAmount = totalBatches > 1 ? ing.perBatchQuantity : ing.requiredQuantity;

            return (
              <div
                key={ing.id}
                id={`guided-ing-${ing.id}`}
                onClick={() => handleToggleIngredient(ing)}
                className={`w-full p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-4 select-none min-h-[72px] ${
                  isDone
                    ? 'bg-[#F9F8F6]/60 dark:bg-[#1E1B18]/60 border-[#E5E1DA] dark:border-[#2D2925] opacity-60'
                    : 'bg-white dark:bg-[#1E1B18] border-[#E5E1DA] dark:border-[#2D2925] shadow-sm hover:border-[#D4A373]'
                }`}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      isDone
                        ? 'bg-[#5A534B] text-white'
                        : 'border-2 border-[#D4A373] text-[#D4A373]'
                    }`}
                  >
                    {isDone ? <Check className="w-6 h-6 stroke-[3]" /> : <Circle className="w-5 h-5" />}
                  </div>

                  <div className="flex-1">
                    <h3
                      className={`font-serif font-semibold text-base ${
                        isDone
                          ? 'line-through text-[#A39E93] dark:text-[#A39E93]'
                          : 'text-[#5A534B] dark:text-[#EAE6E1]'
                      }`}
                    >
                      {ing.name}
                    </h3>
                    {ing.notes && (
                      <p className="text-xs text-[#8B7E74] dark:text-[#A39E93] mt-0.5 font-medium">
                        {ing.notes}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`font-mono font-bold text-lg ${
                      isDone ? 'text-[#A39E93]' : 'text-[#D4A373]'
                    }`}
                  >
                    {formatNumber(batchAmount || 0, decimalPlaces !== undefined ? decimalPlaces : 2)} {ing.requiredUnit}
                  </div>
                  {ing.wastePercent > 0 && (
                    <span className="text-[10px] text-[#A39E93]">Includes {ing.wastePercent}% waste</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Bottom Large Touch Controls Bar */}
      <footer className="bg-white dark:bg-[#1E1B18] p-4 border-t border-[#E5E1DA] dark:border-[#2D2925] flex items-center justify-between gap-3 shrink-0 shadow-lg">
        <div className="flex items-center gap-2">
          <button
            id="guided-undo-btn"
            disabled={actionHistory.length === 0}
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-4 py-3 bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-bold rounded-xl text-xs disabled:opacity-30 transition cursor-pointer min-h-[48px]"
          >
            <Undo2 className="w-4 h-4" />
            <span>Undo</span>
          </button>

          <button
            id="guided-reset-btn"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3.5 py-3 bg-[#F5F2ED] dark:bg-[#25221F] text-[#5A534B] dark:text-[#EAE6E1] font-semibold rounded-xl text-xs transition cursor-pointer min-h-[48px]"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset</span>
          </button>
        </div>

        <button
          id="guided-complete-btn"
          onClick={handleCompleteBatch}
          className="flex-1 max-w-xs flex items-center justify-center gap-2 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold py-3.5 px-5 rounded-xl shadow-md text-sm transition cursor-pointer min-h-[48px]"
        >
          <CheckCircle2 className="w-5 h-5 text-[#D4A373]" />
          <span>
            {currentBatch < totalBatches ? `Finish Batch ${currentBatch}` : 'Complete Production Run'}
          </span>
        </button>
      </footer>
    </div>
  );
};

