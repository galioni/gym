import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

const defaultProps = {
  isWorking: false,
  error: null,
  onSignIn: vi.fn(),
  onSignInWithEmail: vi.fn(),
  onSignUpWithEmail: vi.fn(),
  onResetPassword: vi.fn(),
};

describe("LandingPage", () => {
  afterEach(cleanup);

  it("renders sign-in form by default", () => {
    render(<LandingPage {...defaultProps} />);
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
    // The "Sign in" label appears on both the mode tab and the submit button — just assert there is at least one
    expect(screen.getAllByRole("button", { name: /^sign in$/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("shows email confirmation message after sign-up when needsConfirmation is true", async () => {
    const onSignUpWithEmail = vi.fn().mockResolvedValue({ needsConfirmation: true });
    render(<LandingPage {...defaultProps} onSignUpWithEmail={onSignUpWithEmail} />);

    // Switch to sign-up mode via the tab (first "Sign up" button in DOM order)
    fireEvent.click(screen.getAllByRole("button", { name: /^sign up$/i })[0]);
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeTruthy();
    });
    // Tabs and Google button should be hidden
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
  });

  it("back to sign in link from confirmation pending clears the state", async () => {
    const onSignUpWithEmail = vi.fn().mockResolvedValue({ needsConfirmation: true });
    render(<LandingPage {...defaultProps} onSignUpWithEmail={onSignUpWithEmail} />);

    fireEvent.click(screen.getAllByRole("button", { name: /^sign up$/i })[0]);
    fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/back to sign in/i));
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
  });

  it("shows password reset sent message after requesting a reset", async () => {
    const onResetPassword = vi.fn().mockResolvedValue({ sent: true });
    render(<LandingPage {...defaultProps} onResetPassword={onResetPassword} />);

    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email for a password reset link/i)).toBeTruthy();
    });
  });

  it("displays error prop on the sign-in form", () => {
    render(<LandingPage {...defaultProps} error="Invalid credentials" />);
    expect(screen.getByText("Invalid credentials")).toBeTruthy();
  });

  it("switches to sign-up mode when Sign up tab is clicked", () => {
    render(<LandingPage {...defaultProps} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^sign up$/i })[0]);
    expect(screen.getByRole("button", { name: /create account/i })).toBeTruthy();
  });
});
