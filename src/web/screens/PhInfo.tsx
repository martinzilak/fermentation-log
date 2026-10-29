// The pH info sheet (SPEC §7.4): what the three labels mean, as information
// rather than a rule, with the sources behind the 4.6 threshold.
import { PhLabel } from '@/components/Labels';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { goBack } from '@/lib/router';

const SOURCES = [
  { title: 'US eCFR — 21 CFR Part 114, Acidified foods', url: 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-114' },
  { title: 'National Center for Home Food Preservation', url: 'https://nchfp.uga.edu/' },
];

export function PhInfo() {
  return (
    <Screen
      title={t('phInfo.title')}
      footer={
        <Button variant="outline" onClick={() => goBack((history.state as { from?: string } | null)?.from ?? '/')}>
          {t('common.back')}
        </Button>
      }
    >
      <ul className="flex flex-col gap-3 text-lg">
        {[4.8, 4.3, 3.6].map((ph) => (
          <li key={ph} className="rounded-xl border bg-card px-4 py-3">
            <PhLabel value={ph} className="text-xl" />
          </li>
        ))}
      </ul>
      <p className="mt-4 text-lg">{t('phInfo.threshold')}</p>
      <p className="mt-3 text-lg">{t('phInfo.target')}</p>
      <p className="mt-3 text-lg">{t('phInfo.notAdvice')}</p>
      <h2 className="mt-6 mb-2 text-lg text-muted-foreground">{t('phInfo.sources')}</h2>
      <ul className="flex flex-col gap-3">
        {SOURCES.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer" className="flex min-h-14 items-center rounded-xl border px-4 text-lg underline">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
