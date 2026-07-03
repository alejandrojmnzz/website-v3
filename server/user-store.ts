/**
 * UserStore — configurable role-based authorization singleton.
 *
 * Local file at repo root (.multisite-user-store.json),
 * synced to multisite-user-store/users-state.json in GCS on every write.
 */

import * as fs from "fs";
import * as path from "path";
import {
  platformUserStoreGcsKey,
  platformUserStoreLocalFilename,
  userStoreReadKeys,
} from "@shared/gcsKeys";
import { gcs } from "./gcs";
import {

  CAPABILITY_REGISTRY,
  SCOPED_CAPABILITIES,
  GLOBAL_CAPABILITIES,
  ALL_CAPABILITIES,
  type ScopedCapability,
  type GlobalCapability,
  type CapabilityName,
} from "../shared/capabilities";
import { child } from "./logger";
const log = child({ module: "user-store" });

export type { ScopedCapability, GlobalCapability, CapabilityName };
export { SCOPED_CAPABILITIES, GLOBAL_CAPABILITIES, ALL_CAPABILITIES, CAPABILITY_REGISTRY };

function getLocalPath(): string {
  const platformPath = path.join(process.cwd(), platformUserStoreLocalFilename());
  if (fs.existsSync(platformPath)) return platformPath;
  // Legacy fallback: default site content folder
  try {
    const { getDefaultContentRoot } = require("./site-config") as typeof import("./site-config");
    const legacyPath = path.join(getDefaultContentRoot(), ".users-state.json");
    if (fs.existsSync(legacyPath)) return legacyPath;
  } catch { /* ignore */ }
  return platformPath;
}

const GCS_KEY = platformUserStoreGcsKey();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

export interface CapabilityGrant {
  name: CapabilityName;
  contentTypes?: string[] | "*";
}

export interface RoleDefinition {
  label: string;
  description?: string;
  capabilities: CapabilityGrant[];
}

export interface UserRecord {
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  lastLoginAt?: string;
  roles: string[];
}

export interface PendingUserRecord {
  email: string;
  role: string;
  createdAt: string;
}

interface UsersState {
  roles: Record<string, RoleDefinition>;
  users: Record<string, UserRecord>;
  pendingUsers?: Record<string, PendingUserRecord>;
}

// ─── Built-in webmaster role ───────────────────────────────────────────────────

const BUILT_IN_WEBMASTER_ROLE: RoleDefinition = {
  label: "Webmaster",
  description: "Full platform access",
  capabilities: [
    { name: "users_manage" },
    { name: "theme_edit" },
    { name: "media_upload" },
    { name: "media_delete" },
    { name: "seo_edit" },
    { name: "content_types_manage" },
    { name: "databases_manage" },
    { name: "components_manage" },
    { name: "migrations_run" },
    { name: "content_create_entry", contentTypes: "*" },
    { name: "content_delete_entry", contentTypes: "*" },
    { name: "content_edit_structure", contentTypes: "*" },
    { name: "content_edit_default", contentTypes: "*" },
    { name: "content_create_variant", contentTypes: "*" },
    { name: "content_edit_variant", contentTypes: "*" },
    { name: "content_delete_variant", contentTypes: "*" },
    { name: "content_edit_text", contentTypes: "*" },
    { name: "content_edit_media", contentTypes: "*" },
    { name: "content_allocate_traffic", contentTypes: "*" },
    { name: "content_promote_variant", contentTypes: "*" },
  ],
};

const DEFAULT_STATE: UsersState = {
  roles: {
    webmaster: BUILT_IN_WEBMASTER_ROLE,
  },
  users: {},
};

// ─── In-memory state ───────────────────────────────────────────────────────────

let state: UsersState = { roles: { ...DEFAULT_STATE.roles }, users: {} };
let loaded = false;

// ─── Persistence ───────────────────────────────────────────────────────────────

function saveLocal(): void {
  try {
    const dir = path.dirname(getLocalPath());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getLocalPath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error saving local file:");
  }
}

async function saveToBucket(): Promise<void> {
  if (!IS_PRODUCTION || !gcs.available) return;
  try {
    const content = JSON.stringify(state, null, 2);
    gcs.debouncedUpload(GCS_KEY, Buffer.from(content, "utf-8"), "application/json");
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error saving to GCS:");
  }
}

function save(): void {
  saveLocal();
  saveToBucket().catch((err) => {
    log.error({ err: err }, "[UserStore] Background GCS save failed:");
  });
}

function loadLocal(): UsersState {
  try {
    if (fs.existsSync(getLocalPath())) {
      const raw = fs.readFileSync(getLocalPath(), "utf-8");
      return JSON.parse(raw) as UsersState;
    }
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error loading local file:");
  }
  return { roles: { ...DEFAULT_STATE.roles }, users: {} };
}

