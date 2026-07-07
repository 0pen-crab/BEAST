export interface ValidationResult {
  valid: boolean;
  error?: string;
}

type Credentials = Record<string, string | undefined>;
type ValidatorFn = (credentials: Credentials) => Promise<ValidationResult>;

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function handleError(err: unknown, toolName: string): ValidationResult {
  if (err instanceof Error && err.name === 'AbortError') {
    return { valid: false, error: 'Connection timed out' };
  }
  return { valid: false, error: `Could not reach ${toolName} API` };
}

export async function validateGitGuardian(credentials: Credentials): Promise<ValidationResult> {
  const key = credentials['GITGUARDIAN_API_KEY'];
  if (!key) {
    return { valid: false, error: 'Missing API key' };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout('https://api.gitguardian.com/v1/health', {
      headers: { Authorization: `Token ${key}` },
    });
  } catch (err) {
    return handleError(err, 'GitGuardian');
  }

  if (response.status === 200) return { valid: true };
  if (response.status === 401) return { valid: false, error: 'Invalid API key' };
  if (response.status === 429) return { valid: false, error: 'Rate limited — try again in a moment' };

  return { valid: false, error: 'Could not reach GitGuardian API' };
}

export async function validateSnyk(credentials: Credentials): Promise<ValidationResult> {
  const token = credentials['SNYK_TOKEN'];
  if (!token) {
    return { valid: false, error: 'Missing API token' };
  }

  let response: Response;
  try {
    response = await fetchWithTimeout('https://api.snyk.io/rest/self?version=2024-10-15', {
      headers: { Authorization: `token ${token}` },
    });
  } catch (err) {
    return handleError(err, 'Snyk');
  }

  if (response.status === 200) return { valid: true };
  if (response.status === 401) return { valid: false, error: 'Invalid Snyk token' };

  return { valid: false, error: 'Could not reach Snyk API' };
}

export async function validateJFrog(credentials: Credentials): Promise<ValidationResult> {
  let url = credentials['JF_URL']?.trim().replace(/\/+$/, '');
  const token = credentials['JF_ACCESS_TOKEN'];

  if (!url) return { valid: false, error: 'Missing JFrog URL' };
  if (!token) return { valid: false, error: 'Missing access token' };

  // Auto-prepend https:// if no protocol specified
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }

  // Step 1: check URL reachability (no auth)
  let versionResponse: Response;
  try {
    versionResponse = await fetchWithTimeout(`${url}/xray/api/v1/system/version`);
  } catch {
    return { valid: false, error: `Could not reach JFrog instance at ${url}` };
  }

  if (!versionResponse.ok) {
    return { valid: false, error: `Could not reach JFrog instance at ${url}` };
  }

  // Step 2: exercise the exact operation BEAST needs — an Xray on-demand SCA
  // scan (scan/graph). A token can authenticate (e.g. against /access/...) yet
  // lack Xray scan permission; that used to surface only mid-scan as a 403.
  // Probing scan/graph here rejects a permission-less token at config time.
  let scanResponse: Response;
  try {
    scanResponse = await fetchWithTimeout(`${url}/xray/api/v1/scan/graph`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        component_id: 'root',
        nodes: [{ component_id: 'gav://junit:junit:4.12' }],
      }),
    });
  } catch (err) {
    return handleError(err, 'JFrog');
  }

  if (scanResponse.ok) return { valid: true }; // 200/201 — scan accepted
  if (scanResponse.status === 401) {
    return { valid: false, error: 'Invalid access token' };
  }
  if (scanResponse.status === 403) {
    return {
      valid: false,
      error:
        'Token authenticates but lacks Xray scan permission (scan/graph returned 403). Grant this token Xray scan access, then retry.',
    };
  }

  return { valid: false, error: `JFrog Xray scan check failed (HTTP ${scanResponse.status})` };
}

export function getValidator(toolKey: string): ValidatorFn | undefined {
  const validators: Record<string, ValidatorFn> = {
    gitguardian: validateGitGuardian,
    'snyk-code': validateSnyk,
    'snyk-sca': validateSnyk,
    'snyk-iac': validateSnyk,
    jfrog: validateJFrog,
  };
  return validators[toolKey];
}
