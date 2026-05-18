import PageHeader from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useList, useDetail } from '@/hooks/useApi';
import { Loader2, FileText, AlertCircle } from 'lucide-react';

interface TranscriptLine {
  id: string;
  moduleCode: string;
  moduleTitle: string;
  credits: number;
  mark: string | null;
  grade: string | null;
  academicYear: string;
  sortOrder: number;
}

interface Transcript {
  id: string;
  studentId: string;
  transcriptType: 'INTERIM' | 'FINAL' | 'REPLACEMENT';
  generatedDate: string;
  generatedBy: string | null;
  modules?: unknown;
  awards?: unknown;
  lines?: TranscriptLine[];
  student?: { studentNumber: string; person?: { firstName: string; lastName: string } };
}

function transcriptTypeColour(type: Transcript['transcriptType']): string {
  if (type === 'FINAL') return 'bg-green-100 text-green-800';
  if (type === 'REPLACEMENT') return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
}

function gradeColour(grade: string | null): string {
  if (!grade) return 'bg-slate-100 text-slate-700';
  if (['A', 'A+', 'FIRST', 'DISTINCTION'].includes(grade)) return 'bg-green-100 text-green-800';
  if (['B', 'UPPER_SECOND', 'MERIT'].includes(grade)) return 'bg-blue-100 text-blue-800';
  if (['C', 'LOWER_SECOND', 'PASS'].includes(grade)) return 'bg-amber-100 text-amber-800';
  if (['D', 'THIRD'].includes(grade)) return 'bg-orange-100 text-orange-800';
  if (['F', 'FAIL'].includes(grade)) return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

/**
 * MyTranscript — student-portal page that surfaces the student's most
 * recent issued transcript. Read-only: composing and persisting a
 * transcript is a Registry action via POST /v1/transcripts/compose; the
 * student sees what has been issued for them rather than triggering a
 * fresh issuance themselves.
 *
 * Phase 17E.
 */
export default function MyTranscript() {
  // List the authenticated student's transcripts. The server-side
  // scopeToUser('studentId') middleware injects the studentId filter
  // automatically, so the page does not need to discover its own
  // identity to make the call.
  const list = useList<Transcript>(
    'my-transcripts',
    '/v1/transcripts',
    { limit: 10, sort: 'generatedDate', order: 'desc' },
  );

  const transcripts = list.data?.data ?? [];
  const mostRecent = transcripts[0];

  // Once we have a candidate, fetch its full detail (with TranscriptLine
  // children) — the list endpoint omits lines to keep its response cheap.
  const detail = useDetail<Transcript>('my-transcript', '/v1/transcripts', mostRecent?.id);
  const fullTranscript = detail.data?.data;

  if (list.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (list.isError) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-destructive flex items-center justify-center gap-2">
          <AlertCircle className="h-4 w-4" /> Unable to load your transcripts. Try again later.
        </CardContent>
      </Card>
    );
  }

  if (!mostRecent) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Transcript"
          breadcrumbs={[{ label: 'Student', href: '/student' }, { label: 'Transcript' }]}
        />
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <div>
              No transcript has been issued for you yet. An interim transcript can be
              requested from Registry once your first set of module results is confirmed.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const lines = fullTranscript?.lines ?? [];
  const totalCredits = lines.reduce((sum, l) => sum + l.credits, 0);
  // Credit-weighted average matches the server-side composeTranscript
  // contract (sum(mark * credits) / sum(credits)). A simple arithmetic
  // mean would mis-state the average whenever modules carry different
  // credit values (the standard 15/30/60 mix in UK HE).
  const contributingLines = lines.filter((l) => l.mark != null && l.credits > 0);
  const contributingCredits = contributingLines.reduce((sum, l) => sum + l.credits, 0);
  const weightedMarkSum = contributingLines.reduce(
    (sum, l) => sum + Number(l.mark) * l.credits,
    0,
  );
  const finalAverage = contributingCredits > 0
    ? (weightedMarkSum / contributingCredits).toFixed(2)
    : null;

  // Group lines by academic year (descending — most recent first), with
  // module code ascending within a year. The server sorts on insert, so
  // sortOrder respects this order; we only need to bucket by year for
  // the per-year subheading.
  const linesByYear = new Map<string, TranscriptLine[]>();
  for (const l of [...lines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const arr = linesByYear.get(l.academicYear) ?? [];
    arr.push(l);
    linesByYear.set(l.academicYear, arr);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Transcript"
        subtitle={`Issued ${new Date(mostRecent.generatedDate).toLocaleDateString('en-GB')}`}
        breadcrumbs={[{ label: 'Student', href: '/student' }, { label: 'Transcript' }]}
      >
        <Badge variant="outline" className={transcriptTypeColour(mostRecent.transcriptType)}>
          {mostRecent.transcriptType}
        </Badge>
      </PageHeader>

      {transcripts.length > 1 && (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">
            Showing your most recent transcript. {transcripts.length - 1} earlier transcript
            {transcripts.length - 1 === 1 ? ' is' : 's are'} on file.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{lines.length}</p>
            <p className="text-xs text-muted-foreground">Modules</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalCredits}</p>
            <p className="text-xs text-muted-foreground">Total Credits</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{finalAverage ?? '—'}</p>
            <p className="text-xs text-muted-foreground">Average Mark</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Module Results</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : lines.length === 0 ? (
            <div className="text-center text-muted-foreground py-6">
              This transcript has no recorded module results.
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(linesByYear.entries()).map(([year, yearLines]) => (
                <div key={year}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-2">{year}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-4 font-medium">Module Code</th>
                          <th className="pb-2 pr-4 font-medium">Module Title</th>
                          <th className="pb-2 pr-4 font-medium text-right">Credits</th>
                          <th className="pb-2 pr-4 font-medium text-right">Mark</th>
                          <th className="pb-2 font-medium">Grade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yearLines.map((l) => (
                          <tr key={l.id} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-mono text-xs">{l.moduleCode}</td>
                            <td className="py-2 pr-4">{l.moduleTitle}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{l.credits}</td>
                            <td className="py-2 pr-4 text-right tabular-nums font-medium">{l.mark ?? '—'}</td>
                            <td className="py-2">
                              {l.grade ? (
                                <Badge variant="outline" className={gradeColour(l.grade)}>
                                  {l.grade}
                                </Badge>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
