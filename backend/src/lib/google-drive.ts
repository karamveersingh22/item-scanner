import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Company } from './types';
import { decryptToken } from './encryption';

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

function getOAuth2Config() {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const fallbackRedirect = appUrl
    ? `${appUrl.replace(/\/$/, '')}/api/google-drive/callback`
    : 'http://localhost:3000/api/google-drive/callback';

  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || fallbackRedirect,
  };
}

export function createOAuth2Client(): OAuth2Client {
  const { clientId, clientSecret, redirectUri } = getOAuth2Config();
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

/**
 * Generate a cryptographically signed state parameter to prevent CSRF and session hijacking.
 * Format: base64({ company_id, timestamp, nonce }).hmacSignature
 */
export function generateOAuthState(company_id: string): string {
  const secret = process.env.JWT_SECRET || 'dev-insecure-secret-key-32-characters-minimum-for-hs256';
  const data = JSON.stringify({
    company_id,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });

  const encodedData = Buffer.from(data).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedData)
    .digest('base64url');

  return `${encodedData}.${signature}`;
}

/**
 * Validate the state parameter and extract the authenticated company_id.
 */
export function verifyOAuthState(state: string): { valid: boolean; company_id?: string; error?: string } {
  try {
    const parts = state.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Malformed OAuth state parameter' };
    }

    const [encodedData, signature] = parts;
    const secret = process.env.JWT_SECRET || 'dev-insecure-secret-key-32-characters-minimum-for-hs256';

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(encodedData)
      .digest('base64url');

    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid state signature (tampering detected)' };
    }

    const json = JSON.parse(Buffer.from(encodedData, 'base64url').toString('utf8'));
    // State expires after 15 minutes
    if (Date.now() - json.timestamp > 15 * 60 * 1000) {
      return { valid: false, error: 'OAuth state expired' };
    }

    return { valid: true, company_id: json.company_id };
  } catch {
    return { valid: false, error: 'Failed to decode state' };
  }
}

/**
 * Generate the Google authorization URL for the company.
 */
export function getAuthorizationUrl(company_id: string): string {
  const { clientId } = getOAuth2Config();

  // If mock mode is active (for automated testing or local dev without Google credentials)
  if (!clientId || process.env.MOCK_GOOGLE_DRIVE === 'true') {
    const state = generateOAuthState(company_id);
    return `/api/google-drive/callback?code=mock-auth-code-stage-5&state=${state}`;
  }

  const oauth2Client = createOAuth2Client();
  const state = generateOAuthState(company_id);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Requests refresh_token
    prompt: 'consent',     // Ensures refresh_token is returned every time
    scope: DRIVE_SCOPES,
    state,
  });
}

/**
 * Exchange the authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  email?: string;
}> {
  const { clientId, clientSecret } = getOAuth2Config();

  // Mock exchange for test suite or development without Google Cloud setup
  if (!clientId || !clientSecret || code.startsWith('mock-auth-code') || process.env.MOCK_GOOGLE_DRIVE === 'true') {
    return {
      access_token: 'mock-access-token-' + crypto.randomBytes(8).toString('hex'),
      refresh_token: 'mock-refresh-token-' + crypto.randomBytes(16).toString('hex'),
      email: 'company-drive@example.com',
    };
  }

  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Please re-authorize and select consent.'
    );
  }

  let email: string | undefined;
  if (tokens.id_token) {
    try {
      const ticket = await oauth2Client.verifyIdToken({
        idToken: tokens.id_token,
        audience: clientId,
      });
      email = ticket.getPayload()?.email;
    } catch {
      // Best-effort email extraction
    }
  }

  return {
    access_token: tokens.access_token || '',
    refresh_token: tokens.refresh_token,
    email,
  };
}

/**
 * Obtain a fresh access token using the company's stored encrypted refresh token.
 */
