import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptPress, justPressed } from './press.ts';

const at = (ms: number) => vi.spyOn(performance, 'now').mockReturnValue(ms);
const tap = (x: number, y: number) => ({ clientX: x, clientY: y, detail: 1 });

afterEach(() => vi.restoreAllMocks());

describe('double-tap guard (SPEC §8.1 item 4)', () => {
  it('drops the second tap of a double tap, not a quick tap elsewhere', () => {
    at(10_000);
    expect(acceptPress(tap(300, 800))).toBe(true);
    at(10_200);
    expect(acceptPress(tap(305, 795))).toBe(false);
    expect(justPressed(tap(305, 795))).toBe(true);
    expect(acceptPress(tap(100, 200))).toBe(true);
    at(10_400);
    expect(justPressed(tap(60, 700))).toBe(false);
    at(11_000);
    expect(acceptPress(tap(100, 200))).toBe(true);
  });

  it('never blocks a click from the keyboard', () => {
    at(20_000);
    expect(acceptPress(tap(50, 50))).toBe(true);
    expect(acceptPress({ clientX: 50, clientY: 50, detail: 0 })).toBe(true);
  });
});
