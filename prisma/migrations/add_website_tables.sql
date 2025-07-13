-- Add website-specific tables

-- Contact submissions from website
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

-- Website feedback (separate from app feedback)
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

-- Newsletter subscriptions
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

-- Download tracking
CREATE TABLE "download_tracking" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'website',
    "user_agent" TEXT,
    "ip_address" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_tracking_pkey" PRIMARY KEY ("id")
);

-- Create unique constraints
CREATE UNIQUE INDEX "newsletter_subscriptions_email_key" ON "newsletter_subscriptions"("email");

-- Create indexes for better performance
CREATE INDEX "contact_submissions_status_idx" ON "contact_submissions"("status");
CREATE INDEX "contact_submissions_created_at_idx" ON "contact_submissions"("created_at");
CREATE INDEX "website_feedback_rating_idx" ON "website_feedback"("rating");
CREATE INDEX "website_feedback_category_idx" ON "website_feedback"("category");
CREATE INDEX "download_tracking_source_idx" ON "download_tracking"("source");
CREATE INDEX "download_tracking_timestamp_idx" ON "download_tracking"("timestamp");