export async function getFreshAccessToken(company: Company): Promise<string> {
  if (!company.google_refresh_token) {
    throw new Error('Google Drive is not connected for this company.');
  }

  const plainRefreshToken = decryptToken(company.google_refresh_token);

  // Mock mode check
  if (plainRefreshToken.startsWith('mock-refresh-token') || process.env.MOCK_GOOGLE_DRIVE === 'true') {
    return 'mock-access-token-' + crypto.randomBytes(8).toString('hex');
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: plainRefreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();
  if (!credentials.access_token) {
    throw new Error('Could not refresh Google access token. Reauthorization may be required.');
  }

  return credentials.access_token;
}

/**
 * List spreadsheets (.xlsx) and folders from the company's connected Google Drive.
 */
export async function listSpreadsheetsInDrive(company: Company): Promise<DriveFileItem[]> {
  const accessToken = await getFreshAccessToken(company);

  // Mock list for testing
  if (accessToken.startsWith('mock-access-token') || process.env.MOCK_GOOGLE_DRIVE === 'true') {
    return [
      {
        id: 'mock-file-id-itemmast-001',
        name: 'itemmast.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        modifiedTime: new Date().toISOString(),
        size: '1116524',
      },
      {
        id: 'mock-file-id-backup-002',
        name: 'backup_inventory.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        modifiedTime: new Date(Date.now() - 86400000).toISOString(),
        size: '850120',
      },
      {
        id: 'mock-file-id-old-003',
        name: 'old_itemmast.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        modifiedTime: new Date(Date.now() - 172800000).toISOString(),
        size: '1024000',
      },
    ];
  }

  // Live Google Drive API call
  // Query for .xlsx mime types or spreadsheets not trashed
  const query = "trashed = false and (mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains '.xlsx')";
  const fields = 'files(id, name, mimeType, modifiedTime, size)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=50`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google Drive API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.files || []) as DriveFileItem[];
}

/**
 * Test & Development Mock Store for Drive Files
 */
interface MockDriveFileData {
  buffer: Buffer;
  md5Checksum?: string;
  modifiedTime?: string;
  size?: number;
}

const mockDriveFiles = new Map<string, MockDriveFileData>();

export function setMockDriveFile(companyId: string, data: MockDriveFileData) {
  mockDriveFiles.set(companyId, data);
}

export function clearMockDriveFiles() {
  mockDriveFiles.clear();
}

/**
 * Fetch Drive file metadata (modifiedTime, size, md5Checksum) for change-detection optimization.
 */
export async function getDriveFileMetadata(company: Company): Promise<{
  modifiedTime?: string;
  size?: string;
  md5Checksum?: string;
}> {
  if (!company.google_drive_file_id) {
    throw new Error('No Google Drive file selected.');
  }

  const accessToken = await getFreshAccessToken(company);

  // Mock Mode
  if (accessToken.startsWith('mock-access-token') || process.env.MOCK_GOOGLE_DRIVE === 'true') {
    const mock = mockDriveFiles.get(company.id);
    if (mock) {
      return {
        modifiedTime: mock.modifiedTime || new Date().toISOString(),
        size: mock.size ? String(mock.size) : String(mock.buffer.length),
        md5Checksum: mock.md5Checksum || crypto.createHash('md5').update(mock.buffer).digest('hex'),
      };
    }
    return {
      modifiedTime: '2026-09-07T10:00:00.000Z',
      size: '15420',
      md5Checksum: 'mock-md5-itemmast-v1',
    };
  }

  const fields = 'id,name,mimeType,modifiedTime,size,md5Checksum';
  const url = `https://www.googleapis.com/drive/v3/files/${company.google_drive_file_id}?fields=${encodeURIComponent(fields)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google Drive API error (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  return {
    modifiedTime: data.modifiedTime,
    size: data.size,
    md5Checksum: data.md5Checksum,
  };
}

/**
 * Downloads the binary contents of the company's selected Google Drive file.
 */
export async function downloadDriveFile(company: Company): Promise<{
  buffer: Buffer;
  md5Checksum?: string;
  modifiedTime?: string;
  size?: number;
}> {
  if (!company.google_drive_file_id) {
    throw new Error('No Google Drive file selected for this company.');
  }

  const accessToken = await getFreshAccessToken(company);

  // Mock Mode
  if (accessToken.startsWith('mock-access-token') || process.env.MOCK_GOOGLE_DRIVE === 'true') {
    const mock = mockDriveFiles.get(company.id);
    if (mock) {
      return {
        buffer: mock.buffer,
        md5Checksum: mock.md5Checksum || crypto.createHash('md5').update(mock.buffer).digest('hex'),
        modifiedTime: mock.modifiedTime || new Date().toISOString(),
        size: mock.size || mock.buffer.length,
      };
    }

    // Default mock itemmast.xlsx file
    const { createMockXlsxBuffer } = await import('./excel-parser');
    const defaultBuffer = createMockXlsxBuffer([
      {
        I_CODE: '001001',
        ITEM_NAME: 'Wireless Optical Mouse',
        DESCRIBE: 'Ergonomic 2.4GHz USB Mouse',
        QUANTITY: '150',
        RATE: '499.00',
        DISC_PER: '10',
        DISC_B: '5.00',
      },
      {
        I_CODE: '001002',
        ITEM_NAME: 'Mechanical Gaming Keyboard',
        DESCRIBE: 'RGB Backlit Blue Switches',
        QUANTITY: '75',
        RATE: '2499.00',
        DISC_PER: '15',
        DISC_B: '50.00',
      },
      {
        I_CODE: '001003',
        ITEM_NAME: 'USB-C Fast Charging Cable',
        DESCRIBE: 'Braided 1.8m 60W Power Delivery',
        QUANTITY: '300',
        RATE: '299.00',
        DISC_PER: '5',
        DISC_B: '0.00',
      },
      {
        I_CODE: '001004',
        ITEM_NAME: 'Noise-Cancelling Headphones',
        DESCRIBE: 'Over-ear Bluetooth 5.2 headset',
        QUANTITY: '40',
        RATE: '4999.00',
        DISC_PER: '20',
        DISC_B: '100.00',
      },
      {
        I_CODE: '001005',
        ITEM_NAME: 'Laptop Stand Aluminum',
        DESCRIBE: 'Adjustable folding riser for 11-17 inch',
        QUANTITY: '90',
        RATE: '1299.00',
        DISC_PER: '10',
        DISC_B: '20.00',
      },
    ]);

    return {
      buffer: defaultBuffer,
      md5Checksum: crypto.createHash('md5').update(defaultBuffer).digest('hex'),
      modifiedTime: '2026-09-07T10:00:00.000Z',
      size: defaultBuffer.length,
    };
  }

  // Live Google Drive API Media Download
  const url = `https://www.googleapis.com/drive/v3/files/${company.google_drive_file_id}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google Drive download failed (${response.status}): ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    buffer,
    size: buffer.length,
    md5Checksum: crypto.createHash('md5').update(buffer).digest('hex'),
    modifiedTime: new Date().toISOString(),
  };
}

/**
 * Test if the stored connection is healthy and responsive.
 */
export async function testDriveConnection(company: Company): Promise<{
  connected: boolean;
  message: string;
  fileName?: string | null;
}> {
  if (!company.google_refresh_token) {
    return { connected: false, message: 'Google Drive is not connected.' };
  }

  try {
    await getFreshAccessToken(company);
    return {
      connected: true,
      message: 'Connection verified successfully. Authorization is active.',
      fileName: company.google_drive_file_name,
    };
  } catch (err: any) {
    return {
      connected: false,
      message: `Connection test failed: ${err.message}`,
    };
  }
}

