// Titles, buttons and labels are set in capitals, but units keep their case:
// pH, and g, kg, ml and l after a number (600 g must not read 600 G).
import { Children, type ReactNode } from 'react';

const UNITS = /(\bpH\b|(?<=\d\s?)(?:kg|g|ml|l)\b)/;

export function keepUnits(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string' && UNITS.test(child)
      ? child.split(UNITS).map((part, i) =>
          i % 2 === 1 ? (
            <span key={i} className="normal-case">
              {part}
            </span>
          ) : (
            part
          ),
        )
      : child,
  );
}
