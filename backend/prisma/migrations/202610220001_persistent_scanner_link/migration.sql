UPDATE "ScannerLink"
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "revokedAt" IS NULL AND "expiresAt" <= CURRENT_TIMESTAMP;

ALTER TABLE "ScannerLink" DROP COLUMN "expiresAt";
