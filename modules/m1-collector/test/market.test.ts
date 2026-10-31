import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPair, sumUsd } from "../src/adapters/market.js";
const Q = ["USD", "USDT", "USDC"];
test("拆交易对 & 只算美元计价", () => {
  assert.deepEqual(splitPair("ALPHA-USDT", Q), ["ALPHA", "USDT"]);
  assert.equal(splitPair("ALPHABTC", Q), null);
  const m = sumUsd([{ pair: "ALPHAUSDT", quoteVolume: 100 }, { pair: "ALPHAUSDC", quoteVolume: 50 }, { pair: "ALPHABTC", quoteVolume: 999 }, { pair: "NRNUSDT", quoteVolume: 7 }], ["ALPHA"], Q);
  assert.deepEqual([...m], [["ALPHA", 150]]);
});
