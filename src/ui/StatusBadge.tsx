import React from "react";
import { Text } from "ink";
import type { ApplicationStatus } from "../db/repo.ts";

const COLORS: Record<ApplicationStatus, string> = {
  saved: "gray",
  applied: "blue",
  oa: "cyan",
  interviewing: "yellow",
  offer: "green",
  rejected: "red",
  withdrawn: "gray",
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <Text color={COLORS[status]}>{status}</Text>;
}
