import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cameraConstraints,
  captureVideoFrame,
  exactCameraConstraints,
  isCameraSupported,
  requestCamera,
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

describe("exactCameraConstraints", () => {
  it("requires the front camera (exact, not a preference)", () => {
    expect(exactCameraConstraints("user")).toEqual({
      audio: false,
      video: { facingMode: { exact: "user" } },
    });
  });

  it("requires the rear camera for the switched case", () => {
    expect(exactCameraConstraints("environment")).toEqual({
      audio: false,
      video: { facingMode: { exact: "environment" } },
    });
  });
});

describe("requestCamera", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const failing = (name: string) =>
    new DOMException(`no camera matches: ${name}`, name);

  function stubGetUserMedia(impl: (...args: any[]) => any) {
    const getUserMedia = vi.fn(impl);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    return getUserMedia;
  }

  it("requests the exact front camera first and returns its stream", async () => {
    const stream = { id: "front" };
    const getUserMedia = stubGetUserMedia(async () => stream);
    await expect(requestCamera("user")).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { exact: "user" } },
    });
  });

  it("retries with the preference form when no front camera exists", async () => {
    const stream = { id: "any" };
    const getUserMedia = stubGetUserMedia(async (constraints: unknown) => {
      const video = (constraints as { video: { facingMode: unknown } }).video;
      if (typeof video.facingMode === "object") {
        throw failing("OverconstrainedError");
      }
      return stream;
    });
    await expect(requestCamera("user")).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: false,
      video: { facingMode: "user" },
    });
  });

  it("retries when the exact request finds no device at all", async () => {
    const stream = { id: "any" };
    const getUserMedia = stubGetUserMedia(async (constraints: unknown) => {
      const video = (constraints as { video: { facingMode: unknown } }).video;
      if (typeof video.facingMode === "object") {
        throw failing("NotFoundError");
      }
      return stream;
    });
    await expect(requestCamera("user")).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("does not retry when permission is denied", async () => {
    const getUserMedia = stubGetUserMedia(async () => {
      throw failing("NotAllowedError");
    });
    await expect(requestCamera("user")).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("throws when getUserMedia is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestCamera("user")).rejects.toThrow(
      "getUserMedia unavailable"
    );
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
