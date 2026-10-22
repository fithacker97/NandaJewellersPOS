CREATE TABLE "ScannerLink" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "draftId" UUID NOT NULL REFERENCES "InvoiceDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "codeHash" TEXT NOT NULL UNIQUE,
  "tokenHash" TEXT UNIQUE,
  "pairingExpiresAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "pairedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ScannerLink_userId_draftId_idx" ON "ScannerLink"("userId","draftId");
CREATE TABLE "ScannerEvent" (
  "id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "linkId" UUID NOT NULL REFERENCES "ScannerLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "eventKey" TEXT NOT NULL,
  "barcode" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ScannerEvent_linkId_eventKey_key" ON "ScannerEvent"("linkId","eventKey");