/**
 * Load users state from GCS on startup (production only).
 * Falls back to local file if GCS is unavailable.
 */
export async function loadUsersStateFromBucket(): Promise<void> {
  if (!IS_PRODUCTION) {
    log.info("[UserStore] Development mode — using local file only");
    state = loadLocal();
    // Always sync built-in webmaster role from code
    if (!state.roles) state.roles = {};
    state.roles.webmaster = BUILT_IN_WEBMASTER_ROLE;
    saveLocal();
    loaded = true;
    return;
  }

  if (!gcs.available) {
    log.info("[UserStore] GCS unavailable — loading from local file");
    state = loadLocal();
    // Always sync built-in webmaster role from code
    if (!state.roles) state.roles = {};
    state.roles.webmaster = BUILT_IN_WEBMASTER_ROLE;
    saveLocal();
    loaded = true;
    return;
  }

  try {
    const result = await gcs.downloadFirstExisting(userStoreReadKeys());
    if (!result) {
      log.info("[UserStore] No users state in GCS — using local file");
      state = loadLocal();
    } else {
      state = JSON.parse(result.data.toString("utf-8")) as UsersState;
      log.info("[UserStore] Loaded users state from GCS");
      saveLocal();
    }
  } catch (err) {
    log.error({ err: err }, "[UserStore] Error loading from GCS:");
    state = loadLocal();
  }

  // Always sync built-in webmaster role from code
  if (!state.roles) state.roles = {};
  state.roles.webmaster = BUILT_IN_WEBMASTER_ROLE;
  save();
  if (!state.users) state.users = {};

  loaded = true;
}

function ensureLoaded(): void {
  if (!loaded) {
    state = loadLocal();
    if (!state.roles) state.roles = {};
    state.roles.webmaster = BUILT_IN_WEBMASTER_ROLE;
    if (!state.users) state.users = {};
    if (!state.pendingUsers) state.pendingUsers = {};
    loaded = true;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true if no user currently holds the webmaster role.
 * This ensures the bootstrap grant fires even when stale user records
 * exist from prior deployments that never completed first-login.
 */
export function isFirstUser(): boolean {
  ensureLoaded();
  return !Object.values(state.users).some((u) => u.roles.includes("webmaster"));
}

/**
 * Upsert a user record (from Breathecode profile). Updates lastLoginAt.
 */
export function upsertUser(profile: {
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}): UserRecord {
  ensureLoaded();
  const existing = state.users[profile.username];
  const record: UserRecord = {
    username: profile.username,
    firstName: profile.firstName ?? existing?.firstName,
    lastName: profile.lastName ?? existing?.lastName,
    email: profile.email ?? existing?.email,
    lastLoginAt: new Date().toISOString(),
    roles: existing?.roles ?? [],
  };
  state.users[profile.username] = record;
  save();
  return record;
}

/**
 * Assign roles to a user, replacing all existing assignments.
 */
export function assignRoles(username: string, roleIds: string[]): void {
  ensureLoaded();
  if (!state.users[username]) {
    state.users[username] = { username, roles: [] };
  }
  state.users[username].roles = roleIds;
  save();
}

/**
 * Get all effective capability grants for a user (union across all their roles).
 */
export function getEffectiveCapabilities(username: string): CapabilityGrant[] {
  ensureLoaded();
  const user = state.users[username];
  if (!user) return [];

  const grantMap = new Map<string, CapabilityGrant>();

  for (const roleId of user.roles) {
    const role = state.roles[roleId];
    if (!role) continue;
    for (const grant of role.capabilities) {
      const existing = grantMap.get(grant.name);
      if (!existing) {
        grantMap.set(grant.name, { ...grant });
      } else {
        // Merge: "*" wins over a specific list
        if (existing.contentTypes === "*" || grant.contentTypes === "*") {
          grantMap.set(grant.name, { name: grant.name, contentTypes: "*" });
        } else if (existing.contentTypes && grant.contentTypes) {
          const merged = Array.from(
            new Set([
              ...(existing.contentTypes as string[]),
              ...(grant.contentTypes as string[]),
            ])
          );
          grantMap.set(grant.name, { name: grant.name, contentTypes: merged });
        }
      }
    }
  }

  return Array.from(grantMap.values());
}

/**
 * Check if a user has a specific capability, optionally scoped to a content type.
 */
export function hasCapability(
  username: string,
  capName: CapabilityName,
  contentType?: string
): boolean {
  const caps = getEffectiveCapabilities(username);
  const grant = caps.find((g) => g.name === capName);
  if (!grant) return false;

  if (SCOPED_CAPABILITIES.includes(capName as ScopedCapability)) {
    if (!contentType) {
      // No content type provided — only allow if the grant covers all content types.
      // Fail-closed for any scoped grant to prevent bypass via missing scope.
      return grant.contentTypes === "*";
    }
    if (grant.contentTypes === "*") return true;
    if (Array.isArray(grant.contentTypes)) {
      return grant.contentTypes.includes(contentType);
    }
    return false;
  }

  return true;
}

export function getAllUsers(): UserRecord[] {
  ensureLoaded();
  return Object.values(state.users);
}

export function getUser(username: string): UserRecord | null {
  ensureLoaded();
  return state.users[username] ?? null;
}

export function getAllRoles(): Record<string, RoleDefinition> {
  ensureLoaded();
  return { ...state.roles };
}

export function getRole(roleId: string): RoleDefinition | null {
  ensureLoaded();
  return state.roles[roleId] ?? null;
}

export function setRole(roleId: string, definition: RoleDefinition): void {
  ensureLoaded();
  state.roles[roleId] = definition;
  save();
}

export function deleteUser(username: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.users[username]) {
    return { ok: false, error: "User not found" };
  }
  delete state.users[username];
  save();
  return { ok: true };
}

export function renameUser(oldUsername: string, newUsername: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.users[oldUsername]) {
    return { ok: false, error: "User not found" };
  }
  if (state.users[newUsername]) {
    return { ok: false, error: `Username "${newUsername}" is already taken` };
  }
  state.users[newUsername] = { ...state.users[oldUsername], username: newUsername };
  delete state.users[oldUsername];
  save();
  return { ok: true };
}

