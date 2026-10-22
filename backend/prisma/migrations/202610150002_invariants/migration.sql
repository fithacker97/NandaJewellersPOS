
-- Additional database invariants beyond ORM validation.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_weight_positive" CHECK ("weight" > 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_surplus_nonnegative" CHECK ("surplus" >= 0);
ALTER TABLE "MetalRate" ADD CONSTRAINT "MetalRate_nonnegative" CHECK ("rate" >= 0);
ALTER TABLE "EmployeePricing" ADD CONSTRAINT "EmployeePricing_nonnegative" CHECK ("gold" >= 0 AND "silver" >= 0);
ALTER TABLE "InvoiceDraftLine" ADD CONSTRAINT "Draft_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_positive" CHECK ("quantity" > 0 AND "weight" > 0 AND "sellingRate" >= 0 AND "lineTotal" >= 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_totals_valid" CHECK ("total" >= 0 AND "totalPieces" > 0 AND "totalWeight" > 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "Movement_balanced" CHECK ("after" = "before" + "delta" AND "after" >= 0 AND "before" >= 0 AND "delta" <> 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "Movement_direction" CHECK (
  ("type" IN ('OPENING','RECEIPT') AND "delta" > 0) OR
  ("type" IN ('SALE','ARCHIVE_REMOVAL') AND "delta" < 0) OR "type" = 'ADJUSTMENT'
);
ALTER TABLE "Product" ADD FOREIGN KEY ("createdBy") REFERENCES "User"("id");
ALTER TABLE "Product" ADD FOREIGN KEY ("updatedBy") REFERENCES "User"("id");
ALTER TABLE "ProductPhoto" ADD FOREIGN KEY ("ownerId") REFERENCES "User"("id");
ALTER TABLE "EmployeePricing" ADD FOREIGN KEY ("updatedBy") REFERENCES "User"("id");
ALTER TABLE "MetalRate" ADD FOREIGN KEY ("updatedBy") REFERENCES "User"("id");
ALTER TABLE "MetalRateHistory" ADD FOREIGN KEY ("actorId") REFERENCES "User"("id");
ALTER TABLE "AuditLog" ADD FOREIGN KEY ("actorId") REFERENCES "User"("id");
ALTER TABLE "BusinessSettings" ADD FOREIGN KEY ("updatedBy") REFERENCES "User"("id");
CREATE FUNCTION protect_issued_invoice() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Issued invoice snapshots are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER invoice_immutable BEFORE UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION protect_issued_invoice();
CREATE TRIGGER invoice_line_immutable BEFORE UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION protect_issued_invoice();

ALTER TABLE "BusinessSettings" ADD CONSTRAINT "Low_stock_nonnegative" CHECK ("lowStockThreshold" >= 0);
