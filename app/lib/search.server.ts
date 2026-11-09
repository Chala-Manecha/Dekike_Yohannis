import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { likePattern } from "./songs";

/** Case-insensitive "contains" that treats % and _ in the search text literally. */
export function contains(column: SQLiteColumn, q: string): SQL {
  return sql`${column} LIKE ${likePattern(q)} ESCAPE '\\'`;
}
