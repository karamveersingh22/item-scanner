/**
 * Stage 4 Automated Verification Test Suite (Single-Company Architecture)
 * Covers Security and UI Management Panel requirements:
 *
 * Security Tests:
 * 1. Authenticated company can access its dashboard/profile.
 * 2. Unauthenticated browser cannot access protected management APIs.
 * 3. Company can access its own profile.
 * 4. Profile updates persist to storage and survive cold start.
 * 5. Strict Session Scoping: Client-supplied payload fields cannot override session identity.
 * 6. Invalid/expired authentication is rejected.
 * 7. Disabled company cannot access protected management APIs.
 * 8. Current password is required to change credentials.
 * 9. Passwords remain hashed.
 * 10. Sensitive credentials are never returned in API responses.
 *
 * UI Flow Tests:
 * 11. Login works & sets secure session cookie.
 * 12. Dashboard endpoint loads company metrics correctly.
 * 13. Company name can be changed via profile update.
 * 14. Username can be changed with password confirmation.
 * 15. Password can be changed with password confirmation.
 * 16. Incorrect current password is rejected.
 * 17. Logout clears session.
 * 18. Session expiration returns user to unauthenticated state.
 * 19. Drive status placeholder returns 'Not Connected'.
 * 20. Sync status placeholder returns 'Not synchronized'.
 */

import { NextRequest } from 'next/server';
import { db, SingleCompanyStore } from '../src/lib/db';
import { POST as loginRoute } from '../src/app/api/auth/login/route';
import { GET as authMeRoute } from '../src/app/api/auth/me/route';
import { POST as logoutRoute } from '../src/app/api/auth/logout/route';
import { GET as getProfileRoute, PUT as updateProfileRoute } from '../src/app/api/company/profile/route';
import { PUT as credentialsRoute } from '../src/app/api/company/credentials/route';
import { GET as driveStatusRoute } from '../src/app/api/google-drive/status/route';
import { GET as syncStatusRoute } from '../src/app/api/sync/status/route';

interface TestResult {
  num: number;
  description: string;
  category: 'SECURITY' | 'UI_FLOW';
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(num: number, category: 'SECURITY' | 'UI_FLOW', description: string, passed: boolean, details: string) {
  results.push({ num, category, description, passed, details });
  const badge = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`${badge} [${category}] Test ${num}: ${description}`);
  if (!passed || process.env.VERBOSE) {
    console.log(`       Details: ${details}`);
  }
}

