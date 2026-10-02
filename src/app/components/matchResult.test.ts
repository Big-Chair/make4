import { describe, expect, it } from "vitest";
import type { Role } from "./room";
import { persistsMatchResult } from "./matchResult";

const room = (role: Role, live: boolean) => ({ role, live });

describe("persistsMatchResult", () => {
  it("persists a timed local or bot Match, never an untimed one", () => {
    expect(persistsMatchResult({ gameMode: "local", timerDuration: 40, room: null })).toBe(true);
    expect(persistsMatchResult({ gameMode: "bot", timerDuration: 30, room: null })).toBe(true);
    expect(persistsMatchResult({ gameMode: "local", timerDuration: 0, room: null })).toBe(false);
  });

  it("persists an online result only from the host of a live Room", () => {
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: room("host", true) })).toBe(true);
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: room("guest", true) })).toBe(false);
  });

  it("never persists a no-contest Room", () => {
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: room("host", false) })).toBe(false);
    expect(persistsMatchResult({ gameMode: "online", timerDuration: 40, room: null })).toBe(false);
  });
});
