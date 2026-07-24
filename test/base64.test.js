import { describe, it, expect } from 'vitest';
import { bytesToBase64, decodeBase64 } from '../src/logic/base64.js';

describe('base64', () => {
  it('encodes ArrayBuffer', () => {
    expect(bytesToBase64(new Uint8Array([72, 105]).buffer)).toBe('SGk='); // "Hi"
  });
  it('encodes Uint8Array view with offset', () => {
    const view = new Uint8Array([0, 0, 72, 105]).subarray(2);
    expect(bytesToBase64(view)).toBe('SGk=');
  });
  it('encodes string as utf-8', () => {
    expect(bytesToBase64('Hi')).toBe('SGk=');
  });
  it('encodes empty / null input to empty string', () => {
    expect(bytesToBase64(new ArrayBuffer(0))).toBe('');
    expect(bytesToBase64(null)).toBe('');
  });
  it('decodes back to the same bytes', () => {
    const orig = [1, 2, 3, 4, 5, 250];
    const dec = decodeBase64(bytesToBase64(new Uint8Array(orig).buffer));
    expect(Array.from(dec)).toEqual(orig);
  });
  it('handles large arrays in chunks (no stack overflow)', () => {
    const big = new Uint8Array(20000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    const dec = decodeBase64(bytesToBase64(big.buffer));
    expect(Array.from(dec)).toEqual(Array.from(big));
  });
});
