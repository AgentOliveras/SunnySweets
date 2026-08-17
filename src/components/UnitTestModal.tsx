import React, { useState, useEffect } from 'react';
import { FlaskConical, CheckCircle2, XCircle, RotateCcw, X, ShieldCheck } from 'lucide-react';
import { runUnitTests, TestCaseResult } from '../utils/calculator.test';

interface UnitTestModalProps {
  onClose: () => void;
  onUpdatePassCount?: (count: number) => void;
}

export const UnitTestModal: React.FC<UnitTestModalProps> = ({ onClose, onUpdatePassCount }) => {
  const [results, setResults] = useState<TestCaseResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const execute = () => {
    setIsRunning(true);
    setTimeout(() => {
      const res = runUnitTests();
      setResults(res);
      setIsRunning(false);
      const passed = res.filter((r) => r.passed).length;
      if (onUpdatePassCount) onUpdatePassCount(passed);
    }, 200);
  };

  useEffect(() => {
    execute();
  }, []);

  const totalPassed = results.filter((r) => r.passed).length;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-amber-900/20 dark:border-zinc-700 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-amber-950 dark:text-amber-100">
                Automated Verification Suite
              </h3>
              <p className="text-xs text-zinc-500">
                Unit tests for scaling, waste, unit conversions, and mixer capacity limits.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="flex items-center justify-between bg-amber-50 dark:bg-zinc-800/60 p-4 rounded-xl border border-amber-200/60 dark:border-zinc-700">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-bold text-sm text-zinc-800 dark:text-zinc-200">
                Test Suite Summary: {totalPassed} of {results.length} Passed
              </span>
            </div>
            <button
              onClick={execute}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>Re-run Tests</span>
            </button>
          </div>

          <div className="space-y-3">
            {results.map((test, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
                  test.passed
                    ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/60'
                    : 'bg-red-50/40 dark:bg-red-950/20 border-red-200 dark:border-red-900/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  {test.passed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <h4 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">{test.name}</h4>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{test.message}</p>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${
                    test.passed
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                      : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                  }`}
                >
                  {test.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl cursor-pointer"
          >
            Close Verification Panel
          </button>
        </div>
      </div>
    </div>
  );
};
