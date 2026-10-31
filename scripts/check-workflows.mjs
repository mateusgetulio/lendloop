import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
const workflows = readdirSync("n8n/workflows")
  .filter((f) => f.endsWith(".json"))
  .map((file) => {
    const raw = readFileSync(`n8n/workflows/${file}`, "utf8");
    const data = JSON.parse(raw);
    assert(!/"pinData"\s*:/.test(raw), `${file}: pinData forbidden`);
    assert(
      !/"credentials"\s*:/.test(raw),
      `${file}: map credentials outside exports`,
    );
    assert(
      !/(?:sk_(?:live|test)_[a-zA-Z0-9]{12,}|(?:secret|password|apiKey)"\s*:\s*"(?!\{\{)[^"]{8,})/i.test(
        raw,
      ),
      `${file}: possible secret`,
    );
    return data;
  });
for (const id of ["LendLoopNotifyM1", "LendLoopOverdueM1", "LendLoopErrorM1"])
  assert.equal(
    workflows.filter((w) => w.id === id).length,
    1,
    `Expected unique workflow ${id}`,
  );
for (const id of ["LendLoopNotifyM1", "LendLoopOverdueM1"])
  assert.equal(
    workflows.find((w) => w.id === id).settings.errorWorkflow,
    "LendLoopErrorM1",
  );
assert.match(
  readFileSync("compose.yaml", "utf8"),
  /image: n8nio\/n8n:\d+\.\d+\.\d+\s/,
);
console.log(
  "Workflow structure checks passed. This does not prove runtime behavior.",
);
