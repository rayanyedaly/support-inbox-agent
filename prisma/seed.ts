// prisma/seed.ts
//
// Seeds the demo to the five scenarios in PLAN.md. Each open ticket is shaped to
// FORCE a specific tool chain so the live demo exercises the agent's judgment:
//
//   1. "Where's my refund?"        -> search_customer -> get_customer_context
//                                      -> search_orders -> search_knowledge_base
//                                      -> draft_reply            (the headline chain)
//   2. "How do I cancel?"          -> search_knowledge_base -> draft_reply  (short — no over-tooling)
//   3. Recurring login failures    -> get_ticket_history -> escalate_ticket(engineering)
//   4. Chargeback / billing dispute-> escalate_ticket(trust_and_safety)     (don't auto-answer)
//   5. Vague "it's broken"         -> update_ticket(PENDING) + draft a clarifying question
//
// Supporting data (extra customers, a spread of orders across every status, 6 KB
// articles, and prior login tickets for #3) exists so those chains read as real.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic clock so seeds don't drift with wall-time. "Today" is 2026-06-16.
const NOW = new Date("2026-06-16T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

async function main() {
  // --- Clean slate (delete in FK-safe order) ------------------------------
  await prisma.llmCall.deleteMany();
  await prisma.message.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.kbArticle.deleteMany();

  // --- Knowledge base -----------------------------------------------------
  // Bodies carry the keywords the contains-search in tools.ts matches on, and a
  // few articles encode the policy the agent must follow (escalate disputes /
  // recurring login failures rather than guess).
  await prisma.kbArticle.createMany({
    data: [
      {
        title: "Refund Policy",
        slug: "refund-policy",
        tags: ["refund", "refunds", "billing"],
        body:
          "We offer full refunds on subscription plans within 30 days of the charge. " +
          "Refunds go back to the original payment method and typically take 5–10 business " +
          "days to appear, depending on the customer's bank. Annual plans cancelled within " +
          "30 days are refunded in full; after 30 days they are prorated. If a refund still " +
          "shows as pending past 10 business days, confirm it was issued in the billing " +
          "system and reassure the customer it is on the way — never issue a second refund.",
      },
      {
        title: "Cancelling Your Subscription",
        slug: "cancel-subscription",
        tags: ["cancellation", "cancel", "subscription", "billing"],
        body:
          "To cancel a subscription, go to Settings → Billing → Manage plan and click " +
          "'Cancel subscription'. The plan stays active until the end of the current billing " +
          "period — there is no partial-month charge, and the customer keeps paid features " +
          "until that date. To cancel an annual plan and request money back, cancel first, " +
          "then follow the Refund Policy.",
      },
      {
        title: "Troubleshooting Login Issues",
        slug: "login-troubleshooting",
        tags: ["login", "account", "auth"],
        body:
          "For login problems, first have the customer reset their password via the 'Forgot " +
          "password' link, then clear cookies or try an incognito window. If login keeps " +
          "failing after a password reset — especially repeatedly — it is an account or " +
          "auth-service issue that support cannot fix from the dashboard. Escalate recurring " +
          "login failures to the Engineering team instead of re-sending these same steps.",
      },
      {
        title: "Billing Disputes & Chargebacks",
        slug: "billing-disputes",
        tags: ["chargeback", "dispute", "billing", "fraud"],
        body:
          "Chargebacks, payment disputes, and any claim of fraud or an unauthorized charge " +
          "are handled exclusively by the Trust & Safety team. Support agents must NOT promise " +
          "refunds, reverse charges, or argue the claim. Escalate these tickets to Trust & " +
          "Safety immediately and do not draft a substantive reply yourself.",
      },
      {
        title: "Support SLAs & Response Times",
        slug: "sla-response-times",
        tags: ["sla", "response", "support"],
        body:
          "Target first-response times: Urgent 1 hour, High 4 hours, Medium 1 business day, " +
          "Low 2 business days. Pro and Enterprise customers get priority handling. A ticket " +
          "that lacks enough detail to act on should be set to Pending with a short clarifying " +
          "question rather than guessed at.",
      },
      {
        title: "Account Security & Suspicious Activity",
        slug: "account-security",
        tags: ["security", "account", "fraud"],
        body:
          "If a customer reports suspicious activity, account takeover, or unrecognized logins, " +
          "treat it as security-sensitive: advise an immediate password reset and enabling " +
          "two-factor authentication, and escalate to Trust & Safety if there are signs of " +
          "unauthorized access.",
      },
    ],
  });

  // --- Scenario 1: "Where's my refund?" -----------------------------------
  // PRO customer with a REFUNDED order (the refund she's chasing) and a PENDING
  // order (the "another charge?" she mentions). Forces the full bread-and-butter
  // chain ending in a grounded draft_reply.
  await prisma.customer.create({
    data: {
      name: "Maya Chen",
      email: "maya.chen@example.com",
      plan: "PRO",
      createdAt: daysAgo(220),
      orders: {
        create: [
          {
            status: "PAID",
            amountUsd: "20.00",
            description: "Pro plan — monthly (Jan 2026)",
            createdAt: daysAgo(150),
          },
          {
            status: "REFUNDED",
            amountUsd: "240.00",
            description: "Pro plan — annual upgrade",
            createdAt: daysAgo(24),
          },
          {
            status: "PENDING",
            amountUsd: "20.00",
            description: "Pro plan — monthly renewal",
            createdAt: daysAgo(2),
          },
        ],
      },
      tickets: {
        create: [
          {
            subject: "Where's my refund?",
            status: "OPEN",
            priority: "HIGH",
            channel: "EMAIL",
            tags: ["refund", "billing"],
            createdAt: daysAgo(0),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body:
                    "Hi — I cancelled my annual Pro plan about three weeks ago and was told " +
                    "the $240 would be refunded. I still haven't seen the money come back, and " +
                    "now there's *another* charge showing as pending on my account?? Can you " +
                    "tell me where my refund is and what this new pending charge is?",
                  createdAt: daysAgo(0),
                },
              ],
            },
          },
        ],
      },
    },
  });

  // --- Scenario 2: "How do I cancel my subscription?" ---------------------
  // Answer lives entirely in one KB article. Should provoke a SHORT chain
  // (search_knowledge_base -> draft_reply) — proof the agent doesn't over-tool.
  await prisma.customer.create({
    data: {
      name: "Tom Becker",
      email: "tom.becker@example.com",
      plan: "PRO",
      createdAt: daysAgo(90),
      orders: {
        create: [
          {
            status: "PAID",
            amountUsd: "20.00",
            description: "Pro plan — monthly",
            createdAt: daysAgo(15),
          },
        ],
      },
      tickets: {
        create: [
          {
            subject: "How do I cancel my subscription?",
            status: "OPEN",
            priority: "LOW",
            channel: "CHAT",
            tags: ["subscription"],
            createdAt: daysAgo(0),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body: "Hey, I'd like to cancel my subscription — can you tell me how? Thanks.",
                  createdAt: daysAgo(0),
                },
              ],
            },
          },
        ],
      },
    },
  });

  // --- Scenario 3: Recurring login failures -------------------------------
  // Three prior RESOLVED login tickets (each "fixed" with the same canned reset
  // advice) + a current OPEN one. get_ticket_history surfaces the pattern, which
  // should drive escalate_ticket(team: engineering) instead of re-sending steps.
  await prisma.customer.create({
    data: {
      name: "Priya Nair",
      email: "priya.nair@example.com",
      plan: "PRO",
      createdAt: daysAgo(300),
      orders: {
        create: [
          {
            status: "PAID",
            amountUsd: "240.00",
            description: "Pro plan — annual",
            createdAt: daysAgo(135),
          },
        ],
      },
      tickets: {
        create: [
          {
            subject: "Can't log in to my account",
            status: "RESOLVED",
            priority: "MEDIUM",
            channel: "EMAIL",
            tags: ["login", "account"],
            createdAt: daysAgo(25),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body: "I can't log in — it says 'invalid credentials' even though my password is right.",
                  createdAt: daysAgo(25),
                },
                {
                  role: "AGENT",
                  status: "SENT",
                  body: "Thanks for reaching out — please reset your password via 'Forgot password' and clear your cookies. That usually sorts it.",
                  createdAt: daysAgo(25),
                },
              ],
            },
          },
          {
            subject: "Login failing again after reset",
            status: "RESOLVED",
            priority: "MEDIUM",
            channel: "EMAIL",
            tags: ["login", "account"],
            createdAt: daysAgo(14),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body: "It happened again. I reset my password like last time and I still get locked out after a few hours.",
                  createdAt: daysAgo(14),
                },
                {
                  role: "AGENT",
                  status: "SENT",
                  body: "Sorry about that — try an incognito window and reset once more. Let us know if it persists.",
                  createdAt: daysAgo(14),
                },
              ],
            },
          },
          {
            subject: "Locked out again — same login error",
            status: "RESOLVED",
            priority: "HIGH",
            channel: "EMAIL",
            tags: ["login", "account"],
            createdAt: daysAgo(7),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body: "Third time now. The password reset is not a real fix — this keeps coming back.",
                  createdAt: daysAgo(7),
                },
                {
                  role: "AGENT",
                  status: "SENT",
                  body: "Apologies for the trouble — resetting again should help in the meantime.",
                  createdAt: daysAgo(7),
                },
              ],
            },
          },
          {
            subject: "Login still failing — third time this month",
            status: "OPEN",
            priority: "HIGH",
            channel: "EMAIL",
            tags: ["login", "account"],
            createdAt: daysAgo(0),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body:
                    "I STILL can't log in. This is the third time this month I've reported this. " +
                    "I've reset my password twice, cleared cookies, and tried another browser — " +
                    "nothing works. I need this actually fixed, not another copy-paste of the same steps.",
                  createdAt: daysAgo(0),
                },
              ],
            },
          },
        ],
      },
    },
  });

  // --- Scenario 4: Chargeback threat / billing dispute --------------------
  // Sensitive. Two legit PAID enterprise charges exist, but the claim of fraud /
  // chargeback must NOT be auto-answered — the agent should escalate to
  // trust_and_safety rather than promise a reversal.
  await prisma.customer.create({
    data: {
      name: "Dan Owusu",
      email: "dan.owusu@example.com",
      plan: "ENTERPRISE",
      createdAt: daysAgo(400),
      orders: {
        create: [
          {
            status: "PAID",
            amountUsd: "1200.00",
            description: "Enterprise — 10 seats (May 2026)",
            createdAt: daysAgo(42),
          },
          {
            status: "PAID",
            amountUsd: "1200.00",
            description: "Enterprise — 10 seats (Jun 2026)",
            createdAt: daysAgo(11),
          },
        ],
      },
      tickets: {
        create: [
          {
            subject: "Disputing this charge — filing a chargeback",
            status: "OPEN",
            priority: "URGENT",
            channel: "EMAIL",
            tags: ["billing", "dispute", "chargeback"],
            createdAt: daysAgo(0),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body:
                    "I did NOT authorize the $1,200 charge on my card this month. I want it " +
                    "reversed immediately. If it's not refunded today I'm filing a chargeback " +
                    "with my bank and reporting it as fraud.",
                  createdAt: daysAgo(0),
                },
              ],
            },
          },
        ],
      },
    },
  });

  // --- Scenario 5: Vague one-liner ("it's broken") ------------------------
  // Underspecified. Right move is update_ticket(status: PENDING) + a drafted
  // clarifying question — triage, not a guessed answer.
  await prisma.customer.create({
    data: {
      name: "Lena Fischer",
      email: "lena.fischer@example.com",
      plan: "FREE",
      createdAt: daysAgo(20),
      orders: {
        create: [
          {
            status: "FAILED",
            amountUsd: "20.00",
            description: "Pro plan — upgrade attempt",
            createdAt: daysAgo(6),
          },
        ],
      },
      tickets: {
        create: [
          {
            subject: "it's broken",
            status: "OPEN",
            priority: "MEDIUM",
            channel: "WEB",
            tags: [],
            createdAt: daysAgo(0),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body: "it's broken",
                  createdAt: daysAgo(0),
                },
              ],
            },
          },
        ],
      },
    },
  });

  // --- Background customers (realism; not tied to a scenario) --------------
  await prisma.customer.create({
    data: {
      name: "Carlos Mendes",
      email: "carlos.mendes@example.com",
      plan: "ENTERPRISE",
      createdAt: daysAgo(500),
      orders: {
        create: [
          {
            status: "PAID",
            amountUsd: "4800.00",
            description: "Enterprise — annual",
            createdAt: daysAgo(100),
          },
        ],
      },
      tickets: {
        create: [
          {
            subject: "Help setting up SSO (SAML)",
            status: "RESOLVED",
            priority: "MEDIUM",
            channel: "EMAIL",
            tags: ["sso", "setup"],
            createdAt: daysAgo(60),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body: "We're rolling out SSO — can you point me to the SAML setup docs?",
                  createdAt: daysAgo(60),
                },
                {
                  role: "AGENT",
                  status: "SENT",
                  body: "Absolutely — I've sent over our SAML guide and enabled SSO on your workspace. Shout if you hit any snags.",
                  createdAt: daysAgo(59),
                },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.customer.create({
    data: {
      name: "Aisha Khan",
      email: "aisha.khan@example.com",
      plan: "FREE",
      createdAt: daysAgo(45),
      tickets: {
        create: [
          {
            subject: "How do I export my data?",
            status: "RESOLVED",
            priority: "LOW",
            channel: "CHAT",
            tags: ["export"],
            createdAt: daysAgo(30),
            messages: {
              create: [
                {
                  role: "CUSTOMER",
                  status: "SENT",
                  body: "Is there a way to export all my data to CSV?",
                  createdAt: daysAgo(30),
                },
                {
                  role: "AGENT",
                  status: "SENT",
                  body: "Yes — Settings → Data → Export. You'll get a CSV by email within a few minutes.",
                  createdAt: daysAgo(30),
                },
              ],
            },
          },
        ],
      },
    },
  });

  // --- Summary ------------------------------------------------------------
  const [customers, orders, kb, tickets, messages] = await Promise.all([
    prisma.customer.count(),
    prisma.order.count(),
    prisma.kbArticle.count(),
    prisma.ticket.count(),
    prisma.message.count(),
  ]);

  const open = await prisma.ticket.findMany({
    where: { status: "OPEN" },
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  console.log("\nSeeded:");
  console.log(
    `  ${customers} customers · ${orders} orders · ${kb} KB articles · ` +
      `${tickets} tickets · ${messages} messages\n`
  );
  console.log("Open demo tickets (the agent's queue):");
  for (const t of open) {
    console.log(
      `  • ${t.subject.padEnd(44)} ${t.customer.name.padEnd(14)} ` +
        `${t.priority.padEnd(7)} ${t.channel}`
    );
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
