import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { Company, CompanyJWTPayload } from './types';
import { db } from './db';

const BCRYPT_ROUNDS = 12;

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'dev-insecure-secret-key-32-characters-minimum-for-hs256';
  return new TextEncoder().encode(secret);
}

/**
 * Hash a plain text password using bcrypt with salt rounds 12.
 */
export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

/**
 * Verify a plain text password against a stored bcrypt hash.
 */
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}

/**
 * Sign a secure JWT session token for an authenticated company.
 * Default expiration: 7 days.
 */
export async function signCompanyToken(company: Company): Promise<string> {
  const payload: CompanyJWTPayload = {
    company_id: company.id,
    username: company.username,
    company_name: company.company_name,
    status: company.status,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

/**
 * Verify a JWT session token and return its decoded payload.
 */
export async function verifyCompanyToken(token: string): Promise<CompanyJWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });
    return payload as unknown as CompanyJWTPayload;
  } catch {
    return null;
  }
}

export type AuthResult =
  | { authenticated: true; company: Company }
  | { authenticated: false; error: string; status: number };

/**
 * Extract token from Authorization header or cookie and authenticate the company.
 *
 * CRITICAL SECURITY INVARIANTS:
 * 1. Company ID is determined strictly from the verified cryptographically signed JWT.
 * 2. Client-supplied company IDs in bodies/headers are completely ignored.
 * 3. Checks current database status; if company is DISABLED, rejects immediately.
 */
export async function authenticateRequest(request: Request): Promise<AuthResult> {
  let token: string | null = null;

  // 1. Check Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.slice(7).trim();
  }

  // 2. Check Cookie: session=<token>
  if (!token) {
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }
  }

  if (!token) {
    return {
      authenticated: false,
      error: 'Authentication token missing or invalid',
      status: 401,
    };
  }

  const payload = await verifyCompanyToken(token);
  if (!payload || !payload.company_id) {
    return {
      authenticated: false,
      error: 'Invalid or expired authentication session',
      status: 401,
    };
  }

  // Re-verify against active database state to enforce immediate revocation/disablement
  const company = await db.findCompanyById(payload.company_id);
  if (!company) {
    return {
      authenticated: false,
      error: 'Company account does not exist',
      status: 401,
    };
  }

  if (company.status === 'DISABLED') {
    return {
      authenticated: false,
      error: 'Company account has been disabled. Please contact your administrator.',
      status: 403,
    };
  }

  return {
    authenticated: true,
    company,
  };
}
