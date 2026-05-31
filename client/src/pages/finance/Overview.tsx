/**
 * Phase 1F — Staff Finance Overview dashboard.
 *
 * Closes KI-S5-102 (the v4 `/staff/finance-overview` 404). Pure read:
 * surfaces the four aggregate sections served by `GET /v1/finance/overview`
 * (collection totals, ageing buckets, sponsor liability, bursary spend)
 * plus a button that fires the Phase 1E ledger-anomaly scan and renders
 * the structured report inline. No mutation of the ledger anywhere.
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { useState } from 'react';
import PageHeader from '@/components/shared/PageHeader';
import StatCard from '@/components/shared/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Wallet, AlertTriangle, Banknote, HandCoins, Activity, RefreshCw, Search,
} from 'lucide-react';

interface CollectionTotals {
  totalAccounts: number;
  outstandingBalance: number;
  totalDebits: number;
  totalCredits: number;
  byStatus: Array<{ status: string; count: number; outstandingBalance: number }>;
}
interface AgeingBucket {
  bucket: 'CURRENT' | '1_30' | '31_60' | '61_90' | '90_PLUS';
  invoiceCount: number;
  outstanding: number;
}
interface Ageing {
  asOf: string;
  buckets: AgeingBucket[];
  totalOutstanding: number;
  totalOpenInvoices: number;
}
interface SponsorRow {
  sponsorType: string;
  agreementCount: number;
  amountAgreed: number;
  amountReceived: number;
  liability: number;
}
interface SponsorLiability {
  totalAgreements: number;
  totalAgreed: number;
  totalReceived: number;
  totalLiability: number;
  byType: SponsorRow[];
}
interface BursaryRow {
  fundId: string;
  fundName: string;
  fundType: string;
  academicYear: string;
  totalBudget: number;
  allocated: number;
  remaining: number;
  utilisation: number;
}
interface BursarySpend {
  totalFunds: number;
  totalBudget: number;
  totalAllocated: number;
  totalRemaining: number;
  funds: BursaryRow[];
}
interface FinanceOverview {
  collection: CollectionTotals;
  ageing: Ageing;
  sponsorLiability: SponsorLiability;
  bursarySpend: BursarySpend;
  generatedAt: string;
}

interface AnomalyReport {
  scanId: string;
  scannedAt: string;
  total: number;
  hasHighSeverity: boolean;
  counts: Record<string, number>;
  severityCounts: { HIGH: number; MEDIUM: number; LOW: number };
  anomalies: Array<{
    type: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    entityId: string;
    detail: string;
  }>;
}

const gbp = (n: number) =>
  `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BUCKET_LABELS: Record<AgeingBucket['bucket'], string> = {
  CURRENT: 'Current',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  '90_PLUS': '90+ days',
};

export default function FinanceOverview() {
  const overview = useQuery<{ success: boolean; data: FinanceOverview }>({
    queryKey: ['finance-overview'],
    queryFn: async () => (await api.get('/v1/finance/overview')).data,
  });

  const [scanReport, setScanReport] = useState<AnomalyReport | null>(null);
  const scan = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/v1/ledger-anomalies/scan', {});
      return data.data as AnomalyReport;
    },
    onSuccess: (r) => setScanReport(r),
  });

  const data = overview.data?.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Overview"
        subtitle={
          data
            ? `Snapshot as of ${new Date(data.generatedAt).toLocaleString('en-GB')}`
            : overview.isLoading
              ? 'Loading…'
              : 'Unable to load overview'
        }
        breadcrumbs={[{ label: 'Staff', href: '/admin' }, { label: 'Finance' }, { label: 'Overview' }]}
      >
        <Button
          variant="outline"
          onClick={() => overview.refetch()}
          disabled={overview.isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${overview.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </PageHeader>

      {overview.isError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="py-4 text-red-700">
            Failed to load the finance overview. Please retry or contact platform support.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* ── Collection headline ── */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard
              label="Outstanding balance"
              value={gbp(data.collection.outstandingBalance)}
              icon={Wallet}
            />
            <StatCard
              label="Open invoices"
              value={data.ageing.totalOpenInvoices.toLocaleString('en-GB')}
              icon={Banknote}
            />
            <StatCard
              label="Sponsor liability"
              value={gbp(data.sponsorLiability.totalLiability)}
              icon={HandCoins}
            />
            <StatCard
              label="Bursary remaining"
              value={gbp(data.bursarySpend.totalRemaining)}
              icon={Activity}
            />
          </div>

          {/* ── Ageing buckets ── */}
          <Card>
            <CardHeader>
              <CardTitle>Ageing — open invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                {data.ageing.buckets.map((b) => (
                  <div
                    key={b.bucket}
                    className={`rounded-lg border p-4 ${
                      b.bucket === '90_PLUS' && b.outstanding > 0
                        ? 'border-red-300 bg-red-50'
                        : b.bucket === '61_90' && b.outstanding > 0
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-slate-200'
                    }`}
                  >
                    <div className="text-xs font-medium text-muted-foreground">
                      {BUCKET_LABELS[b.bucket]}
                    </div>
                    <div className="text-lg font-bold mt-1">{gbp(b.outstanding)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {b.invoiceCount} invoice{b.invoiceCount === 1 ? '' : 's'}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-sm text-muted-foreground mt-3">
                Total open: <span className="font-semibold text-foreground">{gbp(data.ageing.totalOutstanding)}</span>
              </div>
            </CardContent>
          </Card>

          {/* ── Sponsor liability + Bursary spend (two columns) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Sponsor liability by type</CardTitle>
              </CardHeader>
              <CardContent>
                {data.sponsorLiability.byType.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No active sponsor agreements.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="pb-2">Type</th>
                        <th className="pb-2 text-right">Agreements</th>
                        <th className="pb-2 text-right">Agreed</th>
                        <th className="pb-2 text-right">Liability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sponsorLiability.byType.map((r) => (
                        <tr key={r.sponsorType} className="border-b last:border-0">
                          <td className="py-2">{r.sponsorType}</td>
                          <td className="py-2 text-right">{r.agreementCount}</td>
                          <td className="py-2 text-right">{gbp(r.amountAgreed)}</td>
                          <td className="py-2 text-right font-semibold">{gbp(r.liability)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2">
                        <td className="pt-2 font-semibold">Total</td>
                        <td className="pt-2 text-right font-semibold">
                          {data.sponsorLiability.totalAgreements}
                        </td>
                        <td className="pt-2 text-right font-semibold">
                          {gbp(data.sponsorLiability.totalAgreed)}
                        </td>
                        <td className="pt-2 text-right font-semibold">
                          {gbp(data.sponsorLiability.totalLiability)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bursary fund spend</CardTitle>
              </CardHeader>
              <CardContent>
                {data.bursarySpend.funds.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No bursary funds defined.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="pb-2">Fund</th>
                        <th className="pb-2">Year</th>
                        <th className="pb-2 text-right">Allocated</th>
                        <th className="pb-2 text-right">Remaining</th>
                        <th className="pb-2 text-right">Util.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bursarySpend.funds.map((f) => (
                        <tr key={f.fundId} className="border-b last:border-0">
                          <td className="py-2">{f.fundName}</td>
                          <td className="py-2">{f.academicYear}</td>
                          <td className="py-2 text-right">{gbp(f.allocated)}</td>
                          <td className="py-2 text-right">{gbp(f.remaining)}</td>
                          <td className="py-2 text-right">
                            {(f.utilisation * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2">
                        <td className="pt-2 font-semibold" colSpan={2}>Total</td>
                        <td className="pt-2 text-right font-semibold">
                          {gbp(data.bursarySpend.totalAllocated)}
                        </td>
                        <td className="pt-2 text-right font-semibold">
                          {gbp(data.bursarySpend.totalRemaining)}
                        </td>
                        <td className="pt-2 text-right font-semibold">
                          {data.bursarySpend.totalBudget > 0
                            ? `${((data.bursarySpend.totalAllocated / data.bursarySpend.totalBudget) * 100).toFixed(1)}%`
                            : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Phase 1E ledger-anomaly scan trigger ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Ledger anomaly scan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Read-only sweep of the finance ledger for negative balances, orphan ChargeLines, and
                duplicate invoice numbers (Phase 1E). Surfaces anomalies for an operator to action;
                never mutates the ledger.
              </p>
              <div className="flex items-center gap-3">
                <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
                  <Search className={`h-4 w-4 mr-2 ${scan.isPending ? 'animate-pulse' : ''}`} />
                  Run scan now
                </Button>
                {scan.isError && (
                  <span className="text-sm text-red-600">
                    Scan failed — check worker connectivity and try again.
                  </span>
                )}
              </div>

              {scanReport && (
                <div className="mt-2 border rounded-lg p-4 bg-slate-50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm">
                      <span className="font-semibold">{scanReport.total}</span> anomaly
                      {scanReport.total === 1 ? '' : 'ies'} found
                      {scanReport.hasHighSeverity && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          HIGH severity present
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Scan {scanReport.scanId} · {new Date(scanReport.scannedAt).toLocaleString('en-GB')}
                    </div>
                  </div>
                  {scanReport.anomalies.length === 0 ? (
                    <div className="text-sm text-green-700">
                      No anomalies — the finance ledger is clean.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {scanReport.anomalies.map((a, i) => (
                        <li key={`${a.type}-${a.entityId}-${i}`} className="text-sm">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                              a.severity === 'HIGH'
                                ? 'bg-red-100 text-red-800'
                                : a.severity === 'MEDIUM'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {a.severity}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {a.type}
                          </span>
                          {a.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
