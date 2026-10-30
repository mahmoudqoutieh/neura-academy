-- Run once in Hostinger: hPanel > Databases > phpMyAdmin > (your database) > SQL
CREATE TABLE IF NOT EXISTS enrollments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(200) NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  track VARCHAR(120) NOT NULL,
  plan VARCHAR(20) NOT NULL DEFAULT 'monthly',
  ip_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  KEY enrollments_email_idx (email),
  KEY enrollments_ip_idx (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
