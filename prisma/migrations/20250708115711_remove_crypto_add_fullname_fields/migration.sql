/*
  Warnings:

  - The values [CRYPTO] on the enum `WithdrawalMethod` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `crypto_type` on the `withdrawal_requests` table. All the data in the column will be lost.
  - You are about to drop the column `crypto_wallet_address` on the `withdrawal_requests` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "BotGameResult" AS ENUM ('WIN', 'LOSS', 'DRAW');

-- AlterEnum
BEGIN;
CREATE TYPE "WithdrawalMethod_new" AS ENUM ('BANK', 'UPI');
ALTER TABLE "withdrawal_requests" ALTER COLUMN "method" TYPE "WithdrawalMethod_new" USING ("method"::text::"WithdrawalMethod_new");
ALTER TYPE "WithdrawalMethod" RENAME TO "WithdrawalMethod_old";
ALTER TYPE "WithdrawalMethod_new" RENAME TO "WithdrawalMethod";
DROP TYPE "WithdrawalMethod_old";
COMMIT;

-- AlterTable
ALTER TABLE "withdrawal_requests" DROP COLUMN "crypto_type",
DROP COLUMN "crypto_wallet_address",
ADD COLUMN     "bank_full_name" TEXT,
ADD COLUMN     "upi_full_name" TEXT;

-- CreateTable
CREATE TABLE "bot_statistics" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "games_played" INTEGER NOT NULL DEFAULT 0,
    "games_won" INTEGER NOT NULL DEFAULT 0,
    "games_lost" INTEGER NOT NULL DEFAULT 0,
    "total_earnings" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "avg_reaction_time" INTEGER NOT NULL DEFAULT 0,
    "memory_accuracy" DECIMAL(3,2) NOT NULL DEFAULT 0.50,
    "last_performance_adjustment" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "last_game_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_game_performance" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "opponent_id" TEXT NOT NULL,
    "result" "BotGameResult" NOT NULL,
    "moves_made" INTEGER NOT NULL DEFAULT 0,
    "successful_matches" INTEGER NOT NULL DEFAULT 0,
    "avg_move_time" INTEGER NOT NULL DEFAULT 0,
    "memory_utilization" DECIMAL(3,2) NOT NULL DEFAULT 0.00,
    "performance_factor" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "behavior_profile" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_game_performance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_adjustment_history" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "adjustment_factor" DECIMAL(3,2) NOT NULL,
    "reason" TEXT,
    "win_rate_before" DECIMAL(3,2),
    "win_rate_target" DECIMAL(3,2) NOT NULL DEFAULT 0.50,
    "games_analyzed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_adjustment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_game_sessions" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "session_data" JSONB,
    "behavior_profile" TEXT,
    "memory_state" JSONB,
    "performance_metrics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "app" TEXT NOT NULL DEFAULT 'budzee',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "response" TEXT,
    "responded_at" TIMESTAMP(3),
    "responded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_feedback" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "app" TEXT NOT NULL DEFAULT 'budzee',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "response" TEXT,
    "responded_at" TIMESTAMP(3),
    "responded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscriptions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "unsubscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_tracking" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'website',
    "user_agent" TEXT,
    "ip_address" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_statistics_bot_id_key" ON "bot_statistics"("bot_id");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscriptions_email_key" ON "newsletter_subscriptions"("email");

-- AddForeignKey
ALTER TABLE "bot_statistics" ADD CONSTRAINT "bot_statistics_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_game_performance" ADD CONSTRAINT "bot_game_performance_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_game_performance" ADD CONSTRAINT "bot_game_performance_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_game_performance" ADD CONSTRAINT "bot_game_performance_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_adjustment_history" ADD CONSTRAINT "bot_adjustment_history_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_game_sessions" ADD CONSTRAINT "bot_game_sessions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_game_sessions" ADD CONSTRAINT "bot_game_sessions_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
