<?php
// Proxy from the panel to the Observer API, for hosts where the web server itself cannot
// be configured (shared hosting). The browser cannot call the API directly: the API does
// not accept the X-Observer-Id and X-Observer-Key headers in a browser preflight (CORS).
//
// .htaccess (Apache) or web.config (IIS) sends /observer-api/<environment>/<path> here,
// as ?env=<environment>&path=<path>, with the original query string appended.
// observer-api.config.json, written by the build, holds the API of each environment.

header('Cache-Control: no-store');

function fail(int $status, string $message): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
    exit;
}

$config = json_decode((string) @file_get_contents(__DIR__ . '/observer-api.config.json'), true);
if (!is_array($config)) {
    fail(500, 'observer-api.config.json is missing next to observer-api.php: publish the whole dist folder');
}

$environment = $_GET['env'] ?? '';
$path = $_GET['path'] ?? '';

if (!isset($config[$environment]) || !is_string($config[$environment])) {
    fail(404, 'Unknown environment');
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    fail(405, 'Only GET is forwarded');
}
// Only plain API paths: the proxy never leaves the API of the environment
if (!preg_match('#^[A-Za-z0-9._~/-]*$#', $path) || strpos($path, '..') !== false) {
    fail(400, 'Invalid path');
}

$query = $_GET;
unset($query['env'], $query['path']);
$url = rtrim($config[$environment], '/') . '/' . $path . (count($query) > 0 ? '?' . http_build_query($query) : '');

// Only the headers the API needs are forwarded
$headers = ['Accept: application/json'];
foreach (['HTTP_X_OBSERVER_ID' => 'X-Observer-Id', 'HTTP_X_OBSERVER_KEY' => 'X-Observer-Key'] as $server => $name) {
    if (isset($_SERVER[$server])) {
        $headers[] = $name . ': ' . $_SERVER[$server];
    }
}

if (!function_exists('curl_init')) {
    fail(500, 'The PHP curl extension is not enabled on this host');
}

$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 30,
]);
$body = curl_exec($curl);

if ($body === false) {
    fail(502, 'Observer API not reachable from this host: ' . curl_error($curl));
}

http_response_code((int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE));
header('Content-Type: ' . (curl_getinfo($curl, CURLINFO_CONTENT_TYPE) ?: 'application/json'));
echo $body;
