import { describe, it, expect } from "vitest";
import {
  lowestFreeSeat,
  lowestFreeSeatForRole,
  hostSeat,
  isHostSeat,
  buildRoster,
  parsePos,
  MAX_SEATS,
} from "./room-logic";

describe("parsePos", () => {
  it("accepts finite numeric x/y/fx/fy", () => {
    expect(parsePos({ x: 1, y: 2, fx: 0, fy: -1 })).toEqual({ x: 1, y: 2, fx: 0, fy: -1 });
  });

  it("rejects missing fields", () => {
    expect(parsePos({ x: 1, y: 2, fx: 0 })).toBeNull();
    expect(parsePos({})).toBeNull();
  });

  it("rejects non-number / non-finite values", () => {
    expect(parsePos({ x: "1", y: 2, fx: 0, fy: -1 })).toBeNull();
    expect(parsePos({ x: NaN, y: 2, fx: 0, fy: -1 })).toBeNull();
    expect(parsePos({ x: Infinity, y: 2, fx: 0, fy: -1 })).toBeNull();
  });

  it("ignores extra fields and returns only x/y/fx/fy", () => {
    expect(parsePos({ t: "pos", seat: 3, x: 5, y: 6, fx: 1, fy: 0 })).toEqual({
      x: 5,
      y: 6,
      fx: 1,
      fy: 0,
    });
  });
});

describe("lowestFreeSeat", () => {
  it("assigns 0,1,2… in order as seats fill", () => {
    expect(lowestFreeSeat([])).toBe(0);
    expect(lowestFreeSeat([0])).toBe(1);
    expect(lowestFreeSeat([0, 1])).toBe(2);
    expect(lowestFreeSeat([0, 1, 2])).toBe(3);
  });

  it("returns null when full (8 seats taken)", () => {
    expect(lowestFreeSeat([0, 1, 2, 3, 4, 5, 6, 7])).toBeNull();
  });

  it("reuses a freed middle seat (lowest free)", () => {
    // seats 0,2,3 taken → seat 1 freed → lowest free is 1
    expect(lowestFreeSeat([0, 2, 3])).toBe(1);
    // seat 0 freed while 1..7 taken → 0
    expect(lowestFreeSeat([1, 2, 3, 4, 5, 6, 7])).toBe(0);
  });

  it("ignores duplicate/out-of-range entries gracefully", () => {
    expect(lowestFreeSeat([0, 0, 1])).toBe(2);
  });
});

describe("hostSeat / isHostSeat", () => {
  it("host is the lowest occupied seat", () => {
    expect(hostSeat([3, 1, 5])).toBe(1);
    expect(hostSeat([0])).toBe(0);
    expect(hostSeat([7, 2])).toBe(2);
  });

  it("returns null when empty", () => {
    expect(hostSeat([])).toBeNull();
  });

  it("promotes new lowest seat when host (seat 0) leaves", () => {
    // host was 0, leaves → remaining 2,5 → host becomes 2
    expect(hostSeat([2, 5])).toBe(2);
    expect(isHostSeat(2, [2, 5])).toBe(true);
    expect(isHostSeat(5, [2, 5])).toBe(false);
  });

  it("isHostSeat is true only for the lowest seat", () => {
    expect(isHostSeat(1, [1, 4, 6])).toBe(true);
    expect(isHostSeat(4, [1, 4, 6])).toBe(false);
  });
});

describe("buildRoster", () => {
  it("builds a seat-sorted roster with host on the lowest seat", () => {
    const roster = buildRoster([
      { seat: 3, name: "C" },
      { seat: 1, name: "A" },
      { seat: 5, name: "B" },
    ]);
    expect(roster).toEqual([
      { seat: 1, name: "A", isHost: true },
      { seat: 3, name: "C", isHost: false },
      { seat: 5, name: "B", isHost: false },
    ]);
  });

  it("empty room → empty roster", () => {
    expect(buildRoster([])).toEqual([]);
  });

  it("after host (seat 0) leaves, new lowest becomes host", () => {
    const roster = buildRoster([
      { seat: 2, name: "B" },
      { seat: 4, name: "C" },
    ]);
    expect(roster[0]).toEqual({ seat: 2, name: "B", isHost: true });
    expect(roster[1].isHost).toBe(false);
  });
});

describe("MAX_SEATS", () => {
  it("is 8", () => {
    expect(MAX_SEATS).toBe(8);
  });
});

describe("lowestFreeSeatForRole", () => {
  it("tank range: empty → 0, [0] taken → 1, [0,1] taken → null", () => {
    expect(lowestFreeSeatForRole([], "tank")).toBe(0);
    expect(lowestFreeSeatForRole([0], "tank")).toBe(1);
    expect(lowestFreeSeatForRole([0, 1], "tank")).toBeNull();
  });

  it("healer range: empty → 2, [2] taken → 3, [2,3] taken → null", () => {
    expect(lowestFreeSeatForRole([], "healer")).toBe(2);
    expect(lowestFreeSeatForRole([2], "healer")).toBe(3);
    expect(lowestFreeSeatForRole([2, 3], "healer")).toBeNull();
  });

  it("dps range: empty → 4, [4,5,6] taken → 7, [4,5,6,7] taken → null", () => {
    expect(lowestFreeSeatForRole([], "dps")).toBe(4);
    expect(lowestFreeSeatForRole([4, 5, 6], "dps")).toBe(7);
    expect(lowestFreeSeatForRole([4, 5, 6, 7], "dps")).toBeNull();
  });

  it("ranges are independent: tank full does not affect healer or dps", () => {
    expect(lowestFreeSeatForRole([0, 1], "healer")).toBe(2);
    expect(lowestFreeSeatForRole([0, 1], "dps")).toBe(4);
  });

  it("unknown role returns null gracefully", () => {
    expect(lowestFreeSeatForRole([], "unknown" as any)).toBeNull();
  });
});
