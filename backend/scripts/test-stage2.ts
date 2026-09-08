/**
 * Stage 2 Single-Company Automated Test Suite
 * Tests all single-company authentication, profile, credential management, and storage persistence:
 * 1. Initialize single-company store with configured admin credentials.
 * 2. Login using configured admin credentials.
 * 3. Verify JWT session token structure and validity.
 * 4. Verify /api/auth/me retrieves authenticated company profile.
 * 5. Update company profile (company name).
 * 6. Change username.
 * 7. Change password with mandatory current password verification.
 * 8. Verify old credentials no longer work.
 * 9. Verify new credentials work for authentication.
 * 10. Verify persistent storage survives simulated cold-start re-instantiation.
 * 11. Verify disabled company account cannot authenticate (403 Forbidden).
 * 12. Verify re-enabling company restores authentication.
 * 13. Verify password is stored strictly as a bcrypt hash (never plaintext).
 */

import { NextRequest } from 'next/server';
import { db, SingleCompanyStore } from '../src/lib/db';
import { POST as loginRoute } from '../src/app/api/auth/login/route';
import { GET as authMeRoute } from '../src/app/api/auth/me/route';
import { PUT as profileRoute } from '../src/app/api/company/profile/route';
import { PUT as credentialsRoute } from '../src/app/api/company/credentials/route';

interface TestResult {
  num: number;
  description: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(num: number, description: string, passed: boolean, details: string) {
  results.push({ num, description, passed, details });
  const badge = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`${badge} Test ${num}: ${description}`);
  if (!passed || process.env.VERBOSE) {
    console.log(`       Details: ${details}`);
  }
}

