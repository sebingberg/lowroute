import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

type Step = {
  readonly label: string;
  readonly command: string;
  readonly args: string[];
};

const isFast = process.argv.includes("--fast");

const run = (step: Step): void => {
  process.stdout.write(`\n==> ${step.label}\n`);
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const waitForPostgres = (): void => {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const result = spawnSync(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "postgres", "-d", "lowroute"],
      {
        stdio: "ignore",
        shell: false,
      },
    );

    if (result.status === 0) {
      return;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }

  throw new Error("Postgres did not become ready within 30 seconds");
};

const listFiles = (directory: string): string[] => {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
};

const assertNoBuiltTests = (): void => {
  const builtTests = ["apps", "packages"]
    .flatMap((root) => listFiles(root))
    .filter((path) => path.includes("/dist/") && /\.test\.(js|d\.ts)$/.test(path));

  if (builtTests.length > 0) {
    throw new Error(`Build emitted test artifacts:\n${builtTests.join("\n")}`);
  }
};

const commonSteps: Step[] = [
  {
    label: "Install dependencies with frozen lockfile",
    command: "pnpm",
    args: ["install", "--frozen-lockfile"],
  },
  {
    label: "Lint",
    command: "pnpm",
    args: ["lint"],
  },
  {
    label: "Typecheck",
    command: "pnpm",
    args: ["typecheck"],
  },
  {
    label: "Build",
    command: "pnpm",
    args: ["build"],
  },
  {
    label: "Unit tests",
    command: "pnpm",
    args: ["test"],
  },
];

try {
  for (const step of commonSteps) {
    run(step);
  }

  process.stdout.write("\n==> Check build output hygiene\n");
  assertNoBuiltTests();

  if (!isFast) {
    run({
      label: "Start local Postgres",
      command: "docker",
      args: ["compose", "up", "-d", "postgres"],
    });

    process.stdout.write("\n==> Wait for local Postgres\n");
    waitForPostgres();

    run({
      label: "Run migrations",
      command: "pnpm",
      args: ["migrate:up"],
    });

    run({
      label: "pg-boss smoke",
      command: "pnpm",
      args: ["smoke:provider"],
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nprecommit failed: ${message}\n`);
  process.exit(1);
}
