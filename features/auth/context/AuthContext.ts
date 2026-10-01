import React from "react";
import { AuthViewModel } from "../types/AuthViewModel";

export const AuthContext = React.createContext<AuthViewModel | undefined>(undefined);
