import { describe, expect, it } from "vitest";
import {
  cameraConstraints,
  captureVideoFrame,
  isCameraSupported,
  toggleFacing,
} from "./camera";

describe("cameraConstraints", () => {
  it("defaults to the front camera shape the Seen step requests", () => {
    expect(cameraConstraints("user")).toEqual({
      audio: false,
      video: { facingMode: "user" },
    });
  });

  it("builds rear-camera constraints for the switched case", () => {
    expect(cameraConstraints("environment")).toEqual({
      audio: false,
      video: { facingMode: "environment" },
    });
  });
});

describe("toggleFacing", () => {
  it("switches user -> environment -> user", () => {
    expect(toggleFacing("user")).toBe("environment");
    expect(toggleFacing("environment")).toBe("user");
  });
});

describe("isCameraSupported", () => {
  it("is false in this (non-browser) test environment, without throwing", () => {
    // vitest runs in node: there is no mediaDevices.getUserMedia, so
    // callers must take the file-picker fallback path.
    expect(isCameraSupported()).toBe(false);
  });
});

describe("captureVideoFrame", () => {
  it("returns null when there is no frame (or no document)", () => {
    const fakeVideo = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;
    expect(captureVideoFrame(fakeVideo)).toBeNull();
  });
});
