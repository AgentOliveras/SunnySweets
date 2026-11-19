import React, { useState, useEffect } from 'react';
import { X, Beaker, DollarSign, Scale, HelpCircle } from 'lucide-react';
import { TemporaryIngredientData } from '../../types/quoting';

interface TemporaryIngredientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: TemporaryIngredientData) => void | Promise<void>;
  initialData?: TemporaryIngredientData | null;
  isEditing?: boolean;
}

export const TemporaryIngredientModal: React.FC<TemporaryIngredientModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  isEditing = false,
}) => {
  const [name, setName] = useState('');
  const [packagePriceDollars, setPackagePriceDollars] = useState('');
  const [packQuantity, setPackQuantity] = useState('1');
  const [unitSize, setUnitSize] = useState('');
  const [unitMeasure, setUnitMeasure] = useState('lb');
  const [density, setDensity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setName('');
    setPackagePriceDollars('');
    setPackQuantity('1');
    setUnitSize('');
    setUnitMeasure('lb');
    setDensity('');
    setNotes('');
    setError(null);
    setIsSubmitting(false);
  };

  // Re-synchronize or reset form whenever modal opens or initialData changes
  useEffect(() => {
    if (isOpen) {
      if (isEditing && initialData) {
        setName(initialData.name || '');
        setPackagePriceDollars(
          initialData.packagePriceCents != null
            ? (initialData.packagePriceCents / 100).toFixed(2)
            : ''
        );
        setPackQuantity(String(initialData.packQuantity ?? 1));
        setUnitSize(String(initialData.unitSize ?? ''));
        setUnitMeasure(initialData.unitMeasure || 'lb');
        setDensity(initialData.densityGramsPerMl ? String(initialData.densityGramsPerMl) : '');
        setNotes(initialData.notes || '');
        setError(null);
        setIsSubmitting(false);
      } else {
        resetForm();
      }
    } else {
      resetForm();
    }
  }, [isOpen, isEditing, initialData]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!name.trim()) {
      setError('Ingredient name is required.');
      return;
    }
    const priceNum = parseFloat(packagePriceDollars);
    if (isNaN(priceNum) || priceNum < 0) {
      setError('Please enter a valid package price.');
      return;
    }
    const packQty = parseFloat(packQuantity);
    const uSize = parseFloat(unitSize);
    if (isNaN(packQty) || packQty <= 0 || isNaN(uSize) || uSize <= 0) {
      setError('Pack quantity and unit size must be greater than 0.');
      return;
    }

    const priceCents = Math.round(priceNum * 100);
    const densityNum = density.trim() ? parseFloat(density) : undefined;

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave({
        name: name.trim(),
        packagePriceCents: priceCents,
        packQuantity: packQty,
        unitSize: uSize,
        unitMeasure,
        densityGramsPerMl: densityNum && densityNum > 0 ? densityNum : undefined,
        notes: notes.trim() || undefined,
      });

      // On successful save, clean reset and close
      resetForm();
      onClose();
    } catch (err: any) {
      // Retain entered form state on failure and present error
      setError(err?.message || 'Failed to save temporary ingredient. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl max-w-lg w-full shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-stone-200 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/60 text-purple-700 dark:text-purple-300 flex items-center justify-center">
              <Beaker className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif font-bold text-base text-stone-900 dark:text-zinc-100">
                {isEditing ? 'Edit Temporary R&D Ingredient' : 'Temporary R&D / Quote Ingredient'}
              </h3>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Belongs to this project only. Will not alter the pantry.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-stone-400 hover:text-stone-600 dark:hover:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
          {error && (
            <div className="p-3 text-xs rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
              Ingredient Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Customer-Supplied Chocolate, Pistachio Paste"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Package Price ($) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-stone-400 text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={packagePriceDollars}
                  onChange={(e) => setPackagePriceDollars(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Pack Quantity *
              </label>
              <input
                type="number"
                step="1"
                min="1"
                required
                value={packQuantity}
                onChange={(e) => setPackQuantity(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Package Size *
              </label>
              <input
                type="number"
                step="any"
                required
                placeholder="e.g. 5, 25, 50"
                value={unitSize}
                onChange={(e) => setUnitSize(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
                Package Unit *
              </label>
              <select
                value={unitMeasure}
                onChange={(e) => setUnitMeasure(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                <option value="lb">Pounds (lb)</option>
                <option value="kg">Kilograms (kg)</option>
                <option value="oz">Ounces (oz)</option>
                <option value="g">Grams (g)</option>
                <option value="each">Each / Piece</option>
                <option value="gal">Gallons (gal)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
              Density (g/ml, optional for liquids)
            </label>
            <input
              type="number"
              step="any"
              placeholder="e.g. 1.25"
              value={density}
              onChange={(e) => setDensity(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 dark:text-zinc-300 mb-1">
              Notes / Supplier Reference
            </label>
            <input
              type="text"
              placeholder="e.g. Customer provided sample box lot #42"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-xl border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-stone-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-xs font-bold text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-100 rounded-xl hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              {isSubmitting
                ? 'Saving...'
                : isEditing
                ? 'Update Temporary Ingredient'
                : 'Add Temporary Ingredient'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
