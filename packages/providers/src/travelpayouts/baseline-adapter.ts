import { type BaselineStats, Money } from "@lowroute/domain";

export type TravelpayoutsRouteBaseline = {
  readonly origin: string;
  readonly destination: string;
  readonly p20: number;
  readonly median: number;
  readonly sample_size: number;
};

export const toBaselineStats = (input: TravelpayoutsRouteBaseline): BaselineStats => {
  return {
    route_key: `${input.origin}-${input.destination}`,
    p20: Money.fromDecimal(input.p20, "USD"),
    median: Money.fromDecimal(input.median, "USD"),
    sample_size: input.sample_size,
  };
};
