// Today / Yesterday chips, with the native date wheel for anything older.
// A null value (an imported step without a date) selects no chip.
import { Chip, Chips } from '@/components/Chip';
import { formatDay, todayIso } from '@/lib/format';
import { t } from '@/lib/i18n';

export function DatePick({ value, onChange }: { value: string | null; onChange: (date: string) => void }) {
  const today = todayIso();
  const yesterday = todayIso(-1);
  const other = value !== null && value !== today && value !== yesterday;
  return (
    <Chips>
      <Chip selected={value === today} onClick={() => onChange(today)}>
        {t('common.today')}
      </Chip>
      <Chip selected={value === yesterday} onClick={() => onChange(yesterday)}>
        {t('common.yesterday')}
      </Chip>
      <label className="relative">
        <Chip selected={other} onClick={() => {}} className="pointer-events-none">
          {other ? formatDay(value!) : t('common.otherDate')}
        </Chip>
        <input
          type="date"
          aria-label={t('common.otherDate')}
          value={value ?? ''}
          max={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 opacity-0"
        />
      </label>
    </Chips>
  );
}
