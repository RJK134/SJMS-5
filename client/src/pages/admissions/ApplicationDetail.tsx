import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import axios from 'axios';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, ArrowRight, CheckCircle2, Info, Loader2, UserCheck } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import StatusBadge from '@/components/shared/StatusBadge';
import StatCard from '@/components/shared/StatCard';
import FormField from '@/components/shared/FormField';
import { useDetail } from '@/hooks/useApi';
import api from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { REGISTRY_ROLES } from '@/constants/roles';

interface Application {
  id: string; status: string; academicYear: string; applicationRoute: string;
  personalStatement?: string; createdAt: string;
  applicant?: { person?: { firstName: string; lastName: string; dateOfBirth: string } };
  programme?: { title: string; programmeCode: string };
  qualifications?: { id: string; qualificationType: string; subject: string; grade?: string; predicted: boolean }[];
  references?: { id: string; refereeName: string; refereeEmail: string; referenceText?: string }[];
  conditions?: { id: string; conditionType: string; description: string; status: string }[];
}

// Conversion is only offered once the applicant has accepted (FIRM) or has been
// given an unconditional offer that bypasses the FIRM step (direct entry, clearing).
// The backend enforces the same status rule in applications.service.convertToStudent
// and requires Registry roles on POST /applications/:id/convert (with the same
// super_admin bypass as `requireRole` in auth middleware) — the UI mirrors that.
const CONVERTIBLE_STATUSES = new Set(['FIRM', 'UNCONDITIONAL_OFFER']);

type FeeStatus = 'HOME' | 'OVERSEAS' | 'EU_TRANSITIONAL' | 'ISLANDS' | 'CHANNEL_ISLANDS';
type ModeOfStudy = 'FULL_TIME' | 'PART_TIME' | 'SANDWICH' | 'DISTANCE' | 'BLOCK_RELEASE';

interface ConversionInput {
  yearOfStudy: number;
  modeOfStudy: ModeOfStudy;
  startDate: string;
  feeStatus: FeeStatus;
  originalEntryDate?: string;
}

