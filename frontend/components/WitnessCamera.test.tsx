// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WitnessCamera from "./WitnessCamera";

const SIGNING_URL = "https://example.com/s/test-token";

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

function renderCamera(props: Partial<React.ComponentProps<typeof WitnessCamera>> = {}) {
  return render(
    <WitnessCamera
      onCapture={vi.fn()}
      onCancel={vi.fn()}
      signingUrl={SIGNING_URL}
      {...props}
    />
  );
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
    renderCamera({ onCapture });

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
    renderCamera();

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

  it("shows the continue-on-your-phone QR when the camera cannot be started", async () => {
    const getUserMedia = stubGetUserMedia(async () => {
      throw new DOMException("no camera", "NotFoundError");
    });
    const { container } = renderCamera();

    await screen.findByText("Continue on your phone");
    expect(
      screen.getByText(/This device has no camera/)
    ).toBeTruthy();
    // The QR encodes the same signing link, and the link itself is
    // shown as text alongside it.
    expect(screen.getByText(SIGNING_URL)).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    // No upload path: no camera means no photo.
    expect(
      screen.queryByRole("button", { name: /Upload a photo/ })
    ).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("shows the continue-on-your-phone QR when getUserMedia is missing", async () => {
    vi.stubGlobal("navigator", {});
    const { container } = renderCamera();

    await screen.findByText("Continue on your phone");
    expect(screen.getByText(SIGNING_URL)).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Upload a photo/ })
    ).toBeNull();
  });

  it("does not retry the camera request when permission is denied", async () => {
    const getUserMedia = stubGetUserMedia(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    renderCamera();

    await screen.findByText("Continue on your phone");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("shows the continue-on-your-phone QR when the camera never starts", async () => {
    vi.useFakeTimers();
    stubGetUserMedia(() => new Promise(() => {}));
    renderCamera();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(
      screen.getByText("Continue on your phone")
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Upload a photo/ })
    ).toBeNull();
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
    renderCamera({ onCapture });

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
