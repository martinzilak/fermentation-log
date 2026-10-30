// Double-tap guard (SPEC §8.1 item 4). One app-wide clock, so the second tap
// of a double tap can't land on whatever the first tap brought up in the
// same spot: a Done button under the finger, or a numpad key. Only a tap near
// the previous one counts as its double: a quick tap elsewhere on the screen
// is a new, deliberate one and goes through.
const WINDOW_MS = 500;
const NEAR_PX = 48;

interface Spot {
  clientX: number;
  clientY: number;
  /** 0 for a click from the keyboard, which is never a double tap. */
  detail: number;
}

let last = { at: Number.NEGATIVE_INFINITY, x: 0, y: 0 };

function isDouble(spot: Spot | undefined, now: number): boolean {
  if (now - last.at >= WINDOW_MS) return false;
  if (!spot || spot.detail === 0) return false;
  return Math.hypot(spot.clientX - last.x, spot.clientY - last.y) < NEAR_PX;
}

/** Records a button press; false when it is the second tap of a double tap. */
export function acceptPress(spot?: Spot): boolean {
  const now = performance.now();
  if (isDouble(spot, now)) return false;
  last = { at: now, x: spot?.clientX ?? 0, y: spot?.clientY ?? 0 };
  return true;
}

/** True when a numpad key tap is the second tap of a button's double tap. */
export const justPressed = (spot?: Spot) => isDouble(spot, performance.now());
