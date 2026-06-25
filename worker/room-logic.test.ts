import { describe, it, expect } from "vitest";
import {
  lowestFreeSeat,
  hostSeat,
  isHostSeat,
  buildRoster,
  MAX_SEATS,
} from "./room-logic";

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
