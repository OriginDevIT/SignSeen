import { describe, expect, it } from "vitest";
import { CEREMONY_STEPS, ceremonyTagline } from "./ceremony";

describe("ceremony", () => {
  it("lists the three ceremony steps in order", () => {
    expect([...CEREMONY_STEPS]).toEqual(["Signed", "Seen", "Sealed"]);
  });

  it("formats the tagline from the steps", () => {
    expect(ceremonyTagline()).toBe("Signed. Seen. Sealed.");
  });
});
