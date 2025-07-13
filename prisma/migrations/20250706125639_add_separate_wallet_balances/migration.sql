-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "game_balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "withdrawable_balance" DECIMAL(10,2) NOT NULL DEFAULT 0;
