const MAX_CENTS = Number.MAX_SAFE_INTEGER;

const parseMoneyCents = (value) => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) ||
    (typeof value === "number" && (!Number.isFinite(value) || value < 0))
  ) return null;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
};

const parseQuantity = (value) => (
  (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) &&
  Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : null
);

const formatMoney = (cents) => Number((cents / 100).toFixed(2));

const parseSaleUnitPriceCents = (storedPrice, requestedPrice) => {
  const price = requestedPrice === undefined
    ? parseMoneyCents(storedPrice)
    : parseMoneyCents(requestedPrice);
  return price === null ? null : price;
};

module.exports = {
  parseMoneyCents,
  parseQuantity,
  formatMoney,
  parseSaleUnitPriceCents
};
