-- Create admins table
CREATE TABLE IF NOT EXISTS "admins" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  
  CONSTRAINT "admins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admins_username_key" UNIQUE ("username"),
  CONSTRAINT "admins_email_key" UNIQUE ("email")
);

-- Insert the admin user
INSERT INTO "admins" ("id", "username", "email", "password", "role", "created_at", "updated_at")
VALUES (
  'cuid_' || substr(md5(random()::text), 1, 24),
  'Ganesh Mudiraj',
  'ganeshmudiraj7tec@gmail.com',
  '$2a$10$YourHashedPasswordWillBeReplacedByScript',
  'SuperAdmin',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);