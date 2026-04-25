import { readEnv } from "@lowroute/config";
import type { NormalizedOffer } from "@lowroute/domain";

type Logger = {
  readonly info: (payload: object, message: string) => void;
  readonly warn: (payload: object, message: string) => void;
};

const noopLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
};

const escapeHtml = (input: string): string => {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const riskFlags = (offer: NormalizedOffer): string[] => {
  const flags: string[] = [];

  if (offer.self_transfer) {
    flags.push("[self-transfer]");
  }
  if (offer.separate_tickets) {
    flags.push("[separate tickets]");
  }
  if (offer.airport_change) {
    flags.push("[airport change]");
  }
  if (offer.overnight_layover) {
    flags.push("[overnight layover]");
  }
  if (!offer.checked_bag_included) {
    flags.push("[no checked bag]");
  }

  return flags;
};

const formatDealMessage = (offer: NormalizedOffer): string => {
  const flags = riskFlags(offer).join(" ");
  return [
    `<b>${escapeHtml(offer.origin)} -> ${escapeHtml(offer.destination)}</b>`,
    `Price: <b>USD ${offer.normalized_payable.amount.toFixed(2)}</b> (${offer.quoted_price.currency} ${offer.quoted_price.amount.toFixed(2)})`,
    `Dates: ${escapeHtml(offer.departure_date)} to ${escapeHtml(offer.return_date)} (${offer.trip_days}d)`,
    `Provider: ${escapeHtml(offer.provider)}`,
    flags,
  ]
    .filter(Boolean)
    .join("\n");
};

export type TelegramNotifier = {
  readonly sendDealAlert: (offer: NormalizedOffer) => Promise<boolean>;
};

export type TelegramNotifierOptions = {
  readonly env?: ReturnType<typeof readEnv>;
  readonly logger?: Logger;
  readonly retryCount?: number;
  readonly timeoutMs?: number;
};

export const buildTelegramNotifier = (options: TelegramNotifierOptions = {}): TelegramNotifier => {
  const env = options.env ?? readEnv(process.env);
  const logger = options.logger ?? noopLogger;
  const retryCount = options.retryCount ?? 2;
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    async sendDealAlert(offer: NormalizedOffer): Promise<boolean> {
      const message = formatDealMessage(offer);

      if (env.ALERT_DRY_RUN || !env.TELEGRAM_ALERTS_ENABLED) {
        logger.info({ message, offer }, "telegram alert dry run");
        return false;
      }

      const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

      for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: env.TELEGRAM_CHAT_ID,
              parse_mode: "HTML",
              text: message,
              disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (response.ok) {
            return true;
          }

          logger.warn(
            { attempt, status: response.status, responseText: await response.text() },
            "telegram send failed",
          );
        } catch (error) {
          logger.warn({ attempt, error }, "telegram send errored");
        }
      }

      return false;
    },
  };
};