interface ConversionResult {
  applicationId: string;
  studentId: string;
  studentNumber: string;
  enrolmentId: string;
  programmeId: string;
  academicYear: string;
  isNewStudent: boolean;
  isNewEnrolment: boolean;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultAcademicYearStart(academicYear: string): string {
  const match = /^(\d{4})\/\d{2}$/.exec(academicYear);
  if (!match) return todayIsoDate();
  return `${match[1]}-09-01`;
}

export default function ApplicationDetail() {
  const [, params] = useRoute('/admin/admissions/applications/:id');
  const { data, isLoading } = useDetail<Application>('applications', '/v1/applications', params?.id);
  const app = data?.data;
  const queryClient = useQueryClient();
  const { hasAnyRole, hasRole } = useAuth();
  // Mirrors server `requireRole`: Registry roles, plus super_admin bypass (see auth middleware).
  const canConvertAsRegistry = hasAnyRole([...REGISTRY_ROLES]) || hasRole('super_admin');

  const [showConvert, setShowConvert] = useState(false);
  const [yearOfStudy, setYearOfStudy] = useState('1');
  const [modeOfStudy, setModeOfStudy] = useState<ModeOfStudy>('FULL_TIME');
  const [startDate, setStartDate] = useState('');
  const [feeStatus, setFeeStatus] = useState<FeeStatus>('HOME');
  const [originalEntryDate, setOriginalEntryDate] = useState('');
  /** Survives `convertMutation.reset()` when re-opening the dialog so the page-level summary is not cleared. */
  const [lastConversionResult, setLastConversionResult] = useState<ConversionResult | null>(null);

  const convertMutation = useMutation<
    { success: boolean; data: ConversionResult },
    unknown,
    ConversionInput
  >({
    mutationFn: async (body) => {
      const { data } = await api.post(`/v1/applications/${params?.id}/convert`, body);
      return data;
    },
    onSuccess: (res) => {
      if (res?.data) setLastConversionResult(res.data);
      // The application row itself has not changed status, but the converted
      // student/enrolment IDs are now available — invalidate the cached
      // detail so any downstream-displayed fields stay fresh, and refresh the
      // applications list so any pipeline pages reflect the latest state.
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      if (params?.id) {
        queryClient.invalidateQueries({ queryKey: ['applications', params.id] });
      }
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!app) return <div className="text-center py-12 text-muted-foreground">Application not found</div>;

  const name = app.applicant?.person ? `${app.applicant.person.firstName} ${app.applicant.person.lastName}` : 'Unknown';
  const eligible = CONVERTIBLE_STATUSES.has(app.status);
  const canConvert = eligible && canConvertAsRegistry;
  const mutationResult = convertMutation.data?.data;

  const convertDisabledReason = !eligible
    ? `Conversion requires status FIRM or UNCONDITIONAL_OFFER (current: ${app.status.replace(/_/g, ' ')})`
    : !canConvertAsRegistry
      ? 'Conversion is restricted to Registry (registrar, senior registry officer, or registry officer)'
      : undefined;

  function openDialog(): void {
    if (!app || !eligible || !canConvertAsRegistry) return;
    setYearOfStudy('1');
    setModeOfStudy('FULL_TIME');
    setFeeStatus('HOME');
    const academicYearDefault = defaultAcademicYearStart(app.academicYear);
    setStartDate(academicYearDefault);
    setOriginalEntryDate('');
    convertMutation.reset();
    setShowConvert(true);
  }

  function closeDialog(): void {
    setShowConvert(false);
    // Success summary on the page uses `lastConversionResult` so it survives
    // `convertMutation.reset()` when the user re-opens the dialog.
  }

  function handleSubmit(): void {
    if (!startDate) return;
    const payload: ConversionInput = {
      yearOfStudy: Number(yearOfStudy),
      modeOfStudy,
      startDate,
      feeStatus,
      ...(originalEntryDate ? { originalEntryDate } : {}),
    };
    convertMutation.mutate(payload);
  }

  function formatApiValidationErrors(errors: Record<string, string[]> | undefined): string {
    if (!errors || Object.keys(errors).length === 0) return '';
    return Object.entries(errors)
      .map(([path, msgs]) => `${path === '_root' ? 'form' : path}: ${msgs.join('; ')}`)
      .join(' · ');
  }

  function extractErrorMessage(): string {
    const err = convertMutation.error;
    if (axios.isAxiosError(err)) {
      const body = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
      const detail = formatApiValidationErrors(body?.errors);
      const genericValidation =
        body?.message === 'Request body validation failed' ||
        body?.message === 'URL parameter validation failed' ||
        body?.message === 'Query parameter validation failed';
      if (body?.message) {
        if (genericValidation && detail) return `${body.message} — ${detail}`;
        if (detail) return `${body.message}${body.message.endsWith('.') ? '' : '.'} ${detail}`;
        return body.message;
      }
      if (detail) return detail;
      if (err.response?.status === 403) return 'You do not have permission to convert this application. Registry role required.';
      if (err.response?.status === 404) return 'Application not found.';
      return 'Conversion failed. Please try again.';
    }
    if (err instanceof Error) return err.message;
    return 'Conversion failed. Please try again.';
  }

  return (
    <div className="space-y-6">
      <PageHeader title={name} subtitle={`${app.programme?.programmeCode} · ${app.academicYear}`}
        breadcrumbs={[{ label: 'Staff', href: '/admin' }, { label: 'Applications', href: '/admin/admissions/applications' }, { label: name }]}>
        <StatusBadge status={app.status} />
        {canConvert ? (
          <Button onClick={openDialog} data-testid="button-convert-to-student">
            <UserCheck className="h-4 w-4 mr-2" />
            Convert to Student
          </Button>
        ) : (
          <>
            {/* aria-disabled keeps the button focusable so keyboard and AT users
                can discover and read the reason via aria-describedby.
                title provides the same reason as a visible tooltip on hover
                for sighted users (pointer-events are not blocked because we
                use aria-disabled rather than the native disabled attribute). */}
            <Button
              variant="outline"
              aria-disabled="true"
              aria-describedby="convert-disabled-reason"
              title={convertDisabledReason}
              className="cursor-not-allowed opacity-50"
              onClick={(e) => e.preventDefault()}
              data-testid="button-convert-to-student-disabled"
            >
              <UserCheck className="h-4 w-4 mr-2" />
              Convert to Student
            </Button>
            <span id="convert-disabled-reason" className="sr-only">
              {convertDisabledReason}
            </span>
          </>
        )}
      </PageHeader>

      {lastConversionResult && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>
            {lastConversionResult.isNewStudent && lastConversionResult.isNewEnrolment
              ? 'Conversion complete'
              : 'Application already converted'}
          </AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                {lastConversionResult.isNewStudent
                  ? `Student ${lastConversionResult.studentNumber} created.`
                  : `Existing student ${lastConversionResult.studentNumber} reused.`}{' '}
                {lastConversionResult.isNewEnrolment
                  ? `New enrolment created for ${lastConversionResult.academicYear}.`
                  : `Existing enrolment for ${lastConversionResult.academicYear} reused.`}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/students/${lastConversionResult.studentId}`}>
                    View student
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/enrolments/${lastConversionResult.enrolmentId}`}>
                    View enrolment
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Status" value={app.status.replace(/_/g, ' ')} />
        <StatCard label="Route" value={app.applicationRoute} />
        <StatCard label="Academic Year" value={app.academicYear} />
        <StatCard label="Applied" value={new Date(app.createdAt).toLocaleDateString('en-GB')} />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="qualifications">Qualifications</TabsTrigger>
          <TabsTrigger value="references">References</TabsTrigger>
          <TabsTrigger value="conditions">Offer Conditions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card><CardHeader><CardTitle>Personal Statement</CardTitle></CardHeader>
            <CardContent><p className="text-sm whitespace-pre-wrap">{app.personalStatement ?? 'No personal statement provided'}</p></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qualifications">
          <Card><CardHeader><CardTitle>Qualifications ({app.qualifications?.length ?? 0})</CardTitle></CardHeader>
            <CardContent>
              {app.qualifications?.length ? (
                <div className="space-y-3">
                  {app.qualifications.map(q => (
                    <div key={q.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div>
                        <p className="font-medium text-sm">{q.subject}</p>
                        <p className="text-xs text-muted-foreground">{q.qualificationType}{q.predicted ? ' (Predicted)' : ''}</p>
                      </div>
                      <span className="font-mono font-bold">{q.grade ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-muted-foreground">No qualifications recorded</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="references">
          <Card><CardHeader><CardTitle>References ({app.references?.length ?? 0})</CardTitle></CardHeader>
            <CardContent>
              {app.references?.length ? (
                <div className="space-y-4">
                  {app.references.map(r => (
                    <div key={r.id} className="border-b pb-3 last:border-0">
                      <p className="font-medium">{r.refereeName}</p>
                      <p className="text-sm text-muted-foreground">{r.refereeEmail}</p>
                      {r.referenceText && <p className="text-sm mt-2 whitespace-pre-wrap">{r.referenceText}</p>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-muted-foreground">No references received</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conditions">
          <Card><CardHeader><CardTitle>Offer Conditions ({app.conditions?.length ?? 0})</CardTitle></CardHeader>
            <CardContent>
              {app.conditions?.length ? (
                <div className="space-y-3">
                  {app.conditions.map(c => (
                    <div key={c.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <div>
                        <p className="font-medium text-sm">{c.description}</p>
                        <p className="text-xs text-muted-foreground">{c.conditionType.replace(/_/g, ' ')}</p>
                      </div>
                      <StatusBadge status={c.status} />
                    </div>
                  ))}
                </div>
              ) : <p className="text-muted-foreground">No conditions set</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showConvert} onOpenChange={(open) => (open ? setShowConvert(true) : closeDialog())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Convert to Student</DialogTitle>
            <DialogDescription>
              Create a Student record and initial Enrolment for {name} on{' '}
              {app.programme?.title ?? app.programme?.programmeCode ?? 'this programme'}.
              The operation is idempotent — re-running it returns the existing
              student and enrolment rather than creating duplicates.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Year of Study" htmlFor="conv-year-of-study" required>
                <Select value={yearOfStudy} onValueChange={setYearOfStudy}>
                  <SelectTrigger id="conv-year-of-study"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Year 1</SelectItem>
                    <SelectItem value="2">Year 2</SelectItem>
                    <SelectItem value="3">Year 3</SelectItem>
                    <SelectItem value="4">Year 4</SelectItem>
                    <SelectItem value="5">Year 5</SelectItem>
                    <SelectItem value="6">Year 6</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Mode of Study" htmlFor="conv-mode-of-study" required>
                <Select value={modeOfStudy} onValueChange={(v: string) => setModeOfStudy(v as ModeOfStudy)}>
                  <SelectTrigger id="conv-mode-of-study"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_TIME">Full-time</SelectItem>
                    <SelectItem value="PART_TIME">Part-time</SelectItem>
                    <SelectItem value="SANDWICH">Sandwich</SelectItem>
                    <SelectItem value="DISTANCE">Distance</SelectItem>
                    <SelectItem value="BLOCK_RELEASE">Block Release</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Start Date" htmlFor="conv-start-date" required>
                <Input id="conv-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FormField>
              <FormField label="Fee Status" htmlFor="conv-fee-status" required>
                <Select value={feeStatus} onValueChange={(v: string) => setFeeStatus(v as FeeStatus)}>
                  <SelectTrigger id="conv-fee-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOME">Home</SelectItem>
                    <SelectItem value="OVERSEAS">Overseas</SelectItem>
                    <SelectItem value="EU_TRANSITIONAL">EU Transitional</SelectItem>
                    <SelectItem value="ISLANDS">Islands</SelectItem>
                    <SelectItem value="CHANNEL_ISLANDS">Channel Islands</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Original Entry Date" htmlFor="conv-original-entry-date" description="Defaults to start date if not set">
                <Input id="conv-original-entry-date" type="date" value={originalEntryDate} onChange={(e) => setOriginalEntryDate(e.target.value)} />
              </FormField>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Conversion is restricted to Registry (or super administrators).
                The Student record will be given an auto-generated student number
                in the format
                <span className="font-mono"> STU-YYYY-NNNNN</span>.
              </AlertDescription>
            </Alert>

            {convertMutation.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Conversion failed</AlertTitle>
                <AlertDescription>{extractErrorMessage()}</AlertDescription>
              </Alert>
            )}

            {mutationResult && !convertMutation.isPending && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>
                  {mutationResult.isNewStudent && mutationResult.isNewEnrolment
                    ? 'Conversion complete'
                    : 'Already converted — existing records reused'}
                </AlertTitle>
                <AlertDescription>
                  Student <span className="font-mono">{mutationResult.studentNumber}</span>
                  {' '}· enrolment <span className="font-mono">{mutationResult.enrolmentId.slice(0, 8)}…</span>
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={convertMutation.isPending}>
              {mutationResult ? 'Close' : 'Cancel'}
            </Button>
            {!mutationResult && (
              <Button onClick={handleSubmit} disabled={!startDate || convertMutation.isPending}>
                {convertMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Converting…</>
                ) : (
                  <><UserCheck className="h-4 w-4 mr-2" /> Convert</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
