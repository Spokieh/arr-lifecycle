"use server";

import { refresh } from "next/cache";
import { invalidateGroup } from "@/lib/server/cache";

export async function refreshMovies() {
  // Only our process-local read cache changes. No upstream mutation is performed.
  invalidateGroup("media");
  refresh();
}
