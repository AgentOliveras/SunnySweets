import React, { useState, useEffect, useRef } from 'react';

export interface ProductionNumericInputProps {
  id?: string;
  value: number | string | null | undefined;
  onCommit: (val: number) => void;
  onRawChange?: (raw: string, parsed: number | null) => void;
  allowDecimal?: boolean;
  min?: number;
  max?: number;
  fallbackOnBlur?: number;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Tablet-optimized numeric input supporting:
 * 1. Distinction between TEMPORARY EDITING STATE and VALIDATED NUMERIC STATE.
 * 2. Does NOT immediately force empty string or intermediate typing to 0 or 1.
 * 3. Highlights/selects entire number on focus for instant replacement without backspacing.
 * 4. Allows natural decimal entry for piece weight.
 */
export const ProductionNumericInput: React.FC<ProductionNumericInputProps> = ({
  id,
  value,
  onCommit,
  onRawChange,
  allowDecimal = false,
  min,
  max,
  fallbackOnBlur,
  className = '',
  ariaLabel,
  placeholder,
  disabled = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [rawText, setRawText] = useState<string>('');

  // Synchronize when value changes externally while not actively editing
  useEffect(() => {
    if (!isFocused) {
      if (value === null || value === undefined || value === '') {
        setRawText('');
      } else {
        setRawText(String(value));
      }
    }
  }, [value, isFocused]);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (disabled) return;
    setIsFocused(true);
    const initialText =
      value === null || value === undefined || value === '' ? '' : String(value);
    setRawText(initialText);

    // Auto-select entire existing number on focus for instant bakery tablet typing
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.select();
      }
    }, 0);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = e.target.value;

    if (allowDecimal) {
      // Allow only digits and at most one decimal point
      const cleaned = incoming.replace(/[^0-9.]/g, '');
      const parts = cleaned.split('.');
      const normalized =
        parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
      setRawText(normalized);

      if (onRawChange) {
        const parsed =
          normalized === '' || normalized === '.'
            ? null
            : parseFloat(normalized);
        onRawChange(normalized, isNaN(parsed as any) ? null : parsed);
      }
    } else {
      // Whole numbers only
      const cleaned = incoming.replace(/[^0-9]/g, '');
      setRawText(cleaned);

      if (onRawChange) {
        const parsed = cleaned === '' ? null : parseInt(cleaned, 10);
        onRawChange(cleaned, isNaN(parsed as any) ? null : parsed);
      }
    }
  };

  const commitValue = () => {
    setIsFocused(false);
    const trimmed = rawText.trim();

    if (trimmed === '' || (allowDecimal && trimmed === '.')) {
      if (fallbackOnBlur !== undefined) {
        setRawText(String(fallbackOnBlur));
        onCommit(fallbackOnBlur);
      } else if (onRawChange) {
        onRawChange('', null);
      }
      return;
    }

    const parsed = allowDecimal ? parseFloat(trimmed) : parseInt(trimmed, 10);
    if (isNaN(parsed)) {
      if (fallbackOnBlur !== undefined) {
        setRawText(String(fallbackOnBlur));
        onCommit(fallbackOnBlur);
      } else if (onRawChange) {
        onRawChange('', null);
      }
      return;
    }

    let finalVal = parsed;
    if (min !== undefined && finalVal < min) finalVal = min;
    if (max !== undefined && finalVal > max) finalVal = max;

    setRawText(String(finalVal));
    onCommit(finalVal);
  };

  const handleBlur = () => {
    commitValue();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitValue();
      if (inputRef.current) {
        inputRef.current.blur();
      }
    }
  };

  const displayVal = isFocused
    ? rawText
    : value === null || value === undefined || value === ''
    ? ''
    : String(value);

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      pattern={allowDecimal ? '[0-9]*[.]?[0-9]*' : '[0-9]*'}
      autoComplete="off"
      autoCorrect="off"
      spellCheck="false"
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={displayVal}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
};
