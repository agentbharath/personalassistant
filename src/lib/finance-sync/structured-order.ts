/** schema.org data is evidence, not trusted instructions. Only complete Order records bypass model extraction. */
export function schemaOrders(html: string): Record<string, unknown>[] {
 const found: Record<string, unknown>[] = [];
 for (const match of html.slice(0, 150000).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
   try {
     const visit = (value: unknown, depth = 0) => {
       if (depth > 6 || found.length >= 10 || !value || typeof value !== "object") return;
       if (Array.isArray(value)) { value.slice(0, 20).forEach(v => visit(v, depth + 1)); return; }
       const object = value as Record<string, unknown>;
       if (object["@type"] === "Order" || object["@type"] === "Invoice") found.push(object);
       if (object["@graph"]) visit(object["@graph"], depth + 1);
     };
     visit(JSON.parse(match[1]));
   } catch { /* Invalid markup goes through ordinary extraction. */ }
 }
 return found;
}
export function orderExtraction(orders: Record<string, unknown>[]) {
 const order = orders.length === 1 ? orders[0] : null;
 if (!order || order["@type"] !== "Order" || order.orderStatus && !/OrderProcessing|OrderDelivered|OrderInTransit/.test(String(order.orderStatus))) return null;
 const merchant = order.merchant as {name?: unknown} | undefined;
 const amount = Number(order.price);
 if (typeof merchant?.name !== "string" || !Number.isFinite(amount) || amount <= 0 || typeof order.priceCurrency !== "string" || typeof order.orderDate !== "string") return null;
 return {merchant: merchant.name, amountMinor: Math.round(amount * 100), currency: order.priceCurrency, date: order.orderDate.slice(0, 10), type: "charge", category: "other", orderId: typeof order.orderNumber === "string" ? order.orderNumber : "", confidence: 1};
}
