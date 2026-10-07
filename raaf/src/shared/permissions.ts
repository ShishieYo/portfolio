import type { Role } from "./types";

export const PERMISSIONS = [
  "record:create",
  "record:read:all", // without it a user only sees their own records
  "record:edit:any", // without it a user may only edit their own records
  "record:validate",
  "record:submit",
  "record:review", // approve or return a record
  "record:void",
  "rules:manage",
  "users:manage",
  "audit:read",
  "settings:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Add a role by adding an entry here (and to the Role type); nothing else checks role names. */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  encoder: ["record:create", "record:validate", "record:submit", "record:void"],
  reviewer: ["record:read:all", "record:validate", "record:review"],
};

export const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

export const permissionsFor = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];
export const can = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].includes(permission);
