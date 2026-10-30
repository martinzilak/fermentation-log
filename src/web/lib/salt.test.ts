import { describe, expect, it } from 'vitest';
import { saltOff, saltWarning } from './salt.ts';

describe('salt against the target', () => {
  it('warns about no salt, too little or too much, not about a little either way', () => {
    expect(saltOff(null, 3)).toBe('none');
    expect(saltOff(0, 3)).toBe('none');
    expect(saltOff(2.4, 3)).toBe('low');
    expect(saltOff(2.5, 3)).toBeNull();
    expect(saltOff(4, 3)).toBeNull();
    expect(saltOff(4.2, 3)).toBe('high');
    expect(saltWarning(0, 3)).toBe('No salt yet: the target is 3.00 %.');
  });
});
