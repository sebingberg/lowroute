import type { NormalizedSearchRequest } from "@lowroute/providers";

export type FetchJobInput = {
  readonly provider: string;
  readonly search: NormalizedSearchRequest;
};

export const fetchOffers = async (input: FetchJobInput): Promise<FetchJobInput> => {
  return input;
};
