// Titles and buttons are set in capitals, but pH is a unit and keeps its case.
import { Children, type ReactNode } from 'react';

export function keepUnits(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string' && child.includes('pH')
      ? child.split(/(\bpH\b)/).map((part, i) =>
          part === 'pH' ? (
            <span key={i} className="normal-case">
              pH
            </span>
          ) : (
            part
          ),
        )
      : child,
  );
}
