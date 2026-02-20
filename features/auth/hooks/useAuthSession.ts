import { useContext } from "react";
import { AuthContext } from "../context/AuthProvider";
import { AuthViewModel } from "../types/AuthViewModel";

export function useAuthSession(): AuthViewModel {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthProvider.");
  }
  return context;
}
