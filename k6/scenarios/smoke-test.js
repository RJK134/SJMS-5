import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

/**
 * SJMS-5 Smoke & Baseline Load Test
 *
 * Runs against the live Docker stack without Keycloak dependency.
 * Tests health, metrics, and public-accessible API endpoints.
 * Suitable for development/staging baseline capture.
 *
 * Usage: k6 run k6/scenarios/smoke-test.js
 * Or:    docker run --rm --network host -v ./k6:/scripts grafana/k6 run /scripts/scenarios/smoke-test.js
 */

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:5000';

// Custom metrics
const healthDuration = new Trend('health_check_duration', true);
const readyDuration = new Trend('ready_probe_duration', true);
const metricsDuration = new Trend('metrics_endpoint_duration', true);
const apiGetDuration = new Trend('api_get_duration', true);
const apiPostDuration = new Trend('api_post_duration', true);
const errorRate = new Rate('error_rate');
const requestCount = new Counter('total_requests');

export const options = {
  scenarios: {
    // Phase 1: Smoke test (single user, verify endpoints work)
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      startTime: '0s',
      tags: { phase: 'smoke' },
    },
    // Phase 2: Baseline load (10 concurrent users)
    baseline: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 0 },
      ],
      startTime: '30s',
      tags: { phase: 'baseline' },
    },
    // Phase 3: Stress (ramp to 50 concurrent)
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '30s', target: 0 },
      ],
      startTime: '2m30s',
      tags: { phase: 'stress' },
    },
  },
  thresholds: {
    // Target: <200ms for reads (p95)
    health_check_duration: ['p(95)<200'],
    ready_probe_duration: ['p(95)<200'],
    api_get_duration: ['p(95)<500'],
    // Target: <1% error rate
    error_rate: ['rate<0.01'],
    // Target: >50 req/sec sustained
    http_reqs: ['rate>50'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };

  group('Health & Probes', () => {
    // Health check
    let res = http.get(`${BASE_URL}/api/v1/health`, { tags: { endpoint: 'health' } });
    healthDuration.add(res.timings.duration);
    requestCount.add(1);
    const healthOk = check(res, {
      'health status 200': (r) => r.status === 200,
      'health body has status': (r) => JSON.parse(r.body).data.status === 'healthy',
      'database connected': (r) => JSON.parse(r.body).data.services.database.status === 'connected',
    });
    errorRate.add(!healthOk);

    // Readiness probe
    res = http.get(`${BASE_URL}/api/v1/health/ready`, { tags: { endpoint: 'ready' } });
    readyDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'ready status 200': (r) => r.status === 200,
      'ready status field': (r) => JSON.parse(r.body).status === 'ready',
    });

    // Liveness probe
    res = http.get(`${BASE_URL}/api/v1/health/live`, { tags: { endpoint: 'live' } });
    requestCount.add(1);
    check(res, {
      'live status 200': (r) => r.status === 200,
    });
  });

  group('Prometheus Metrics', () => {
    const res = http.get(`${BASE_URL}/metrics`, { tags: { endpoint: 'metrics' } });
    metricsDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'metrics status 200': (r) => r.status === 200,
      'metrics has content': (r) => r.body.includes('sjms_http_requests_total'),
    });
  });

  group('API Read Endpoints', () => {
    // Students list
    let res = http.get(`${BASE_URL}/api/v1/students`, { headers, tags: { endpoint: 'students' } });
    apiGetDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'students responds': (r) => r.status === 200 || r.status === 401,
    });

    // Programmes list
    res = http.get(`${BASE_URL}/api/v1/programmes`, { headers, tags: { endpoint: 'programmes' } });
    apiGetDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'programmes responds': (r) => r.status === 200 || r.status === 401,
    });

    // Modules list
    res = http.get(`${BASE_URL}/api/v1/modules`, { headers, tags: { endpoint: 'modules' } });
    apiGetDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'modules responds': (r) => r.status === 200 || r.status === 401,
    });

    // Curriculum dashboard
    res = http.get(`${BASE_URL}/api/v1/curriculum/dashboard`, { headers, tags: { endpoint: 'curriculum' } });
    apiGetDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'curriculum responds': (r) => r.status === 200 || r.status === 401,
    });

    // Bug reports (usually public)
    res = http.get(`${BASE_URL}/api/v1/bug-reports`, { headers, tags: { endpoint: 'bug-reports' } });
    apiGetDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'bug-reports responds': (r) => r.status === 200 || r.status === 401,
    });
  });

  group('API Write Endpoints', () => {
    // Create a bug report (lightweight write test)
    const bugReport = JSON.stringify({
      title: `k6 Load Test Bug ${Date.now()}`,
      description: 'Automated load test - safe to ignore',
      type: 'bug',
      priority: 'P4_LOW',
    });

    const res = http.post(`${BASE_URL}/api/v1/bug-reports`, bugReport, {
      headers,
      tags: { endpoint: 'create-bug-report' },
    });
    apiPostDuration.add(res.timings.duration);
    requestCount.add(1);
    check(res, {
      'create responds': (r) => r.status === 201 || r.status === 200 || r.status === 401,
    });
  });

  sleep(0.5); // 500ms think time between iterations
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    scenarios: {
      smoke: '1 VU for 30s',
      baseline: '10 VUs for 1m',
      stress: '50 VUs for 1m',
    },
    thresholds: {},
    metrics: {},
  };

  // Extract key metrics
  if (data.metrics.http_reqs) {
    summary.metrics.total_requests = data.metrics.http_reqs.values.count;
    summary.metrics.requests_per_second = data.metrics.http_reqs.values.rate;
  }
  if (data.metrics.health_check_duration) {
    summary.metrics.health_p95_ms = data.metrics.health_check_duration.values['p(95)'];
    summary.metrics.health_avg_ms = data.metrics.health_check_duration.values.avg;
  }
  if (data.metrics.api_get_duration) {
    summary.metrics.api_get_p95_ms = data.metrics.api_get_duration.values['p(95)'];
    summary.metrics.api_get_avg_ms = data.metrics.api_get_duration.values.avg;
  }
  if (data.metrics.error_rate) {
    summary.metrics.error_rate = data.metrics.error_rate.values.rate;
  }

  // Check thresholds
  for (const [name, threshold] of Object.entries(data.metrics)) {
    if (threshold.thresholds) {
      for (const [rule, passed] of Object.entries(threshold.thresholds)) {
        summary.thresholds[`${name}: ${rule}`] = passed.ok ? 'PASS' : 'FAIL';
      }
    }
  }

  return {
    stdout: JSON.stringify(summary, null, 2) + '\n',
    'k6/results/smoke-test-results.json': JSON.stringify(data, null, 2),
  };
}
