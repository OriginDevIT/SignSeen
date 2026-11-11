// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WitnessCamera from "./WitnessCamera";

function stubGetUserMedia(impl: (...args: any[]) => any) {
  const getUserMedia = vi.fn(impl);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return getUserMedia;
}

function fakeStream() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

describe("WitnessCamera", () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLVideoElement.prototype, "play").mockResolvedValue(
      undefined as never
    );
  });

  afterEach(() => {
    // No vitest globals: the library's auto-cleanup never registers,
    // so unmount explicitly or renders accumulate in the document.
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("requests the exact front camera first, then enables capture", async () => {
    const { stream } = fakeStream();
    const getUserMedia = stubGetUserMedia(async () => stream);
    const onCapture = vi.fn();
    render(
      <WitnessCamera
        onCapture={onCapture}
        onFallback={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const capture = (await screen.findByRole("button", {
      name: "Capture photo",
    })) as HTMLButtonElement;
    expect(capture.disabled).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { exact: "user" } },
    });
  });

  it("falls back to any camera when no front camera exists", async () => {
    const { stream } = fakeStream();
    const getUserMedia = stubGetUserMedia(async (constraints: any) => {
      if (typeof constraints.video.facingMode === "object") {
        throw new DOMException("no front camera", "OverconstrainedError");
      }
      return stream;
    });
    render(
      <WitnessCamera
        onCapture={vi.fn()}
        onFallback={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const capture = (await screen.findByRole("button", {
      name: "Capture photo",
    })) as HTMLButtonElement;
    expect(capture.disabled).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: false,
      video: { facingMode: "user" },
    });
  });

  it("shows the upload fallback when the camera cannot be started", async () => {
    const onFallback = vi.fn();
    const getUserMedia = stubGetUserMedia(async () => {
      throw new DOMException("no camera", "NotFoundError");
    });
    render(
      <WitnessCamera
        onCapture={vi.fn()}
        onFallback={onFallback}
        onCancel={vi.fn()}
      />
    );

    const upload = await screen.findByRole("button", {
      name: "Upload a photo instead",
    });
    expect(
      screen.getByText(/Camera isn't available on this device/)
    ).toBeTruthy();
    // The old silent path called the fallback on its own; the fallback
    // is now a visible control the signer chooses.
    expect(onFallback).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    fireEvent.click(upload);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("shows the upload fallback when getUserMedia is missing", async () => {
    vi.stubGlobal("navigator", {});
    const onFallback = vi.fn();
    render(
      <WitnessCamera
        onCapture={vi.fn()}
        onFallback={onFallback}
        onCancel={vi.fn()}
      />
    );

    const upload = await screen.findByRole("button", {
      name: "Upload a photo instead",
    });
    expect(upload).toBeTruthy();
    fireEvent.click(upload);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("does not retry the camera request when permission is denied", async () => {
    const getUserMedia = stubGetUserMedia(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    render(
      <WitnessCamera
        onCapture={vi.fn()}
        onFallback={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await screen.findByRole("button", { name: "Upload a photo instead" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("shows the upload fallback when the camera never starts", async () => {
    vi.useFakeTimers();
    stubGetUserMedia(() => new Promise(() => {}));
    render(
      <WitnessCamera
        onCapture={vi.fn()}
        onFallback={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(
      screen.getByText(/Camera isn't available on this device/)
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Upload a photo instead" })
    ).toBeTruthy();
  });

  it("captures the current frame and stops the stream", async () => {
    const { stream, track } = fakeStream();
    stubGetUserMedia(async () => stream);
    vi.spyOn(
      window.HTMLCanvasElement.prototype,
      "getContext"
    ).mockReturnValue({ drawImage: vi.fn() } as any);
    vi.spyOn(
      window.HTMLCanvasElement.prototype,
      "toDataURL"
    ).mockReturnValue("data:image/jpeg;base64,fakephoto");

    const onCapture = vi.fn();
    render(
      <WitnessCamera
        onCapture={onCapture}
        onFallback={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const capture = (await screen.findByRole("button", {
      name: "Capture photo",
    })) as HTMLButtonElement;
    expect(capture.disabled).toBe(false);
    const video = screen.getByLabelText("Camera preview") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { value: 640 });
    Object.defineProperty(video, "videoHeight", { value: 480 });
    fireEvent.click(capture);
    expect(onCapture).toHaveBeenCalledWith("data:image/jpeg;base64,fakephoto");
    expect(track.stop).toHaveBeenCalled();
  });
});
