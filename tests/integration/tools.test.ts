import { describe, it, expect } from "vitest";
import { runTool } from "../../lib/agent/tools";

type Customer = { id: string; name: string; email: string; plan: string };
type Order = { id: string; status: string; amountUsd: unknown; description: string };
type Article = { title: string; body: string; slug: string };

describe("tools against the seeded test DB", () => {
  it("search_customer resolves a customer by name fragment", async () => {
    const res = (await runTool("search_customer", { query: "maya" })) as { matches: Customer[] };
    const maya = res.matches.find((m) => m.email === "maya.chen@example.com");
    expect(maya).toBeDefined();
    expect(maya?.name).toBe("Maya Chen");
    expect(maya?.plan).toBe("PRO");
  });

  it("search_orders returns the customer's REFUNDED order with the right amount", async () => {
    const cust = (await runTool("search_customer", { query: "maya.chen@example.com" })) as {
      matches: Customer[];
    };
    const mayaId = cust.matches[0].id;

    const res = (await runTool("search_orders", {
      customerId: mayaId,
      status: "REFUNDED",
    })) as { orders: Order[] };

    expect(res.orders.length).toBeGreaterThan(0);
    expect(res.orders[0].status).toBe("REFUNDED");
    expect(Number(String(res.orders[0].amountUsd))).toBe(240); // Decimal — never === 240 directly
  });

  it("search_knowledge_base finds the Refund Policy article", async () => {
    const res = (await runTool("search_knowledge_base", { query: "refund" })) as {
      articles: Article[];
    };
    const article = res.articles.find((a) => a.slug === "refund-policy");
    expect(article).toBeDefined();
    expect(article?.title).toBe("Refund Policy");
    expect(article?.body).toContain("30 days");
  });
});
