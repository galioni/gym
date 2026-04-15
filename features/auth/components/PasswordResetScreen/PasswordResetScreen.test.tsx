import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordResetScreen } from "./PasswordResetScreen";

describe("PasswordResetScreen", () => {
  afterEach(cleanup);
  it("renders the set password form", () => {
    render(<PasswordResetScreen isWorking={false} onUpdatePassword={vi.fn()} />);
    expect(screen.getByPlaceholderText("New password")).toBeTruthy();
    expect(screen.getByPlaceholderText("Confirm password")).toBeTruthy();
    expect(screen.getByRole("button", { name: /set password/i })).toBeTruthy();
  });

  it("shows error when password is too short", async () => {
    render(<PasswordResetScreen isWorking={false} onUpdatePassword={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "short" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => {
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeTruthy();
    });
  });

  it("shows error when passwords do not match", async () => {
    render(<PasswordResetScreen isWorking={false} onUpdatePassword={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "password123" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), { target: { value: "different123" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => {
      expect(screen.getByText(/do not match/i)).toBeTruthy();
    });
  });

  it("shows success state when password update succeeds", async () => {
    const onUpdatePassword = vi.fn().mockResolvedValue({ success: true });
    render(<PasswordResetScreen isWorking={false} onUpdatePassword={onUpdatePassword} />);
    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "newpassword1" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), { target: { value: "newpassword1" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => {
      expect(screen.getByText(/password updated/i)).toBeTruthy();
    });
    expect(onUpdatePassword).toHaveBeenCalledWith("newpassword1");
  });

  it("shows error when password update fails", async () => {
    const onUpdatePassword = vi.fn().mockResolvedValue({ success: false });
    render(<PasswordResetScreen isWorking={false} onUpdatePassword={onUpdatePassword} />);
    fireEvent.change(screen.getByPlaceholderText("New password"), { target: { value: "newpassword1" } });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), { target: { value: "newpassword1" } });
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => {
      expect(screen.getByText(/link may have expired/i)).toBeTruthy();
    });
  });

  it("disables the button while working", () => {
    render(<PasswordResetScreen isWorking={true} onUpdatePassword={vi.fn()} />);
    expect(screen.getByRole("button", { name: /updating/i }).hasAttribute("disabled")).toBe(true);
  });
});
