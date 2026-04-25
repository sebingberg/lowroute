create table if not exists offers (
  id bigserial primary key,
  offer_fingerprint text not null unique,
  provider text not null,
  origin text not null,
  destination text not null,
  departure_date date not null,
  return_date date not null,
  normalized_payable_usd numeric(12, 2) not null,
  currency text not null,
  quoted_amount numeric(12, 2) not null,
  risk_flags jsonb not null default '{}'::jsonb,
  created_at_utc timestamptz not null default now()
);

create index if not exists offers_route_dates_idx
  on offers (origin, destination, departure_date, return_date);

create table if not exists route_baselines (
  route_key text primary key,
  p20 numeric(12, 2) not null,
  median numeric(12, 2) not null,
  sample_size integer not null,
  updated_at_utc timestamptz not null default now()
);

create table if not exists sent_alerts (
  id bigserial primary key,
  alert_fingerprint text not null unique,
  offer_fingerprint text not null references offers (offer_fingerprint),
  sent_at_utc timestamptz not null default now()
);

create index if not exists sent_alerts_sent_at_idx
  on sent_alerts (sent_at_utc desc);

create table if not exists probe_runs (
  probe_run_id uuid primary key,
  provider text not null,
  started_at_utc timestamptz not null,
  completed_at_utc timestamptz,
  status text not null,
  summary jsonb not null default '{}'::jsonb
);
