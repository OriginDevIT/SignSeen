// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PasswordInput from "./PasswordInput";

afterEach(() => {
  cleanup();
});

const inputStyle: React.CSSProperties = {
  padding: "0.7rem",
  fontSize: "1rem",
  border: "1px solid #ccc",
  borderRadius: "0.375rem",
  width: "100%",
  boxSizing: "border-box",
};

describe("PasswordInput", () => {
  it("masks the value by default and reveals it when Show is clicked", () => {
    const onChange = vi.fn();
    render(
      <PasswordInput
        value="secret-value"
        onChange={onChange}
        placeholder="Password"
        style={inputStyle}
      />
    );
    const input = screen.getByPlaceholderText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeTruthy();
  });

  it("hides the value again when Hide is clicked", () => {
    render(
      <PasswordInput
        value="secret-value"
        onChange={() => {}}
        placeholder="Password"
        style={inputStyle}
      />
    );
    const input = screen.getByPlaceholderText("Password") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });

  it("reports typed characters through onChange", () => {
    const onChange = vi.fn();
    render(
      <PasswordInput
        value=""
        onChange={onChange}
        placeholder="Password"
        style={inputStyle}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "new-pass" },
    });
    expect(onChange).toHaveBeenCalledWith("new-pass");
  });

  it("does not submit a surrounding form when the toggle is clicked", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput
          value="secret-value"
          onChange={() => {}}
          placeholder="Password"
          style={inputStyle}
        />
      </form>
    );
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
