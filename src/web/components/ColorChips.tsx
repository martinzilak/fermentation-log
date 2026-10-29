// Batch colour chips: the colour of the cap or label, so a batch is easy to spot.
import { Chip, Chips } from '@/components/Chip';
import { ColorDot } from '@/components/Labels';
import { t } from '@/lib/i18n';

export const COLORS = ['red', 'orange', 'yellow', 'green', 'brown', 'purple'] as const;

export function ColorChips({ value, onChange }: { value: string | null; onChange: (color: string | null) => void }) {
  return (
    <Chips>
      <Chip selected={value === null} onClick={() => onChange(null)}>
        {t('new.noColor')}
      </Chip>
      {COLORS.map((c) => (
        <Chip key={c} selected={value === c} onClick={() => onChange(c)}>
          <span className="flex items-center gap-2">
            <ColorDot color={c} />
            {t(`color.${c}`)}
          </span>
        </Chip>
      ))}
    </Chips>
  );
}
