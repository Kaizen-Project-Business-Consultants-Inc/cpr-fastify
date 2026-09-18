import { describe, it, expect, afterEach } from 'vitest';
import {
  getHSTRate,
  getHSTLabel,
  setTaxConfig,
  resetTaxConfig,
  applyTax,
  HST_RATE,
} from '../formatters';

afterEach(() => resetTaxConfig());

describe('tax config', () => {
  it('starts at the build-time rate', () => {
    expect(getHSTRate()).toBe(HST_RATE);
    expect(getHSTLabel()).toBe(`HST (${Math.round(HST_RATE * 1000) / 10}%)`);
  });

  it('setTaxConfig updates the rate, the label and applyTax', () => {
    setTaxConfig({ taxRate: 0.05 });
    expect(getHSTRate()).toBe(0.05);
    expect(getHSTLabel()).toBe('HST (5%)');
    expect(applyTax(100)).toEqual({ subtotal: 100, tax: 5, total: 105 });
  });

  it('accepts a numeric string rate and an explicit label', () => {
    setTaxConfig({ taxRate: '0.15', taxLabel: 'HST/QST (15%)' });
    expect(getHSTRate()).toBe(0.15);
    expect(getHSTLabel()).toBe('HST/QST (15%)');
  });

  it('ignores an invalid rate rather than breaking the totals', () => {
    setTaxConfig({ taxRate: 0.07 });
    setTaxConfig({ taxRate: Number.NaN });
    setTaxConfig({ taxRate: 13 });
    setTaxConfig({ taxRate: null });
    expect(getHSTRate()).toBe(0.07);
  });

  it('resetTaxConfig restores the build-time fallback', () => {
    setTaxConfig({ taxRate: 0.09 });
    resetTaxConfig();
    expect(getHSTRate()).toBe(HST_RATE);
  });
});
