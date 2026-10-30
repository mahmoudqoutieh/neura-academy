<?php
declare(strict_types=1);

/**
 * Enrollment endpoint: validates the form, stores it in MySQL, emails the admin.
 * Responds with JSON: {"ok": true} or {"ok": false, "message": "..."}.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'message' => 'Method not allowed']);
}

// Prefer a config file outside public_html; fall back to api/config.php.
$configPaths = [
    dirname(__DIR__, 2) . '/neura-config.php',
    __DIR__ . '/config.php',
];
$config = null;
foreach ($configPaths as $path) {
    if (is_file($path)) {
        $config = require $path;
        break;
    }
}
if (!is_array($config)) {
    error_log('neura enroll: config file missing');
    respond(500, ['ok' => false, 'message' => 'تعذّر حفظ طلبك الآن. حاول مرة أخرى بعد قليل.']);
}

$field = static function (string $key, int $max): string {
    $value = trim((string)($_POST[$key] ?? ''));
    return mb_substr($value, 0, $max);
};

// Bots fill the hidden "website" field; pretend success and drop it.
if ($field('website', 200) !== '') {
    respond(200, ['ok' => true]);
}

$tracks = [
    'أساسيات الذكاء الاصطناعي',
    'Python لعلم البيانات',
    'تعلم الآلة التطبيقي',
    'التعلم العميق والشبكات العصبية',
    'هندسة النماذج اللغوية وبناء الوكلاء',
    'الذكاء الاصطناعي للقادة والأعمال',
];
$plans = ['monthly' => 'الخطة الشهرية', 'yearly' => 'الخطة السنوية'];

$name = $field('name', 120);
$email = $field('email', 200);
$phone = $field('phone', 40);
$track = $field('track', 120);
$plan = $field('plan', 20);

if (mb_strlen($name) < 2) {
    respond(422, ['ok' => false, 'message' => 'اكتب اسمك الكامل.']);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(422, ['ok' => false, 'message' => 'تأكد من كتابة بريد إلكتروني صحيح.']);
}
if ($phone !== '' && !preg_match('/^[0-9+\-\s()]{6,40}$/', $phone)) {
    respond(422, ['ok' => false, 'message' => 'رقم الهاتف غير صحيح.']);
}
if (!in_array($track, $tracks, true)) {
    $track = $tracks[0];
}
if (!isset($plans[$plan])) {
    $plan = 'monthly';
}

$ipHash = hash('sha256', ($config['ip_salt'] ?? '') . ($_SERVER['REMOTE_ADDR'] ?? ''));

try {
    $dsn = $config['db_dsn'] ?? sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        $config['db_host'],
        $config['db_name']
    );
    $pdo = new PDO($dsn, $config['db_user'] ?? null, $config['db_pass'] ?? null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    // At most 5 submissions per visitor every 10 minutes.
    $since = gmdate('Y-m-d H:i:s', time() - 600);
    $recent = $pdo->prepare('SELECT COUNT(*) FROM enrollments WHERE ip_hash = ? AND created_at > ?');
    $recent->execute([$ipHash, $since]);
    if ((int)$recent->fetchColumn() >= 5) {
        respond(429, ['ok' => false, 'message' => 'أرسلت عدة طلبات خلال وقت قصير. حاول بعد قليل.']);
    }

    $insert = $pdo->prepare(
        'INSERT INTO enrollments (name, email, phone, track, plan, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    $insert->execute([$name, mb_strtolower($email), $phone, $track, $plan, $ipHash, gmdate('Y-m-d H:i:s')]);
} catch (Throwable $e) {
    error_log('neura enroll: ' . $e->getMessage());
    respond(500, ['ok' => false, 'message' => 'تعذّر حفظ طلبك الآن. حاول مرة أخرى بعد قليل.']);
}

// Notification email. A failure here never loses the saved enrollment.
if (!empty($config['notify_to']) && !empty($config['mail_from'])) {
    $subject = '=?UTF-8?B?' . base64_encode('طلب تسجيل جديد: ' . $name) . '?=';
    $body = "طلب تسجيل جديد في أكاديمية نيورا\n\n"
        . "الاسم: {$name}\n"
        . "البريد: {$email}\n"
        . 'الهاتف: ' . ($phone !== '' ? $phone : '-') . "\n"
        . "المسار: {$track}\n"
        . "الخطة: {$plans[$plan]}\n"
        . 'الوقت (UTC): ' . gmdate('Y-m-d H:i') . "\n";
    $headers = [
        'From: ' . $config['mail_from'],
        'Reply-To: ' . $email,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
    ];
    @mail($config['notify_to'], $subject, $body, implode("\r\n", $headers));
}

respond(200, ['ok' => true]);
