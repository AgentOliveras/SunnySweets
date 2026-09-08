import React, { useState, useEffect } from 'react';
import { FlaskConical, CheckCircle2, XCircle, RotateCcw, X, ShieldCheck, ShieldAlert, Lock } from 'lucide-react';
import { runUnitTests, TestCaseResult } from '../utils/calculator.test';
import { runSecurityTests, SecurityTestCaseResult } from '../utils/firestore.rules.test';

interface UnitTestModalProps {
  onClose: () => void;
  onUpdatePassCount?: (count: number) => void;
}

export const UnitTestModal: React.FC<UnitTestModalProps> = ({ onClose, onUpdatePassCount }) => {
  const [activeTab, setActiveTab] = useState<'calculations' | 'security'>('calculations');
  const [calcResults, setCalcResults] = useState<TestCaseResult[]>([]);
  const [securityResults, setSecurityResults] = useState<SecurityTestCaseResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const execute = () => {
    setIsRunning(true);
    setTimeout(() => {
      const cRes = runUnitTests();
      const sRes = runSecurityTests();
      setCalcResults(cRes);
      setSecurityResults(sRes);
      setIsRunning(false);
      const passed = cRes.filter((r) => r.passed).length;
      if (onUpdatePassCount) onUpdatePassCount(passed);
    }, 200);
  };

  useEffect(() => {
    execute();
  }, []);

  const totalCalcPassed = calcResults.filter((r) => r.passed).length;
  const totalSecurityPassed = securityResults.filter((r) => r.passed).length;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 border border-amber-900/20 dark:border-zinc-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
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
                Continuous verification of recipe formulas and Zero-Trust database invariants.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-lg cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-800 px-6 pt-3 gap-4">
          <button
            onClick={() => setActiveTab('calculations')}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-colors ${
              activeTab === 'calculations'
                ? 'border-amber-600 text-amber-700 dark:text-amber-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <FlaskConical className="w-4 h-4" />
            <span>Calculation Logic ({totalCalcPassed}/{calcResults.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`pb-3 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-colors ${
              activeTab === 'security'
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Policy Simulation Unit Tests ({totalSecurityPassed}/{securityResults.length})</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'security' && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-800 dark:text-amber-200">
              <span className="font-bold">In-Memory Policy Simulation: </span>
              These unit tests evaluate Zero-Trust invariants inside a JavaScript test harness.
              Real Firestore Security Rules tests are configured in <code className="px-1 py-0.5 rounded bg-amber-200/50 dark:bg-amber-900/50 font-mono text-[11px]">tests/firestore.rules.spec.ts</code>.
            </div>
          )}

          <div className="flex items-center justify-between bg-amber-50 dark:bg-zinc-800/60 p-4 rounded-xl border border-amber-200/60 dark:border-zinc-700">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-bold text-sm text-zinc-800 dark:text-zinc-200">
                {activeTab === 'calculations'
                  ? `Calculation Suite: ${totalCalcPassed} of ${calcResults.length} Passed`
                  : `Policy Simulation Tests: ${totalSecurityPassed} of ${securityResults.length} Invariants Evaluated`}
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

          {activeTab === 'calculations' && (
            <div className="space-y-3">
              {calcResults.map((test, idx) => (
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
          )}

          {activeTab === 'security' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-900 dark:text-amber-200">
                <strong>Mode B: Policy Simulation Only.</strong> This in-browser security runner verifies that all client-side operations enforce Zero-Trust invariants, role checks, and auth gates. For real live Firestore security rules evaluation via the Firebase Emulator suite, execute <code className="bg-amber-500/20 px-1 py-0.5 rounded font-mono">npm run test:rules:emulator</code>.
              </div>
              {securityResults.map((test) => (
                <div
                  key={test.id}
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
                      <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-zinc-800 dark:text-zinc-200">
                          {test.id}
                        </span>
                        <h4 className="font-bold text-xs text-zinc-900 dark:text-zinc-100">{test.name}</h4>
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{test.threatMitigation}</p>
                      <p className="text-[11px] text-zinc-500 font-mono mt-1">{test.details}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase ${
                        test.passed
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}
                    >
                      {test.passed ? 'SECURE' : 'FAIL'}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      Expect: {test.expectedResult}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