function createJsonRequest(url: string, method: string, body?: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function runStage2Tests() {
  console.log('\n======================================================');
  console.log('       STAGE 2: SINGLE-COMPANY AUTHENTICATION SUITE    ');
  console.log('======================================================\n');

  await db.clearAll();

  let token = '';
  let initialCompanyId = '';

  // -----------------------------------------------------------
  // Test 1: Initialize single-company store
  // -----------------------------------------------------------
  try {
    const company = await db.getCompany();
    if (company && company.username === 'admin' && company.status === 'ACTIVE') {
      initialCompanyId = company.id;
      record(1, 'Initialize single-company store with default admin credentials', true, `Company ID: ${company.id}, Name: ${company.company_name}`);
    } else {
      record(1, 'Initialize single-company store', false, `Unexpected config: ${JSON.stringify(company)}`);
    }
  } catch (err: any) {
    record(1, 'Initialize single-company store', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 2: Login using the configured credentials
  // -----------------------------------------------------------
  try {
    const req = createJsonRequest('/api/auth/login', 'POST', {
      username: 'admin',
      password: 'admin123!',
    });
    const res = await loginRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success && json.data.token) {
      token = json.data.token;
      record(2, 'Login using single-company credentials', true, `Received signed JWT token for ${json.data.company.username}`);
    } else {
      record(2, 'Login using single-company credentials', false, `Status: ${res.status}, Body: ${JSON.stringify(json)}`);
    }
  } catch (err: any) {
    record(2, 'Login using single-company credentials', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 3: Verify authentication token structure
  // -----------------------------------------------------------
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      record(3, 'Verify authentication token structure & validity', true, 'Valid 3-part cryptographic JWT received');
    } else {
      record(3, 'Verify authentication token structure & validity', false, 'Token missing or not in JWT format');
    }
  } catch (err: any) {
    record(3, 'Verify authentication', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 4: Verify /api/auth/me retrieves company profile
  // -----------------------------------------------------------
  try {
    const req = createJsonRequest('/api/auth/me', 'GET', undefined, token);
    const res = await authMeRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success && json.data.company.id === initialCompanyId) {
      record(4, 'Verify /api/auth/me retrieves authenticated company profile', true, `Company: ${json.data.company.company_name}`);
    } else {
      record(4, 'Verify /api/auth/me', false, `Status: ${res.status}, Body: ${JSON.stringify(json)}`);
    }
  } catch (err: any) {
    record(4, 'Verify /api/auth/me', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 5: Update company profile (company name)
  // -----------------------------------------------------------
  try {
    const req = createJsonRequest(
      '/api/company/profile',
      'PUT',
      { company_name: 'Raman Industrial Supply Co.' },
      token
    );
    const res = await profileRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success && json.data.company.company_name === 'Raman Industrial Supply Co.') {
      record(5, 'Update company profile name', true, 'Updated name to Raman Industrial Supply Co.');
    } else {
      record(5, 'Update company profile name', false, `Status: ${res.status}, Body: ${JSON.stringify(json)}`);
    }
  } catch (err: any) {
    record(5, 'Update company profile name', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 6: Change username
  // -----------------------------------------------------------
  try {
    const req = createJsonRequest(
      '/api/company/credentials',
      'PUT',
      {
        current_password: 'admin123!',
        new_username: 'raman_admin_2026',
      },
      token
    );
    const res = await credentialsRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success && json.data.company.username === 'raman_admin_2026') {
      token = json.data.token; // Update token with new username
      record(6, 'Change admin username', true, 'Username updated to raman_admin_2026');
    } else {
      record(6, 'Change admin username', false, `Status: ${res.status}, Body: ${JSON.stringify(json)}`);
    }
  } catch (err: any) {
    record(6, 'Change username', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 7: Change password with current password verification
  // -----------------------------------------------------------
  try {
    const req = createJsonRequest(
      '/api/company/credentials',
      'PUT',
      {
        current_password: 'admin123!',
        new_password: 'newSecureAdminPass456!',
      },
      token
    );
    const res = await credentialsRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success && json.data.token) {
      token = json.data.token;
      record(7, 'Change password with valid current password', true, 'Password changed and re-hashed');
    } else {
      record(7, 'Change password', false, `Status: ${res.status}, Body: ${JSON.stringify(json)}`);
    }
  } catch (err: any) {
    record(7, 'Change password', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 8: Verify old credentials no longer work
  // -----------------------------------------------------------
  try {
    // Attempt with old username
    const req1 = createJsonRequest('/api/auth/login', 'POST', {
      username: 'admin',
      password: 'admin123!',
    });
    const res1 = await loginRoute(req1);

    // Attempt with new username + old password
    const req2 = createJsonRequest('/api/auth/login', 'POST', {
      username: 'raman_admin_2026',
      password: 'admin123!',
    });
    const res2 = await loginRoute(req2);

    if (res1.status === 401 && res2.status === 401) {
      record(8, 'Verify old credentials no longer work', true, 'Both old username and old password rejected with 401');
    } else {
      record(8, 'Verify old credentials no longer work', false, `res1=${res1.status}, res2=${res2.status}`);
    }
  } catch (err: any) {
    record(8, 'Verify old credentials no longer work', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 9: Verify new credentials work for authentication
  // -----------------------------------------------------------
  try {
    const req = createJsonRequest('/api/auth/login', 'POST', {
      username: 'raman_admin_2026',
      password: 'newSecureAdminPass456!',
    });
    const res = await loginRoute(req);
    const json = await res.json();

    if (res.status === 200 && json.success && json.data.token) {
      token = json.data.token;
      record(9, 'Verify new credentials authenticate successfully', true, 'Authenticated successfully with new credentials');
    } else {
      record(9, 'Verify new credentials work', false, `Status: ${res.status}, Body: ${JSON.stringify(json)}`);
    }
  } catch (err: any) {
    record(9, 'Verify new credentials work', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 10: Persistent storage survives cold-start re-instantiation
  // -----------------------------------------------------------
  try {
    // Create a brand new SingleCompanyStore instance (simulating cold serverless instance)
    const coldStore = new SingleCompanyStore();
    const loaded = await coldStore.getCompany();

    const survives =
      loaded.username === 'raman_admin_2026' &&
      loaded.company_name === 'Raman Industrial Supply Co.';

    if (survives) {
      record(
        10,
        'Verify persistent storage survives simulated cold-start re-instantiation',
        true,
        `Re-hydrated: Name='${loaded.company_name}', Username='${loaded.username}'`
      );
    } else {
      record(10, 'Verify persistent storage cold start', false, `Loaded: ${JSON.stringify(loaded)}`);
    }
  } catch (err: any) {
    record(10, 'Verify persistent storage cold start', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 11: Verify disabled company cannot authenticate
  // -----------------------------------------------------------
  try {
    await db.updateCompanyStatus(initialCompanyId, 'DISABLED');

    const reqLogin = createJsonRequest('/api/auth/login', 'POST', {
      username: 'raman_admin_2026',
      password: 'newSecureAdminPass456!',
    });
    const resLogin = await loginRoute(reqLogin);

    const reqMe = createJsonRequest('/api/auth/me', 'GET', undefined, token);
    const resMe = await authMeRoute(reqMe);

    if (resLogin.status === 403 && resMe.status === 403) {
      record(11, 'Verify disabled company account is rejected with 403 Forbidden', true, 'Both login and active JWT rejected');
    } else {
      record(11, 'Verify disabled company account', false, `Login: ${resLogin.status}, Me: ${resMe.status}`);
    }
  } catch (err: any) {
    record(11, 'Verify disabled company account', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 12: Verify re-enabling company restores access
  // -----------------------------------------------------------
  try {
    await db.updateCompanyStatus(initialCompanyId, 'ACTIVE');

    const reqLogin = createJsonRequest('/api/auth/login', 'POST', {
      username: 'raman_admin_2026',
      password: 'newSecureAdminPass456!',
    });
    const resLogin = await loginRoute(reqLogin);
    const jsonLogin = await resLogin.json();

    if (resLogin.status === 200 && jsonLogin.success) {
      token = jsonLogin.data.token;
      record(12, 'Verify re-enabling account restores authentication', true, 'Restored active status');
    } else {
      record(12, 'Verify re-enabling account', false, `Status: ${resLogin.status}`);
    }
  } catch (err: any) {
    record(12, 'Verify re-enabling account', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Test 13: Verify passwords stored only as bcrypt hashes
  // -----------------------------------------------------------
  try {
    const company = await db.getCompany();
    const hash = company.password_hash;

    const isBcrypt = (hash.startsWith('$2a$') || hash.startsWith('$2b$')) && hash.length === 60;
    const noPlaintext = hash !== 'admin123!' && hash !== 'newSecureAdminPass456!';

    if (isBcrypt && noPlaintext) {
      record(
        13,
        'Verify passwords are stored strictly as bcrypt hashes',
        true,
        `Bcrypt hash format verified (len: ${hash.length}): ${hash.substring(0, 15)}...`
      );
    } else {
      record(13, 'Verify passwords are stored only as hashes', false, `Hash: ${hash}`);
    }
  } catch (err: any) {
    record(13, 'Verify passwords are stored only as hashes', false, `Exception: ${err.message}`);
  }

  // -----------------------------------------------------------
  // Summary
  // -----------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('\n======================================================');
  console.log(`TEST SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runStage2Tests().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