// ─── Pending Users API ─────────────────────────────────────────────────────────

export function addPendingUser(email: string, role: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.pendingUsers) state.pendingUsers = {};
  const normalizedEmail = email.toLowerCase().trim();
  if (!normalizedEmail) return { ok: false, error: "Email is required" };
  if (!state.roles[role]) return { ok: false, error: `Role "${role}" does not exist` };
  state.pendingUsers[normalizedEmail] = {
    email: normalizedEmail,
    role,
    createdAt: new Date().toISOString(),
  };
  save();
  return { ok: true };
}

export function removePendingUser(email: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.pendingUsers) state.pendingUsers = {};
  const normalizedEmail = email.toLowerCase().trim();
  if (!state.pendingUsers[normalizedEmail]) {
    return { ok: false, error: "Pending user not found" };
  }
  delete state.pendingUsers[normalizedEmail];
  save();
  return { ok: true };
}

export function getPendingUsers(): PendingUserRecord[] {
  ensureLoaded();
  if (!state.pendingUsers) return [];
  return Object.values(state.pendingUsers);
}

/**
 * If the given email has a pending pre-registration, returns the pre-assigned
 * role and removes the pending entry (one-time claim). Returns null if no match.
 */
export function claimPendingUser(email: string): string | null {
  ensureLoaded();
  if (!state.pendingUsers) return null;
  const normalizedEmail = email.toLowerCase().trim();
  const pending = state.pendingUsers[normalizedEmail];
  if (!pending) return null;
  delete state.pendingUsers[normalizedEmail];
  save();
  return pending.role;
}

/**
 * Manually assign a pending pre-registration to a specific existing user,
 * bypassing email-matching. Grants the role and removes the pending entry.
 */
export function assignPendingToUser(email: string, username: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (!state.pendingUsers) state.pendingUsers = {};
  const normalizedEmail = email.toLowerCase().trim();
  const pending = state.pendingUsers[normalizedEmail];
  if (!pending) return { ok: false, error: "Pending user not found" };
  if (!state.users[username]) return { ok: false, error: "User not found" };
  const currentRoles = state.users[username].roles ?? [];
  if (!currentRoles.includes(pending.role)) {
    state.users[username].roles = [...currentRoles, pending.role];
  }
  delete state.pendingUsers[normalizedEmail];
  save();
  return { ok: true };
}

export function deleteRole(roleId: string): { ok: boolean; error?: string } {
  ensureLoaded();
  if (roleId === "webmaster") {
    return { ok: false, error: "The built-in webmaster role cannot be deleted" };
  }
  if (!state.roles[roleId]) {
    return { ok: false, error: "Role not found" };
  }
  const usersWithRole = Object.values(state.users).filter((u) =>
    u.roles.includes(roleId)
  );
  if (usersWithRole.length > 0) {
    return {
      ok: false,
      error: `Role is assigned to ${usersWithRole.length} user(s). Remove the role from those users first.`,
    };
  }
  delete state.roles[roleId];
  save();
  return { ok: true };
}
