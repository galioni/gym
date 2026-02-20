import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./AuthService";
import { AuthSession } from "../../interfaces/auth/AuthSession";
import { AuthSessionRepository } from "../../interfaces/auth/AuthSessionRepository";

function createRepositoryMock(): AuthSessionRepository {
  return {
    getSession: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe("AuthService", () => {
  it("delegates getSession to repository", async () => {
    const repository = createRepositoryMock();
    const expected: AuthSession = {
      accessToken: "token-1",
      user: {
        id: "user-1",
        email: "user@example.com",
        displayName: "User Example",
        avatarUrl: null,
      },
    };
    vi.mocked(repository.getSession).mockResolvedValue(expected);

    const service = new AuthService(repository);
    const session = await service.getSession();

    expect(repository.getSession).toHaveBeenCalledTimes(1);
    expect(session).toEqual(expected);
  });

  it("delegates sign-in and sign-out intents", async () => {
    const repository = createRepositoryMock();
    const service = new AuthService(repository);

    await service.signInWithGoogle();
    await service.signOut();

    expect(repository.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(repository.signOut).toHaveBeenCalledTimes(1);
  });

  it("returns unsubscribe handler from repository subscription", () => {
    const repository = createRepositoryMock();
    const unsubscribe = vi.fn();
    vi.mocked(repository.subscribe).mockReturnValue(unsubscribe);
    const listener = vi.fn();
    const service = new AuthService(repository);

    const dispose = service.subscribe(listener);

    expect(repository.subscribe).toHaveBeenCalledWith(listener);
    expect(dispose).toBe(unsubscribe);
  });
});
