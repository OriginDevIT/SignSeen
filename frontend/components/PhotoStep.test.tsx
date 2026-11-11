// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PhotoStep from "./PhotoStep";

const SIGNING_URL = "https://example.com/s/test-token";

type PhotoStepProps = React.ComponentProps<typeof PhotoStep>;

function renderStep(props: Partial<PhotoStepProps> = {}) {
  return render(
    <PhotoStep
      photoUrl={null}
      photoConsent={true}
      onConsentChange={vi.fn()}
      cameraOpen={false}
      onTakePhoto={vi.fn()}
      onCapturePhoto={vi.fn()}
      onCloseCamera={vi.fn()}
      signingUrl={SIGNING_URL}
      fieldsComplete={true}
      onSubmit={vi.fn()}
      submitStyle={{}}
      {...props}
    />
  );
}

describe("PhotoStep", () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLVideoElement.prototype, "play").mockResolvedValue(
      undefined as never
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("offers skip when the photo is optional (default)", () => {
    renderStep();
    const submit = screen.getByRole("button", {
      name: "Skip photo & submit",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
  });

  it("hides skip and blocks submit when the photo is required and missing", () => {
    renderStep({ photoRequired: true });
    expect(
      screen.queryByRole("button", { name: /Skip photo/ })
    ).toBeNull();
    const submit = screen.getByRole("button", {
      name: "Seal it — submit",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(
      screen.getByText(/A witness photo is required before you can submit/)
    ).toBeTruthy();
  });

  it("allows submit when the photo is required and attached", () => {
    renderStep({
      photoRequired: true,
      photoUrl: "data:image/jpeg;base64,fakephoto",
    });
    const submit = screen.getByRole("button", {
      name: "Seal it — submit",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(
      screen.getByAltText("Witness photo preview")
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Skip photo/ })
    ).toBeNull();
  });

  it("blocks submit while required document fields are incomplete", () => {
    renderStep({
      photoUrl: "data:image/jpeg;base64,fakephoto",
      fieldsComplete: false,
    });
    const submit = screen.getByRole("button", {
      name: "Seal it — submit",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("disables Take photo until consent", () => {
    renderStep({ photoConsent: false });
    const take = screen.getByRole("button", {
      name: "Take photo",
    }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
  });

  it("opens the camera when Take photo is tapped", () => {
    const onTakePhoto = vi.fn();
    renderStep({ photoConsent: true, onTakePhoto });
    fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
    expect(onTakePhoto).toHaveBeenCalledTimes(1);
  });

  it("opens the in-app camera when Take photo is tapped", async () => {
    const getUserMedia = vi.fn(async () => {
      const track = { stop: vi.fn() };
      return { getTracks: () => [track] } as unknown as MediaStream;
    });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    renderStep({ cameraOpen: true });
    expect(
      await screen.findByRole("button", { name: "Capture photo" })
    ).toBeTruthy();
  });
});
