import { expect, it, vi } from "vitest";
vi.mock("@/lib/runtime/model-runtime", () => ({callClaude: vi.fn()}));
import { groundedExtraction } from "./extraction";
import { schemaOrders, orderExtraction } from "./structured-order";
const good = {merchant: "Store", amountMinor: 1000, currency: "USD", date: "2026-09-20", type: "charge", category: "shopping", orderId: "1234", confidence: 0.95};
it("grounds real amounts and order IDs", () => expect(groundedExtraction(good, "Order 1234 total $10.00", "2026-09-22")).toEqual(good));
it.each([{amountMinor: 202600}, {date: "2026-02-30"}, {date: "2026-09-25"}, {confidence: 0.4}, {orderId: "9999"}])("rejects ungrounded extraction %j", patch => expect(() => groundedExtraction({...good, ...patch}, "Order 1234 total $10.00, 2026", "2026-09-22")).toThrow());
it("recognizes a complete schema.org order without trusting unknown markup", () => {
 const html = `<script type="application/ld+json">{"@type":"Order","merchant":{"name":"Store"},"price":"10.00","priceCurrency":"USD","orderDate":"2026-09-20","orderNumber":"1234"}</script>`;
 expect(orderExtraction(schemaOrders(html))).toMatchObject({merchant: "Store", amountMinor: 1000, orderId: "1234"});
 expect(schemaOrders('<script type="application/ld+json">invalid</script>')).toEqual([]);
 expect(orderExtraction([{"@type": "Order", price: 10}])).toBeNull();
});
it("does not treat an invoice or ambiguous multi-order markup as a paid receipt", () => {
 expect(orderExtraction([{"@type": "Invoice", price: 10}])).toBeNull();
 expect(orderExtraction([{"@type": "Order"}, {"@type": "Order"}])).toBeNull();
});
