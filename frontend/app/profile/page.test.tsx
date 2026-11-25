// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import ProfilePage from "./page";
import { myAccount, updateAccountName, type AccountInfo } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    myAccount: vi.fn(),
    updateAccountName: vi.fn(),
  };
});

const mockedMyAccount = vi.mocked(myAccount);
const mockedUpdateAccountName = vi.mocked(updateAccountName);

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
