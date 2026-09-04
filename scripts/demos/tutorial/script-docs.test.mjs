import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const tutorialRoot = fileURLToPath(new URL(".", import.meta.url));

async function documentedStagingGate() {
  const productionGuide = await readFile(path.join(tutorialRoot, "SCRIPT.md"), "utf8");
  const match = productionGuide.match(
    /# tutorial-staging-gate:start\n([\s\S]*?)\n# tutorial-staging-gate:end/,
  );
  assert.ok(match, "documented staging credential gate not found");
  return match[1];
}

test("documented coach staging runs psql only with both required credentials", async () => {
  const gate = await documentedStagingGate();
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "ponglens-staging-gate-"));
  const psqlLog = path.join(fixtureDir, "psql.log");
  const psqlStub = path.join(fixtureDir, "psql");
  await writeFile(psqlStub, '#!/bin/sh\nprintf "%s\\n" "$*" > "$PSQL_LOG"\n');
  await chmod(psqlStub, 0o755);

  try {
    const cases = [
      { database: "", service: "", shouldRun: false },
      { database: "postgres://staging.invalid/example", service: "", shouldRun: false },
      { database: "", service: "service-role-fixture", shouldRun: false },
      {
        database: "postgres://staging.invalid/example",
        service: "service-role-fixture",
        shouldRun: true,
      },
    ];

    for (const fixture of cases) {
      await rm(psqlLog, { force: true });
      const result = spawnSync("zsh", ["-c", gate], {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: fixture.database,
          SERVICE_KEY: fixture.service,
          PATH: `${fixtureDir}:/usr/bin:/bin`,
          PSQL_LOG: psqlLog,
        },
      });

      if (fixture.shouldRun) {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          await readFile(psqlLog, "utf8"),
          "postgres://staging.invalid/example -f scripts/demos/stage_coach.sql\n",
        );
      } else {
        assert.notEqual(result.status, 0, "missing credentials must fail closed");
        await assert.rejects(readFile(psqlLog, "utf8"), /ENOENT/);
      }
    }
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
