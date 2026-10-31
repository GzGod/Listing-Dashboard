import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dayIn, inRefetchWindow } from "../src/day.js";

test("默认 UTC：16:30Z 仍是当天", () => { assert.equal(dayIn("UTC", new Date("2026-10-30T16:30:00Z")), "2026-10-30"); });
test("Asia/Shanghai：16:30Z 已是次日", () => { assert.equal(dayIn("Asia/Shanghai", new Date("2026-10-30T16:30:00Z")), "2026-10-31"); });
test("addDays 跨月", () => { assert.equal(addDays("2026-10-28", 7), "2026-11-04"); assert.equal(addDays("2026-11-01", -1), "2026-10-31"); });
test("回抓窗口按切日时区的发帖日", () => {
  const now = new Date("2026-10-31T01:00:00Z"); // 北京 10-31 09:00，UTC 10-31
  const posted = new Date("2026-10-23T16:30:00Z"); // UTC 10-23，北京 10-24
  assert.equal(inRefetchWindow(posted, 7, "UTC", now), false);           // 10-23 < 10-24
  assert.equal(inRefetchWindow(posted, 7, "Asia/Shanghai", now), true);  // 10-24 >= 10-24
});
