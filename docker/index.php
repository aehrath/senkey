<?php
/**
 * SenKey Credentials API — Cloud Run + GCS edition, multi-user
 *
 * Auth: X-API-Key (server access gate) + Google OAuth Bearer token (per-user identity)
 * Each user's credentials are stored as credentials/{google_sub}.json in the GCS bucket.
 *
 * Environment variables (set via deploy.sh / Cloud Run console):
 *   API_KEY     → shared secret distributed to your users
 *   GCS_BUCKET  → your GCS bucket name (created by deploy.sh)
 *   CHROME_EXTENSION_ID → fixed SenKey Chrome Web Store extension ID, useful for OAuth setup reference
 */

$apiKey    = getenv('API_KEY')    ?: 'CHANGE_ME';
$gcsBucket = getenv('GCS_BUCKET') ?: '';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); exit;
}

// Server-level access gate
if (($_SERVER['HTTP_X_API_KEY'] ?? '') !== $apiKey) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']); exit;
}

if (!$gcsBucket) {
    http_response_code(500);
    echo json_encode(['error' => 'GCS_BUCKET env var not set']); exit;
}

// ---- GCS helpers ----
function getServiceAccountToken(): string {
    $ctx = stream_context_create(['http' => [
        'header'  => "Metadata-Flavor: Google\r\n",
        'timeout' => 3,
    ]]);
    $tok = @file_get_contents(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        false, $ctx
    );
    if (!$tok) throw new RuntimeException('Could not fetch access token from metadata server');
    return json_decode($tok, true)['access_token'];
}

function gcsRead(string $bucket, string $object, string $token): array {
    $url = "https://storage.googleapis.com/storage/v1/b/{$bucket}/o/" . rawurlencode($object) . "?alt=media";
    $ctx = stream_context_create(['http' => [
        'header'        => "Authorization: Bearer {$token}\r\n",
        'ignore_errors' => true,
        'timeout'       => 10,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false || str_contains($http_response_header[0] ?? '', '404')) return [];
    return json_decode($body, true) ?? [];
}

function gcsWrite(string $bucket, string $object, array $data, string $token): void {
    $json = json_encode($data, JSON_PRETTY_PRINT);
    $url  = "https://storage.googleapis.com/upload/storage/v1/b/{$bucket}/o?uploadType=media&name=" . rawurlencode($object);
    $ctx  = stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\nContent-Length: " . strlen($json) . "\r\n",
        'content'       => $json,
        'ignore_errors' => true,
        'timeout'       => 10,
    ]]);
    @file_get_contents($url, false, $ctx);
}

// ---- Verify user's Google token and return their stable sub ----
function verifyGoogleToken(string $token): string {
    $ctx = stream_context_create(['http' => [
        'header'        => "Authorization: Bearer {$token}\r\n",
        'ignore_errors' => true,
        'timeout'       => 5,
    ]]);
    $body = @file_get_contents('https://www.googleapis.com/oauth2/v3/userinfo', false, $ctx);
    if (!$body) {
        http_response_code(401);
        echo json_encode(['error' => 'Could not verify Google token']); exit;
    }
    $info = json_decode($body, true) ?? [];
    if (empty($info['sub'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid Google token']); exit;
    }
    return $info['sub'];
}

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    http_response_code(401);
    echo json_encode(['error' => 'Google sign-in required']); exit;
}

$userId    = verifyGoogleToken($m[1]);
$gcsObject = 'credentials/' . preg_replace('/[^a-z0-9]/i', '', $userId) . '.json';

// ---- Route ----
try {
    $saToken = getServiceAccountToken();
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $creds   = gcsRead($gcsBucket, $gcsObject, $saToken);
    $method  = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        echo json_encode(['credentials' => array_values($creds)]);

    } elseif ($method === 'POST') {
        $domain   = trim($body['domain']   ?? '');
        $username = trim($body['username'] ?? '');
        $password = trim($body['password'] ?? '');
        $loginUrl = trim($body['loginUrl'] ?? '');
        if (!$domain || !$username || !$password) {
            http_response_code(400);
            echo json_encode(['error' => 'domain, username, and password required']); exit;
        }
        $id = md5($domain . '|' . $username);
        $entry = compact('id', 'domain', 'username', 'password') + ['updated' => date('c')];
        if ($loginUrl !== '') $entry['loginUrl'] = $loginUrl;
        $creds[$id] = $entry;
        gcsWrite($gcsBucket, $gcsObject, $creds, $saToken);
        echo json_encode(['success' => true, 'id' => $id]);

    } elseif ($method === 'DELETE') {
        $id = trim($body['id'] ?? '');
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id required']); exit; }
        unset($creds[$id]);
        gcsWrite($gcsBucket, $gcsObject, $creds, $saToken);
        echo json_encode(['success' => true]);

    } else {
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
    }

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
