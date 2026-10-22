CREATE TYPE "Role" AS ENUM ('ADMIN','EMPLOYEE');
CREATE TYPE "Metal" AS ENUM ('GOLD','SILVER');
CREATE TYPE "MovementType" AS ENUM ('OPENING','RECEIPT','SALE','ADJUSTMENT','ARCHIVE_REMOVAL');
CREATE TABLE "User" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"name" TEXT NOT NULL,
"email" TEXT NOT NULL UNIQUE,
"passwordHash" TEXT NOT NULL,
"role" "Role" NOT NULL,
"active" BOOLEAN NOT NULL DEFAULT true,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "EmployeePricing" (
"userId" UUID NOT NULL PRIMARY KEY,
"gold" DECIMAL(18,4) NOT NULL DEFAULT 0,
"silver" DECIMAL(18,4) NOT NULL DEFAULT 0,
"updatedBy" UUID NOT NULL,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MetalRate" (
"metal" "Metal" NOT NULL PRIMARY KEY,
"rate" DECIMAL(18,4) NOT NULL,
"updatedBy" UUID,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "MetalRateHistory" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"metal" "Metal" NOT NULL,
"previous" DECIMAL(18,4) NOT NULL,
"rate" DECIMAL(18,4) NOT NULL,
"actorId" UUID NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Product" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"barcode" TEXT NOT NULL UNIQUE,
"name" TEXT NOT NULL,
"metal" "Metal" NOT NULL,
"weight" DECIMAL(14,4) NOT NULL,
"surplus" DECIMAL(18,4) NOT NULL,
"quantity" INTEGER NOT NULL DEFAULT 0,
"active" BOOLEAN NOT NULL DEFAULT true,
"version" INTEGER NOT NULL DEFAULT 1,
"createdBy" UUID NOT NULL,
"updatedBy" UUID NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Product_active_metal_createdAt_idx" ON "Product" ("active","metal","createdAt");
CREATE TABLE "ProductPhoto" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"productId" UUID UNIQUE,
"ownerId" UUID NOT NULL,
"key" TEXT NOT NULL UNIQUE,
"thumbnailKey" TEXT NOT NULL UNIQUE,
"width" INTEGER NOT NULL,
"height" INTEGER NOT NULL,
"bytes" INTEGER NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "StockMovement" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"productId" UUID NOT NULL,
"productName" TEXT NOT NULL,
"barcode" TEXT NOT NULL,
"metal" "Metal" NOT NULL,
"weight" DECIMAL(14,4) NOT NULL,
"type" "MovementType" NOT NULL,
"delta" INTEGER NOT NULL,
"before" INTEGER NOT NULL,
"after" INTEGER NOT NULL,
"actorId" UUID NOT NULL,
"reason" TEXT NOT NULL,
"invoiceId" UUID,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement" ("createdAt");
CREATE TABLE "InvoiceDraft" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"userId" UUID NOT NULL,
"currentKey" UUID UNIQUE,
"customerName" TEXT NOT NULL DEFAULT '',
"customerPhone" TEXT NOT NULL DEFAULT '',
"note" TEXT NOT NULL DEFAULT '',
"revision" INTEGER NOT NULL DEFAULT 1,
"issuedAt" TIMESTAMP(3),
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "InvoiceDraftLine" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"draftId" UUID NOT NULL,
"productId" UUID NOT NULL,
"quantity" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "InvoiceDraftLine_draftId_productId_key" ON "InvoiceDraftLine" ("draftId","productId");
CREATE TABLE "Invoice" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"number" TEXT NOT NULL UNIQUE,
"issuanceKey" UUID NOT NULL UNIQUE,
"draftId" UUID NOT NULL UNIQUE,
"sellerId" UUID NOT NULL,
"sellerName" TEXT NOT NULL,
"customerName" TEXT NOT NULL,
"customerPhone" TEXT NOT NULL,
"note" TEXT NOT NULL,
"businessName" TEXT NOT NULL,
"businessAddress" TEXT NOT NULL,
"businessPhone" TEXT NOT NULL,
"total" DECIMAL(32,2) NOT NULL,
"totalWeight" DECIMAL(24,4) NOT NULL,
"totalPieces" INTEGER NOT NULL,
"issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Invoice_sellerId_issuedAt_idx" ON "Invoice" ("sellerId","issuedAt");
CREATE TABLE "InvoiceLine" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"invoiceId" UUID NOT NULL,
"productId" UUID NOT NULL,
"productName" TEXT NOT NULL,
"barcode" TEXT NOT NULL,
"metal" "Metal" NOT NULL,
"weight" DECIMAL(14,4) NOT NULL,
"quantity" INTEGER NOT NULL,
"sellingRate" DECIMAL(18,4) NOT NULL,
"lineTotal" DECIMAL(32,2) NOT NULL
);

CREATE TABLE "InvoiceSequence" (
"year" INTEGER NOT NULL PRIMARY KEY,
"value" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "AuditLog" (
"id" UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
"actorId" UUID NOT NULL,
"action" TEXT NOT NULL,
"entityId" TEXT NOT NULL,
"details" JSONB NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt");
CREATE TABLE "BusinessSettings" (
"id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
"name" TEXT NOT NULL DEFAULT 'NANDA JEWELLERS',
"address" TEXT NOT NULL DEFAULT '',
"phone" TEXT NOT NULL DEFAULT '',
"lowStockThreshold" INTEGER NOT NULL DEFAULT 3,
"updatedBy" UUID,
"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Session" (
"id" TEXT NOT NULL PRIMARY KEY,
"userId" UUID NOT NULL,
"expiresAt" TIMESTAMP(3) NOT NULL,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Session_userId_idx" ON "Session" ("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session" ("expiresAt");
ALTER TABLE "EmployeePricing" ADD CONSTRAINT "EmployeePricing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductPhoto" ADD CONSTRAINT "ProductPhoto_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceDraft" ADD CONSTRAINT "InvoiceDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceDraftLine" ADD CONSTRAINT "InvoiceDraftLine_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InvoiceDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceDraftLine" ADD CONSTRAINT "InvoiceDraftLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "InvoiceDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;