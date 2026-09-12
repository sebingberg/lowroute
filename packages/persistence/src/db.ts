import { readEnv } from "@lowroute/config";
import { Pool } from "pg";

let pool: Pool | undefined;

export const getPool = (): Pool => {
  if (!pool) {
    const env = readEnv(process.env);
    pool = new Pool({
      connectionString: env.DATABASE_URL,
    });
    // ! Prevent idle-client errors (e.g. DB restart) from crashing the process.
    // Without this, pg-pool emits 'error' with no listener and node throws.
    pool.on("error", (error) => {
      console.error("pg pool idle client error", error);
    });
  }

  return pool;
};
