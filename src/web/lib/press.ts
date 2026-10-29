// Double-tap guard (SPEC §8.1 item 4). One app-wide clock, so the second tap
// of a double tap can't land on whatever the first tap brought up in the
// same spot: a Done button under the finger, or a numpad key.
const WINDOW_MS = 500;
let last = Number.NEGATIVE_INFINITY;

/** Records a button press; false when it comes too soon after the previous one. */
export function acceptPress(): boolean {
  const now = performance.now();
  if (now - last < WINDOW_MS) return false;
  last = now;
  return true;
}

/** True within the guard window after a button press (numpad keys check this). */
export const justPressed = () => performance.now() - last < WINDOW_MS;
