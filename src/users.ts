import { readFileSync } from "fs";

let cache: Record<string, string> | null = null;

function loadUsers(): Record<string, string> {
  if (cache !== null) return cache;
  const path = process.env.USERS_JSON_PATH;
  if (!path) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
  } catch {
    cache = {};
  }
  return cache;
}

export function resolveUsername(userId: string): string {
  return loadUsers()[userId] ?? userId;
}

export function _resetUsersCache(): void {
  cache = null;
}
