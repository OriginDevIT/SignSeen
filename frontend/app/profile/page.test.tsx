// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ProfilePage from "./page";
import {
  deleteAccount,
  myAccount,
  updateAccountName,
  type AccountInfo,
} from "../../lib/api";

vi.mock("next/navigation", () => {
  const router = { push: vi.fn(), replace: vi.fn() };
  return { useRouter: () => router };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    myAccount: vi.fn(),
    updateAccountName: vi.fn(),
    deleteAccount: vi.fn(),
  };
});

const mockedMyAccount = vi.mocked(myAccount);
const mockedUpdateAccountName = vi.mocked(updateAccountName);
const mockedDeleteAccount = vi.mocked(deleteAccount);

const ACCOUNT: AccountInfo = {
  id: "acct-1",
  email: "sender@example.com",
  name: "Sender Person",
  tier: "free",
  is_premium: false,
  alerts_enabled: true,
  billing_status: "active",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProfilePage", () => {
  it("shows the account email and current name", async () => {
    mockedMyAccount.mockResolvedValue(ACCOUNT);
    render(<ProfilePage />);
    expect(await screen.findByText("sender@example.com")).toBeTruthy();
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Sender Person");
  });

  it("saves an edited name and shows confirmation", async () => {
    mockedMyAccount.mockResolvedValue(ACCOUNT);
    mockedUpdateAccountName.mockResolvedValue({ ...ACCOUNT, name: "New Name" });
    render(<ProfilePage />);
    const input = (await screen.findByLabelText("Name")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByText("Save name"));
    await waitFor(() =>
      expect(mockedUpdateAccountName).toHaveBeenCalledWith("New Name")
    );
    expect(await screen.findByText("Name saved.")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "New Name"
    );
  });

  it("asks the visitor to log in when there is no account", async () => {
    mockedMyAccount.mockRejectedValue(new Error("unauthorized"));
    render(<ProfilePage />);
    expect(await screen.findByText(/Log in to view your account/)).toBeTruthy();
    // The header nav and the page's own error-state link both read
    // "Log in" and both point at /login.
    const logins = screen.getAllByText("Log in");
    expect(logins).toHaveLength(2);
  });
});

describe("ProfilePage site navigation (#164)", () => {
  it("shows the shared navigation and keeps the Back to dashboard link", async () => {
    mockedMyAccount.mockResolvedValue(ACCOUNT);
    render(<ProfilePage />);
    expect(await screen.findByText("sender@example.com")).toBeTruthy();

    expect(screen.getByRole("link", { name: "SignSeen" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Send a document" })
        .getAttribute("href")
    ).toBe("/send");
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Back to dashboard" })
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Back to dashboard" })
        .getAttribute("href")
    ).toBe("/dashboard");
  });
});

describe("ProfilePage close account (#183)", () => {
  it("asks for confirmation before closing, and Cancel backs out", async () => {
    mockedMyAccount.mockResolvedValue(ACCOUNT);
    render(<ProfilePage />);
    expect(await screen.findByText("sender@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close account" }));
    expect(screen.getByText(/Close your account?/)).toBeTruthy();
    expect(mockedDeleteAccount).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Close your account?/)).toBeNull();
    expect(mockedDeleteAccount).not.toHaveBeenCalled();
  });

  it("confirming closes the account and navigates home", async () => {
    const { useRouter } = await import("next/navigation");
    mockedMyAccount.mockResolvedValue(ACCOUNT);
    mockedDeleteAccount.mockResolvedValue(undefined);
    render(<ProfilePage />);
    expect(await screen.findByText("sender@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close account" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm close account" })
    );
    await waitFor(() =>
      expect(mockedDeleteAccount).toHaveBeenCalledTimes(1)
    );
    expect(useRouter().push).toHaveBeenCalledWith("/");
  });

  it("a failed close shows the error and stays on the page", async () => {
    mockedMyAccount.mockResolvedValue(ACCOUNT);
    mockedDeleteAccount.mockRejectedValue(
      new Error("Could not close your account")
    );
    render(<ProfilePage />);
    expect(await screen.findByText("sender@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close account" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm close account" })
    );
    expect(
      await screen.findByText("Could not close your account")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Confirm close account" })
    ).toBeTruthy();
  });
});
