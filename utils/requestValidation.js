const isNonEmptyString = (value) => (
  typeof value === "string" && value.trim().length > 0
);

const isValidObjectId = (value) => (
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value)
);

const parsePagination = (query) => {
  const pageValue = query.page ?? "1";
  const limitValue = query.limit ?? "10";
  if (
    (typeof pageValue !== "string" && typeof pageValue !== "number") ||
    (typeof limitValue !== "string" && typeof limitValue !== "number") ||
    !/^\d+$/.test(String(pageValue)) ||
    !/^\d+$/.test(String(limitValue))
  ) {
    return null;
  }

  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return null;
  }

  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) return null;
  return { page, limit, skip };
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = {
  isNonEmptyString,
  isValidObjectId,
  parsePagination,
  escapeRegex
};
