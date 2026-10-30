<?php
/**
 * Copy this file to api/config.php (or, safer, to a file named
 * neura-config.php one level ABOVE public_html) and fill in your values.
 * config.php is ignored by Git so your passwords never reach GitHub.
 */
return [
    // Hostinger: hPanel > Databases > MySQL Databases
    'db_host' => 'localhost',
    'db_name' => 'u123456789_neura',
    'db_user' => 'u123456789_neura',
    'db_pass' => 'CHANGE_ME',

    // Where new enrollment notifications are sent
    'notify_to' => 'you@example.com',
    // Must be a mailbox on your own domain (hPanel > Emails), or mail may be rejected
    'mail_from' => 'no-reply@your-domain.com',

    // Any long random string; used to anonymise visitor IPs for rate limiting
    'ip_salt' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',
];
