import { describe, it, expect } from 'vitest';
import { shouldRecord, DEFAULT_RECORDING_STATE } from '../src/logic/recording.js';

describe('shouldRecord', () => {
  it('默认状态(global off)不录制', () => {
    expect(shouldRecord(DEFAULT_RECORDING_STATE, 1)).toBe(false);
  });
  it('global on 但 tab 未设 → 不录制(标签页默认 OFF)', () => {
    expect(shouldRecord({ global: true, tabs: {} }, 1)).toBe(false);
  });
  it('global on 且 tab on → 录制', () => {
    expect(shouldRecord({ global: true, tabs: { 1: true } }, 1)).toBe(true);
  });
  it('global on 但 tab 显式 off → 不录制', () => {
    expect(shouldRecord({ global: true, tabs: { 1: false } }, 1)).toBe(false);
  });
  it('tab on 但 global off → 不录制', () => {
    expect(shouldRecord({ global: false, tabs: { 1: true } }, 1)).toBe(false);
  });
  it('state 缺失 → 不录制', () => {
    expect(shouldRecord(null, 1)).toBe(false);
  });
});
