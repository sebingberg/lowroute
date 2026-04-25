import type { Context } from "hono";

export const providerStatusHandler = (context: Context): Response => {
  return context.json({
    source: "scaffold-placeholder",
    actionable: false,
    providers: [
      { name: "duffel", status: "pending-gate" },
      { name: "kiwi", status: "pending-gate" },
      { name: "travelpayouts", status: "pending-gate" },
    ],
    note: "Provider gate state is not wired yet; Task 7.2 remains incomplete until this endpoint reads real gate data.",
  });
};
