import http from 'k6/http';
import { parse } from 'https://jslib.k6.io/url/1.0.0/index.js';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000/api';
export const KEYCLOAK_URL = __ENV.KEYCLOAK_URL || 'http://localhost:8080';
export const KEYCLOAK_CLIENT_ID = __ENV.KEYCLOAK_CLIENT_ID || 'sjms-5-load-test';
export const KEYCLOAK_CLIENT_SECRET = __ENV.KEYCLOAK_CLIENT_SECRET || 'test-secret';
export const KEYCLOAK_REALM = __ENV.KEYCLOAK_REALM || 'fhe';

const tokenCache: { [key: string]: { token: string; expires: number } } = {};

/**
 * Get JWT token from Keycloak for a specific test user role
 * @param role 'student' | 'staff' | 'admin' | 'admissions'
 * @returns Bearer token string
 */
export function getAuthToken(role: string): string {
  const cacheKey = `token-${role}`;
  const now = Date.now();

  // Return cached token if still valid (with 30s buffer)
  if (tokenCache[cacheKey] && tokenCache[cacheKey].expires > now + 30000) {
    return tokenCache[cacheKey].token;
  }

  const testUsers: { [key: string]: { username: string; password: string } } = {
    student: { username: 'student@fhe.ac.uk', password: 'FheTest2026!' },
    staff: { username: 'lecturer@fhe.ac.uk', password: 'FheTest2026!' },
    admin: { username: 'admin@fhe.ac.uk', password: 'FheTest2026!' },
    admissions: { username: 'registrar@fhe.ac.uk', password: 'FheTest2026!' },
  };

  const user = testUsers[role] || testUsers.student;

  const tokenEndpoint = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

  const payload = {
    grant_type: 'password',
    client_id: KEYCLOAK_CLIENT_ID,
    client_secret: KEYCLOAK_CLIENT_SECRET,
    username: user.username,
    password: user.password,
  };

  const params = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };

  const formData = Object.entries(payload)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  const response = http.post(tokenEndpoint, formData, params);

  if (response.status !== 200) {
    console.error(
      `Failed to obtain token for ${role}. Status: ${response.status}, Body: ${response.body}`
    );
    throw new Error(`Token fetch failed for role: ${role}`);
  }

  const tokenResponse = JSON.parse(response.body as string);
  const token = tokenResponse.access_token;
  const expiresIn = tokenResponse.expires_in * 1000;

  // Cache the token
  tokenCache[cacheKey] = {
    token,
    expires: now + expiresIn,
  };

  return token;
}

/**
 * Get common request headers with authorization
 */
export function getHeaders(token: string): { [key: string]: string } {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'SJMS-5-LoadTest/1.0',
    'Accept': 'application/json',
  };
}

/**
 * Standard thresholds for load testing
 */
export const thresholds = {
  // HTTP request duration (95th percentile must be under 500ms)
  'http_req_duration{staticAsset:no}': ['p(95)<500', 'p(99)<1000'],
  'http_req_duration{staticAsset:yes}': ['p(95)<200'],

  // Failed requests must be less than 1%
  'http_req_failed{staticAsset:no}': ['rate<0.01'],
  'http_req_failed{staticAsset:yes}': ['rate<0.01'],

  // Must complete at least 100 requests per second
  'http_reqs': ['rate>100'],

  // Connection errors less than 0.1%
  'http_conn_established': ['rate>0.99'],
};

/**
 * Standard test options applied to all scenarios
 */
export const baseOptions = {
  thresholds,
  noConnectionReuse: false,
  userAgent: 'SJMS-5-LoadTest/1.0',
};
