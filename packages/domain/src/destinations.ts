import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type DestinationDefinition = {
  readonly code: string;
  readonly city: string;
  readonly country: string;
  readonly tier: "near" | "medium" | "far";
};

const destinationDataUrl = new URL("../data/destinations.yaml", import.meta.url);

const isDestination = (value: unknown): value is DestinationDefinition => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.city === "string" &&
    typeof candidate.country === "string" &&
    (candidate.tier === "near" || candidate.tier === "medium" || candidate.tier === "far")
  );
};

const loadDestinations = (): DestinationDefinition[] => {
  const parsed = parse(readFileSync(destinationDataUrl, "utf-8"));

  if (!Array.isArray(parsed) || !parsed.every(isDestination)) {
    throw new Error("Invalid destination data file");
  }

  return parsed.map((destination) => ({
    ...destination,
    code: destination.code.toUpperCase(),
    country: destination.country.toUpperCase(),
  }));
};

export const destinations: DestinationDefinition[] = loadDestinations();
