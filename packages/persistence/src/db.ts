import { readEnv } from "@lowroute/config";
import { Pool } from "pg";

let pool: Pool | undefined;

export const getPool = (): Pool => {
  if (!pool) {
    const env = readEnv(process.env);
    pool = new Pool({
      connectionString: env.DATABASE_URL,
    });
  }

  return pool;
};
