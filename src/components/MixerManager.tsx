import React, { useState } from 'react';
import { Scale, Plus, Edit2, Trash2, ShieldAlert, X } from 'lucide-react';
import { Mixer, WeightUnit } from '../types';
import { WEIGHT_UNITS } from '../utils/units';

interface MixerManagerProps {
  mixers: Mixer[];
  onSaveMixer: (mixer: Mixer) => void;
  onDeleteMixer: (id: string) => void;
}

export const MixerManager: React.FC<MixerManagerProps> = ({
  mixers,
  onSaveMixer,
  onDeleteMixer,
}) => {
  const [editingMixer, setEditingMixer] = useState<Mixer | null>(null);

  const handleCreateNew = () => {
    setEditingMixer({
      id: `mixer-${Date.now()}`,
      userId: '',
      name: '',
      maxWeight: 80,
      weightUnit: 'lb',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMixer) return;
    if (!editingMixer.name.trim()) {
      alert('Please enter a mixer name.');
      return;
    }
    onSaveMixer(editingMixer);
    setEditingMixer(null);
  };

  return (
    <div className="space-y-6 pb-20 md:pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-[#5A534B] dark:text-[#EAE6E1] flex items-center gap-2">
            <Scale className="w-6 h-6 text-[#D4A373]" />
            <span>Mixer Equipment Capacities</span>
          </h2>
          <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
            Configure bakery mixer safe batch weight thresholds to prevent motor strain and bowl overflow.
          </p>
        </div>

        <button
          id="mixer-add-btn"
          onClick={handleCreateNew}
          className="inline-flex items-center justify-center gap-2 bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] text-white font-bold px-4 py-2.5 rounded-xl text-sm transition shadow-sm cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Mixer</span>
        </button>
      </div>

      {/* Mixer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mixers.map((mixer) => (
          <div
            key={mixer.id}
            id={`mixer-card-${mixer.id}`}
            className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="p-2 rounded-xl bg-[#F5F2ED] dark:bg-[#25221F] border border-[#E5E1DA] dark:border-[#332F2B] text-[#5A534B] dark:text-[#D4CEC7]">
                  <Scale className="w-5 h-5 text-[#D4A373]" />
                </span>
                <span className="text-xs font-bold text-[#C97B63] bg-[#FDF2F0] dark:bg-[#2C1916] px-2.5 py-1 rounded-full border border-[#F5C2B5] dark:border-[#4D241D] flex items-center gap-1 font-mono">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Max {mixer.maxWeight} {mixer.weightUnit.toUpperCase()}
                </span>
              </div>

              <h3 className="font-serif font-semibold text-lg text-[#5A534B] dark:text-[#EAE6E1] mb-1">
                {mixer.name}
              </h3>
              <p className="text-xs text-[#8B7E74] dark:text-[#A39E93]">
                Safe batch capacity limit for automated split calculations.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-[#EEECE8] dark:border-[#332F2B]">
              <button
                id={`mixer-edit-btn-${mixer.id}`}
                onClick={() => setEditingMixer(mixer)}
                className="p-1.5 text-[#8B7E74] hover:text-[#5A534B] hover:bg-[#F5F2ED] dark:hover:bg-[#25221F] rounded-lg transition cursor-pointer"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                id={`mixer-delete-btn-${mixer.id}`}
                onClick={() => {
                  if (confirm(`Delete mixer "${mixer.name}"?`)) {
                    onDeleteMixer(mixer.id);
                  }
                }}
                className="p-1.5 text-[#C97B63] hover:text-red-700 hover:bg-[#FDF2F0] dark:hover:bg-[#2C1916] rounded-lg transition cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Mixer Modal */}
      {editingMixer && (
        <div className="fixed inset-0 z-50 bg-[#2D2926]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#1E1B18] border border-[#E5E1DA] dark:border-[#2D2925] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-between">
              <h3 className="font-serif font-semibold text-lg text-[#5A534B] dark:text-[#EAE6E1]">
                {editingMixer.id.includes('mixer-') ? 'Add Mixer Capacity' : 'Edit Mixer'}
              </h3>
              <button onClick={() => setEditingMixer(null)} className="p-1.5 text-[#A39E93] hover:text-[#5A534B] rounded-lg cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                  Mixer Equipment Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Hobart 60-Qt Commercial Mixer"
                  value={editingMixer.name}
                  onChange={(e) => setEditingMixer({ ...editingMixer, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Max Safe Batch Weight *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    required
                    value={editingMixer.maxWeight}
                    onChange={(e) =>
                      setEditingMixer({ ...editingMixer, maxWeight: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] mb-1">
                    Weight Capacity Unit *
                  </label>
                  <select
                    value={editingMixer.weightUnit}
                    onChange={(e) =>
                      setEditingMixer({ ...editingMixer, weightUnit: e.target.value as WeightUnit })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#F9F8F6] dark:bg-[#25221F] border border-[#EEECE8] dark:border-[#332F2B] rounded-xl focus:border-[#D4A373] focus:outline-none dark:text-[#EAE6E1]"
                  >
                    {WEIGHT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-[#EEECE8] dark:border-[#332F2B] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingMixer(null)}
                  className="px-4 py-2 text-xs font-semibold text-[#8B7E74] dark:text-[#A39E93] hover:bg-[#F5F2ED] rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-[#5A534B] hover:bg-[#47413A] dark:bg-[#3D3732] rounded-xl shadow cursor-pointer"
                >
                  Save Mixer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