function createJsonRequest(url: string, method: string, body?: unknown, token?: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  if (cookie) {
    headers['cookie'] = cookie;
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function runStage4Tests() {
  console.log('\n======================================================================');
  console.log('       STAGE 4: COMPANY MANAGEMENT PANEL VERIFICATION SUITE           ');
  console.log('======================================================================\n');

  await db.clearAll();

  let token = '';
  let cookie = '';
  let companyId = '';

  // Setup: Load initial single company
  const company = await db.getCompany();
  companyId = company.id;

  // Login as admin
  const loginReq = createJsonRequest('/api/auth/login', 'POST', {
    username: 'admin',
    password: 'admin123!',
  });
  const loginRes = await loginRoute(loginReq);
  const loginJson = await loginRes.json();
  token = loginJson.data.token;

  // Extract session cookie
  const setCookieHeader = loginRes.headers.get('set-cookie');
  if (setCookieHeader) {
    const match = setCookieHeader.match(/session=([^;]+)/);
    if (match) cookie = `session=${match[1]}`;
  }

  // ------------------------------------------------------------------
  // SECURITY TESTS (1 - 10)
  // ------------------------------------------------------------------

  // 1. Authenticated company can access its dashboard/profile
  try {
    const req = createJsonRequest('/api/auth/me', 'GET', undefined, token);
    const res = await authMeRoute(req);
    const json = await res.json();
    record(
      1,
      'SECURITY',
      'Authenticated company can access its profile',
      res.status === 200 && json.success && json.data.company.id === companyId,
      `Company ID matched: ${json.data?.company?.id}`
    );
  } catch (e: any) {
    record(1, 'SECURITY', 'Authenticated company access', false, e.message);
  }

  // 2. Unauthenticated browser cannot access protected management APIs
  try {
    const req = createJsonRequest('/api/company/profile', 'GET');
    const res = await getProfileRoute(req);
    record(
      2,
      'SECURITY',
      'Unauthenticated browser cannot access protected management APIs',
      res.status === 401,
      `Status code: ${res.status} (expected 401)`
    );
  } catch (e: any) {
    record(2, 'SECURITY', 'Unauthenticated browser access', false, e.message);
  }

  // 3. Company can access its own profile
  try {
    const req = createJsonRequest('/api/company/profile', 'GET', undefined, token);
    const res = await getProfileRoute(req);
    const json = await res.json();
    record(
      3,
      'SECURITY',
      'Company can access its own profile',
      res.status === 200 && json.data.company.company_name === company.company_name,
      `Returned: ${json.data?.company?.company_name}`
    );
  } catch (e: any) {
    record(3, 'SECURITY', 'Company profile access', false, e.message);
  }

  // 4. Profile updates persist to storage and survive cold-start
  try {
    const req = createJsonRequest(
      '/api/company/profile',
      'PUT',
      { company_name: 'Persistent Test Name' },
      token
    );
    const res = await updateProfileRoute(req);
    const json = await res.json();

    // Verify survival on cold store
    const cold = new SingleCompanyStore();
    const loaded = await cold.getCompany();

    const ok = res.status === 200 && loaded.company_name === 'Persistent Test Name';
    record(
      4,
      'SECURITY',
      'Profile updates persist to storage and survive cold-start',
      ok,
      `Cold-store verified name: ${loaded.company_name}`
    );

    // Revert name
    await db.updateCompanyProfile(companyId, { company_name: 'Item Master Company' });
  } catch (e: any) {
    record(4, 'SECURITY', 'Profile persistence', false, e.message);
  }

  // 5. Strict Session Scoping: Client-supplied payload fields cannot override identity
  try {
    const req = createJsonRequest(
      '/api/company/profile',
      'PUT',
      { company_id: 'malicious-id', company_name: 'Scoped Company Name' },
      token
    );
    const res = await updateProfileRoute(req);
    const json = await res.json();

    const current = await db.getCompany();
    const idRemainsOriginal = current.id === companyId;

    record(
      5,
      'SECURITY',
      'Strict Session Scoping: Payload company_id cannot override identity',
      res.status === 200 && idRemainsOriginal,
      `Company ID remained: ${current.id}`
    );
  } catch (e: any) {
    record(5, 'SECURITY', 'Strict Session Scoping', false, e.message);
  }

  // 6. Invalid/expired authentication is rejected
  try {
    const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';
    const req = createJsonRequest('/api/company/profile', 'GET', undefined, invalidToken);
    const res = await getProfileRoute(req);
    record(
      6,
      'SECURITY',
      'Invalid/tampered authentication token is rejected',
      res.status === 401,
      `Status code: ${res.status}`
    );
  } catch (e: any) {
    record(6, 'SECURITY', 'Invalid auth token', false, e.message);
  }

  // 7. Disabled company cannot access protected management APIs
  try {
    await db.updateCompanyStatus(companyId, 'DISABLED');

    const req = createJsonRequest('/api/company/profile', 'GET', undefined, token);
    const res = await getProfileRoute(req);
    const json = await res.json();

    record(
      7,
      'SECURITY',
      'Disabled company cannot access protected management APIs',
      res.status === 403,
      `Status: ${res.status}, Error: ${json.error}`
    );

    await db.updateCompanyStatus(companyId, 'ACTIVE');
  } catch (e: any) {
    record(7, 'SECURITY', 'Disabled company access', false, e.message);
  }

  // 8. Current password is required to change credentials
  try {
    const req = createJsonRequest(
      '/api/company/credentials',
      'PUT',
      { new_username: 'NEW_UNAUTHORIZED_NAME' },
      token
    );
    const res = await credentialsRoute(req);
    record(
      8,
      'SECURITY',
      'Current password is required to change credentials',
      res.status === 400,
      `Status code: ${res.status}`
    );
  } catch (e: any) {
    record(8, 'SECURITY', 'Current password requirement', false, e.message);
  }

  // 9. Passwords remain hashed
  try {
    const comp = await db.getCompany();
    const hash = comp.password_hash;
    const isBcrypt = hash.startsWith('$2a$') || hash.startsWith('$2b$');

    record(
      9,
      'SECURITY',
      'Passwords remain securely hashed with bcrypt in storage',
      isBcrypt,
      `Hash prefix: ${hash.substring(0, 7)}...`
    );
  } catch (e: any) {
    record(9, 'SECURITY', 'Password hash verification', false, e.message);
  }

  // 10. Sensitive credentials are never returned in API responses
  try {
    const req = createJsonRequest('/api/company/profile', 'GET', undefined, token);
    const res = await getProfileRoute(req);
    const rawText = await res.text();

    const noPasswordHash = !rawText.includes('password_hash');
    const noGoogleToken = !rawText.includes('google_refresh_token');

    record(
      10,
      'SECURITY',
      'Sensitive credentials (password_hash, google_refresh_token) omitted from API responses',
      noPasswordHash && noGoogleToken,
      'Sanitized output confirmed'
    );
  } catch (e: any) {
    record(10, 'SECURITY', 'Sensitive credentials omission', false, e.message);
  }

  // ------------------------------------------------------------------
  // UI FLOW & FEATURE TESTS (11 - 20)
  // ------------------------------------------------------------------

  // 11. Login works & sets session cookie for web browser
  try {
    const req = createJsonRequest('/api/auth/login', 'POST', {
      username: 'admin',
      password: 'admin123!',
    });
    const res = await loginRoute(req);
    const setCookie = res.headers.get('set-cookie');
    const hasSessionCookie = Boolean(setCookie && setCookie.includes('session='));

    record(
      11,
      'UI_FLOW',
      'Web login sets httpOnly session cookie for browser panel',
      res.status === 200 && hasSessionCookie,
      `Set-Cookie header found: ${hasSessionCookie}`
    );
  } catch (e: any) {
    record(11, 'UI_FLOW', 'Web login with cookie', false, e.message);
  }

  // 12. Dashboard endpoint loads company metrics correctly
  try {
    const req = createJsonRequest('/api/auth/me', 'GET', undefined, undefined, cookie);
    const res = await authMeRoute(req);
    const json = await res.json();
    record(
      12,
      'UI_FLOW',
      'Dashboard loads company metrics via session cookie',
      res.status === 200 && json.data.company.username === 'admin',
      `Username: ${json.data?.company?.username}, Status: ${json.data?.company?.status}`
    );
  } catch (e: any) {
    record(12, 'UI_FLOW', 'Dashboard metric loading', false, e.message);
  }

  // 13. Company name can be changed via profile update
  try {
    const req = createJsonRequest(
      '/api/company/profile',
      'PUT',
      { company_name: 'ABC Global Traders Ltd' },
      token
    );
    const res = await updateProfileRoute(req);
    const json = await res.json();
    record(
      13,
      'UI_FLOW',
      'Company name can be updated from Profile page',
      res.status === 200 && json.data.company.company_name === 'ABC Global Traders Ltd',
      `Updated name: ${json.data?.company?.company_name}`
    );
  } catch (e: any) {
    record(13, 'UI_FLOW', 'Company name change', false, e.message);
  }

  // 14. Username can be changed with password confirmation
  try {
    const req = createJsonRequest(
      '/api/company/credentials',
      'PUT',
      {
        current_password: 'admin123!',
        new_username: 'ABC2026',
      },
      token
    );
    const res = await credentialsRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success) {
      token = json.data.token; // Update token for subsequent calls
      record(
        14,
        'UI_FLOW',
        'Username successfully changed from admin to ABC2026',
        json.data.company.username === 'ABC2026',
        `New username: ${json.data.company.username}`
      );
    } else {
      record(14, 'UI_FLOW', 'Username change', false, JSON.stringify(json));
    }
  } catch (e: any) {
    record(14, 'UI_FLOW', 'Username change', false, e.message);
  }

  // 15. Password can be changed with password confirmation
  try {
    const req = createJsonRequest(
      '/api/company/credentials',
      'PUT',
      {
        current_password: 'admin123!',
        new_password: 'brandNewSecurePassword999!',
      },
      token
    );
    const res = await credentialsRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success) {
      token = json.data.token;
      record(
        15,
        'UI_FLOW',
        'Password successfully changed with valid current password',
        true,
        'New password hash committed to database'
      );
    } else {
      record(15, 'UI_FLOW', 'Password change', false, JSON.stringify(json));
    }
  } catch (e: any) {
    record(15, 'UI_FLOW', 'Password change', false, e.message);
  }

  // 16. Incorrect current password is rejected
  try {
    const req = createJsonRequest(
      '/api/company/credentials',
      'PUT',
      {
        current_password: 'WRONG_PASSWORD_TEST',
        new_password: 'anotherPassword!',
      },
      token
    );
    const res = await credentialsRoute(req);
    record(
      16,
      'UI_FLOW',
      'Incorrect current password rejected with 401 Unauthorized',
      res.status === 401,
      `Status code: ${res.status}`
    );
  } catch (e: any) {
    record(16, 'UI_FLOW', 'Incorrect password rejection', false, e.message);
  }

  // 17. Logout clears session cookie
  try {
    const req = createJsonRequest('/api/auth/logout', 'POST');
    const res = await logoutRoute();
    const setCookie = res.headers.get('set-cookie');
    const cookieCleared = Boolean(setCookie && setCookie.includes('session=;'));

    record(
      17,
      'UI_FLOW',
      'Logout successfully expires session cookie',
      res.status === 200 && cookieCleared,
      `Cookie expiration header sent: ${cookieCleared}`
    );
  } catch (e: any) {
    record(17, 'UI_FLOW', 'Logout session clear', false, e.message);
  }

  // 18. Session expiration / unauthenticated returns user to login
  try {
    const expiredReq = createJsonRequest('/api/auth/me', 'GET', undefined, undefined, 'session=expired.or.invalid');
    const res = await authMeRoute(expiredReq);
    record(
      18,
      'UI_FLOW',
      'Invalid session cookie returns 401 (triggers redirect to /admin/login)',
      res.status === 401,
      `Status code: ${res.status}`
    );
  } catch (e: any) {
    record(18, 'UI_FLOW', 'Session expiration redirect', false, e.message);
  }

  // 19. Drive status placeholder returns 'Not Connected'
  try {
    const req = createJsonRequest('/api/google-drive/status', 'GET', undefined, token);
    const res = await driveStatusRoute(req);
    const json = await res.json();
    record(
      19,
      'UI_FLOW',
      'Google Drive status placeholder correctly reports Not Connected',
      res.status === 200 && json.data.connected === false,
      `Connected: ${json.data?.connected}`
    );
  } catch (e: any) {
    record(19, 'UI_FLOW', 'Drive status check', false, e.message);
  }

  // 20. Sync status placeholder returns 'Not synchronized'
  try {
    const req = createJsonRequest('/api/sync/status', 'GET', undefined, token);
    const res = await syncStatusRoute(req);
    const json = await res.json();
    record(
      20,
      'UI_FLOW',
      'Sync status placeholder correctly reports IDLE / Not synchronized',
      res.status === 200 && json.data.last_sync_at === null,
      `Last sync: ${json.data?.last_sync_at ?? 'null'}, Status: ${json.data?.sync_status}`
    );
  } catch (e: any) {
    record(20, 'UI_FLOW', 'Sync status check', false, e.message);
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('\n======================================================================');
  console.log(`STAGE 4 TEST SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage4Tests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
