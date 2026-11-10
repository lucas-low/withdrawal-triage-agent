import type { App } from "./container";
import { seed } from "./seed";

const TABLES = ["spans", "precedents", "executions", "proposals", "audit", "withdrawals", "accounts"];

/** Wipes all data and loads the sample set. Only reachable when DEMO_MODE=true. */
export function resetDemo(app: App) {
  app.store.transaction(() => {
    for (const t of TABLES) app.db.exec(`DELETE FROM ${t}`);
    app.db.exec("DELETE FROM sqlite_sequence WHERE name = 'audit'");
    seed(app.store);
  });
}

/** Seeds an empty database on first start of a demo. */
export function ensureDemoData(app: App) {
  if (app.store.listWithdrawals().length === 0) seed(app.store);
}
