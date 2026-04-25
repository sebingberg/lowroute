export type SearchProfile = {
  readonly traveler_type: "solo";
  readonly baggage_profile: "backpack_carryon";
  readonly cabin: "economy";
  readonly max_layover_hours: number;
};

export const defaultSearchProfile: SearchProfile = {
  traveler_type: "solo",
  baggage_profile: "backpack_carryon",
  cabin: "economy",
  max_layover_hours: 8,
};
