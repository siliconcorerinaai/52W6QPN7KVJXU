"use client";

import { createContext, useContext } from "react";

const AdminContext = createContext(false);

/** Indique aux pages client si la personne connectée est l'administrateur (fourni par le layout). */
export function RoleProvider({ admin, children }: { admin: boolean; children: React.ReactNode }) {
  return <AdminContext.Provider value={admin}>{children}</AdminContext.Provider>;
}

export const useIsAdmin = () => useContext(AdminContext);
