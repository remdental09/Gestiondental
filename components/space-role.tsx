"use client";

import { createContext, useContext } from "react";

/** Rol de quien usa la app dentro del espacio (titular, admin, dentista, recepcion, asistente). Lo provee la página principal. */
export const SpaceRoleContext = createContext<string | undefined>(undefined);
export const useSpaceRole = () => useContext(SpaceRoleContext);
