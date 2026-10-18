const archiver = require("archiver");
const ExcelJS = require("exceljs");
const mongoose = require("mongoose");
const Organization = require("../models/Organization");
const Category = require("../models/Category");
const Product = require("../models/Product");
const Sale = require("../models/Sale");
const StockHistory = require("../models/StockHistory");
const Customer = require("../models/Customer");
const Udhaar = require("../models/Udhaar");
const Payment = require("../models/Payment");
const Notification = require("../models/Notification");
const User = require("../models/User");
const handleControllerError = require("../utils/controllerError");
const { isValidObjectId } = require("../utils/requestValidation");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const csvCell = (value) => {
  const normalized = value == null
    ? ""
    : value instanceof Date
      ? value.toISOString()
      : typeof value.toHexString === "function"
        ? value.toHexString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const safeValue = typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(normalized)
    ? `'${normalized}`
    : normalized;
  return `"${safeValue.replace(/"/g, '""')}"`;
};

const createCsv = (headers, rows) => (
  `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
);

const createRows = (records, fields) => records.map((record) => (
  fields.map((field) => field.split(".").reduce((value, key) => value?.[key], record))
));

const parseDateRange = (query) => {
  const range = {};
  for (const [key, operator, suffix] of [
    ["startDate", "$gte", "T00:00:00.000Z"],
    ["endDate", "$lte", "T23:59:59.999Z"]
  ]) {
    const value = query[key];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { error: `Invalid ${key}` };
    }
    const date = new Date(`${value}${suffix}`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      return { error: `Invalid ${key}` };
    }
    range[operator] = date;
  }
  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    return { error: "End date must be on or after the start date" };
  }
  return { range };
};

const sortRecords = (records, sortBy, sortOrder, getValue) => {
  if (!sortBy || !sortOrder) return records;
  const direction = sortOrder === "asc" ? 1 : -1;
  return records.sort((first, second) => {
    const firstValue = getValue(first, sortBy);
    const secondValue = getValue(second, sortBy);
    if (firstValue == null && secondValue != null) return -direction;
    if (secondValue == null && firstValue != null) return direction;
    if (firstValue == null && secondValue == null) return 0;
    if (firstValue instanceof Date || secondValue instanceof Date) {
      return (new Date(firstValue) - new Date(secondValue)) * direction;
    }
    if (typeof firstValue === "number" && typeof secondValue === "number") {
      return (firstValue - secondValue) * direction;
    }
    return String(firstValue).localeCompare(String(secondValue), undefined, {
      numeric: true,
      sensitivity: "base"
    }) * direction;
  });
};

const normalizeExcelCell = (value) => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toHexString === "function") return value.toHexString();
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(value)) return `'${value}`;
  return value;
};

const createExcelWorkbook = async (metadata, datasets) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MYStockHub";
  workbook.created = new Date();

  const metadataSheet = workbook.addWorksheet("Organization");
  metadataSheet.addRows([
    ["Field", "Value"],
    ["Organization", JSON.stringify(metadata.organization)],
    ["Store settings", JSON.stringify(metadata.storeSettings)],
    ["Exported at", metadata.exportedAt],
    ["Record counts", JSON.stringify(metadata.recordCounts)]
  ]);

  datasets.forEach(({ sheetName, headers, rows }) => {
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.addRow(headers);
    rows.forEach((row) => worksheet.addRow(row.map(normalizeExcelCell)));
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length }
    };
    worksheet.getRow(1).font = { bold: true };
    worksheet.columns = headers.map((header) => ({
      width: Math.min(36, Math.max(12, String(header).length + 2))
    }));
  });

  metadataSheet.getRow(1).font = { bold: true };
  metadataSheet.columns = [{ width: 24 }, { width: 64 }];
  return workbook.xlsx.writeBuffer();
};

const downloadDataset = (dataset) => async (req, res) => {
  const organizationId = req.user.organizationId;
  const format = req.query?.format || "xlsx";
  if (!["csv", "xlsx"].includes(format)) {
    return res.status(400).json({ message: "Unsupported export format. Choose csv or xlsx." });
  }

  try {
    const organizationFilter = { organizationId };
    let definition;
    let relatedDefinition;
    if (dataset === "products") {
      const { category = "", name = "", sortBy = "name", sortOrder = "asc" } = req.query || {};
      if (
        typeof category !== "string" ||
        (category && !isValidObjectId(category)) ||
        typeof name !== "string" ||
        name.length > 100 ||
        !["name", "price", "quantity", "category", "totalValue", "createdAt"].includes(sortBy) ||
        !["asc", "desc"].includes(sortOrder)
      ) {
        return res.status(400).json({ message: "Invalid product export filters" });
      }
      const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      const canViewCost = String(req.user.role || "").toLowerCase() === "admin" ||
        permissions.some((permission) => ["products.create", "products.update"].includes(permission));
      const productFilter = {
        ...organizationFilter,
        ...(category && { category }),
        ...(name.trim() && { name: { $regex: escapeRegex(name.trim()), $options: "i" } })
      };
      let query = Product.find(productFilter)
        .populate("category", "name")
        .populate("createdBy", "name")
        .sort({ name: 1, _id: 1 });
      if (canViewCost) query = query.select("+cost");
      const products = sortRecords(await query.lean(), sortBy, sortOrder, (product, field) => ({
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        category: product.category?.name,
        totalValue: Number(product.price || 0) * Number(product.quantity || 0),
        createdAt: product.createdAt
      })[field]);
      definition = {
        filename: "products",
        sheetName: "Products",
        headers: [
          "id", "name", "categoryId", "categoryName", "quantity", "unitPriceINR",
          ...(canViewCost ? ["unitCostINR"] : []),
          "inventoryValueINR", "stockStatus", "image", "createdBy"
        ],
        rows: products.map((product) => [
          product._id,
          product.name,
          product.category?._id,
          product.category?.name,
          product.quantity,
          product.price,
          ...(canViewCost ? [product.cost] : []),
          Number(product.price || 0) * Number(product.quantity || 0),
          product.quantity === 0 ? "Out of stock" : product.quantity <= 5 ? "Low stock" : "In stock",
          product.image,
          product.createdBy?.name
        ])
      };
    } else if (dataset === "sales") {
      const {
        search = "",
        startDate = "",
        endDate = "",
        sortBy = "createdAt",
        sortOrder = "desc"
      } = req.query || {};
      const { range, error } = parseDateRange({ startDate, endDate });
      if (
        error ||
        typeof search !== "string" ||
        search.length > 100 ||
        !["createdAt", "totalCents", "paidCents", "quantity", "paymentMethod", "soldBy"].includes(sortBy) ||
        !["asc", "desc"].includes(sortOrder)
      ) {
        return res.status(400).json({ message: error || "Invalid sales export filters" });
      }
      const salesFilter = {
        ...organizationFilter,
        status: { $ne: "cancelled" },
        customerId: { $exists: false },
        ...(Object.keys(range).length && { createdAt: range }),
        ...(search.trim() && {
          $or: [
            { "items.productName": { $regex: escapeRegex(search.trim()), $options: "i" } },
            ...(isValidObjectId(search.trim()) ? [{ _id: search.trim() }] : [])
          ]
        })
      };
      let sales = await Sale.find(salesFilter)
        .populate("createdBy", "name")
        .populate("cancelledBy", "name")
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      sales = sortRecords(sales, sortBy, sortOrder, (sale, field) => ({
        createdAt: sale.createdAt,
        totalCents: sale.totalCents,
        paidCents: sale.paidCents,
        quantity: (sale.items || []).reduce((total, item) => total + Number(item.quantity || 0), 0),
        paymentMethod: sale.paymentMethod,
        soldBy: sale.createdBy?.name
      })[field]);
      definition = {
        filename: "sales",
        sheetName: "Sales",
        headers: [
          "saleId", "saleDate", "saleStatus", "customerId", "customerName", "productId",
          "productName", "quantity", "unitPriceINR", "lineTotalINR", "saleTotalINR",
          "paidINR", "balanceINR", "paymentMethod", "verification", "soldBy",
          "cancelledBy", "cancelledAt", "createdAt", "updatedAt"
        ],
        rows: sales.flatMap((sale) => (sale.items || []).map((item, index) => [
          sale._id,
          sale.createdAt,
          sale.status,
          sale.customerId,
          sale.customerName,
          item.productId,
          item.productName,
          item.quantity,
          Number(item.unitPriceCents || 0) / 100,
          Number(item.lineTotalCents || 0) / 100,
          index === 0 ? Number(sale.totalCents || 0) / 100 : "",
          index === 0 ? Number(sale.paidCents || 0) / 100 : "",
          index === 0
            ? Number(sale.totalCents || 0) / 100 - Number(sale.paidCents || 0) / 100
            : "",
          sale.paymentMethod,
          sale.verification,
          sale.createdBy?.name,
          sale.cancelledBy?.name,
          sale.cancelledAt,
          sale.createdAt,
          sale.updatedAt
        ]))
      };
    } else if (dataset === "stock-history") {
      const {
        productId = "",
        type = "",
        search = "",
        startDate = "",
        endDate = "",
        sortBy = "createdAt",
        sortOrder = "desc"
      } = req.query || {};
      const { range, error } = parseDateRange({ startDate, endDate });
      if (
        error ||
        (productId && !isValidObjectId(productId)) ||
        (type && !["in", "out"].includes(type)) ||
        typeof search !== "string" ||
        search.length > 100 ||
        !["createdAt", "product", "type", "quantity", "createdBy"].includes(sortBy) ||
        !["asc", "desc"].includes(sortOrder)
      ) {
        return res.status(400).json({ message: error || "Invalid stock history export filters" });
      }
      const stockFilter = {
        ...organizationFilter,
        ...(productId && { productId }),
        ...(type && { type }),
        ...(Object.keys(range).length && { createdAt: range })
      };
      if (search.trim()) {
        const matchingProductIds = await Product.distinct("_id", {
          ...organizationFilter,
          name: { $regex: escapeRegex(search.trim()), $options: "i" }
        });
        stockFilter.productId = productId
          ? matchingProductIds.some((id) => String(id) === productId) ? productId : { $in: [] }
          : { $in: matchingProductIds };
      }
      let history = await StockHistory.find(stockFilter)
        .populate("productId", "name")
        .populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      history = sortRecords(history, sortBy, sortOrder, (entry, field) => ({
        createdAt: entry.createdAt,
        product: entry.productId?.name,
        type: entry.type,
        quantity: entry.quantity,
        createdBy: entry.createdBy?.name
      })[field]);
      definition = {
        filename: "stock-history",
        sheetName: "Stock history",
        headers: ["id", "productId", "productName", "type", "quantity", "sourceType", "sourceId", "recordedBy", "createdAt", "updatedAt"],
        rows: history.map((entry) => [
          entry._id,
          entry.productId?._id || entry.productId,
          entry.productId?.name,
          entry.type,
          entry.quantity,
          entry.sourceType,
          entry.sourceId,
          entry.createdBy?.name,
          entry.createdAt,
          entry.updatedAt
        ])
      };
    } else if (dataset === "customers") {
      const {
        search = "",
        status = "",
        startDate = "",
        endDate = "",
        sortBy = "name",
        sortOrder = "asc"
      } = req.query || {};
      const { range, error } = parseDateRange({ startDate, endDate });
      const customerSortFields = {
        name: "name",
        phone: "phone",
        totalUdhaar: "totalUdhaar",
        totalPaid: "totalPaid",
        pendingAmount: "pendingAmount",
        lastTransaction: "lastTransaction",
        status: "status"
      };
      if (
        error ||
        typeof search !== "string" ||
        search.length > 100 ||
        (status && !["pending", "partial", "paid", "active"].includes(status)) ||
        !Object.hasOwn(customerSortFields, sortBy) ||
        !["asc", "desc"].includes(sortOrder)
      ) {
        return res.status(400).json({ message: error || "Invalid customer export filters" });
      }
      const customerMatch = {
        organizationId: new mongoose.Types.ObjectId(organizationId),
        archivedAt: null,
        ...(search.trim() && {
          $or: [
            { name: { $regex: escapeRegex(search.trim()), $options: "i" } },
            { phone: { $regex: escapeRegex(search.trim()), $options: "i" } }
          ]
        })
      };
      const customerPipeline = [
        { $match: customerMatch },
        {
          $lookup: {
            from: Udhaar.collection.name,
            let: { customerRef: "$_id", organizationRef: "$organizationId" },
            pipeline: [
              { $match: { $expr: { $and: [
                { $eq: ["$customerId", "$$customerRef"] },
                { $eq: ["$organizationId", "$$organizationRef"] },
                { $eq: ["$status", "active"] }
              ] } } },
              { $group: {
                _id: null,
                totalUdhaarCents: { $sum: "$totalCents" },
                totalPaidCents: { $sum: "$paidCents" },
                recordCount: { $sum: 1 },
                lastUdhaarAt: { $max: "$createdAt" }
              } }
            ],
            as: "summary"
          }
        },
        {
          $lookup: {
            from: Payment.collection.name,
            let: { customerRef: "$_id", organizationRef: "$organizationId" },
            pipeline: [
              { $match: { $expr: { $and: [
                { $eq: ["$customerId", "$$customerRef"] },
                { $eq: ["$organizationId", "$$organizationRef"] },
                { $eq: [{ $type: "$udhaarId" }, "objectId"] }
              ] } } },
              { $sort: { createdAt: -1, _id: -1 } },
              { $limit: 1 },
              { $project: { createdAt: 1 } }
            ],
            as: "latestPayment"
          }
        },
        {
          $set: {
            summary: { $ifNull: [
              { $arrayElemAt: ["$summary", 0] },
              { totalUdhaarCents: 0, totalPaidCents: 0, recordCount: 0, lastUdhaarAt: null }
            ] }
          }
        },
        {
          $set: {
            totalUdhaar: { $divide: ["$summary.totalUdhaarCents", 100] },
            totalPaid: { $divide: ["$summary.totalPaidCents", 100] },
            pendingAmount: { $divide: [
              { $subtract: ["$summary.totalUdhaarCents", "$summary.totalPaidCents"] },
              100
            ] },
            activeUdhaarCount: "$summary.recordCount",
            lastTransaction: {
              $cond: [
                { $gt: [{ $arrayElemAt: ["$latestPayment.createdAt", 0] }, "$summary.lastUdhaarAt"] },
                { $arrayElemAt: ["$latestPayment.createdAt", 0] },
                "$summary.lastUdhaarAt"
              ]
            },
            status: {
              $cond: [
                { $gt: [{ $subtract: ["$summary.totalUdhaarCents", "$summary.totalPaidCents"] }, 0] },
                { $cond: [{ $gt: ["$summary.totalPaidCents", 0] }, "partial", "pending"] },
                { $cond: [{ $gt: ["$summary.recordCount", 0] }, "paid", "none"] }
              ]
            }
          }
        },
        ...(status === "pending" ? [{ $match: { status: "pending" } }] : []),
        ...(status === "partial" ? [{ $match: { status: "partial" } }] : []),
        ...(status === "paid" ? [{ $match: { pendingAmount: { $lte: 0 } } }] : []),
        ...(status === "active" ? [{ $match: { activeUdhaarCount: { $gt: 0 } } }] : []),
        ...(Object.keys(range).length ? [{ $match: { lastTransaction: range } }] : []),
        { $sort: { [customerSortFields[sortBy]]: sortOrder === "asc" ? 1 : -1, _id: 1 } },
        {
          $lookup: {
            from: User.collection.name,
            localField: "createdBy",
            foreignField: "_id",
            pipeline: [
              { $match: { organizationId: new mongoose.Types.ObjectId(organizationId) } },
              { $project: { name: 1 } }
            ],
            as: "creator"
          }
        },
        {
          $set: {
            createdByName: { $ifNull: [{ $arrayElemAt: ["$creator.name", 0] }, ""] }
          }
        }
      ];
      const customers = await Customer.aggregate(customerPipeline);
      definition = {
        filename: "customers",
        sheetName: "Customers",
        headers: [
          "id", "name", "phone", "totalUdhaarINR", "totalPaidINR",
          "pendingAmountINR", "status", "activeUdhaarCount", "lastTransaction",
          "createdBy", "createdAt", "updatedAt"
        ],
        rows: customers.map((customer) => [
          customer._id,
          customer.name,
          customer.phone,
          customer.totalUdhaar,
          customer.totalPaid,
          customer.pendingAmount,
          customer.status,
          customer.activeUdhaarCount,
          customer.lastTransaction,
          customer.createdByName,
          customer.createdAt,
          customer.updatedAt
        ])
      };
    } else if (dataset === "udhaar") {
      const {
        status = "",
        paymentStatus = "",
        sortBy = "createdAt",
        sortOrder = "desc"
      } = req.query || {};
      const udhaarSortFields = {
        createdAt: (record) => record.createdAt,
        customer: (record) => record.customerId?.name,
        totalCents: (record) => record.totalCents,
        paidCents: (record) => record.paidCents,
        pendingCents: (record) => record.totalCents - record.paidCents,
        status: (record) => record.status === "cancelled" ? "cancelled" : record.paymentStatus,
        createdBy: (record) => record.createdBy?.name
      };
      if (
        (status && !["active", "cancelled"].includes(status)) ||
        (paymentStatus && !["pending", "partial", "paid"].includes(paymentStatus)) ||
        !Object.hasOwn(udhaarSortFields, sortBy) ||
        !["asc", "desc"].includes(sortOrder)
      ) {
        return res.status(400).json({ message: "Invalid Udhaar export filters" });
      }
      const records = sortRecords(await Udhaar.find({
        ...organizationFilter,
        ...(status && { status }),
        ...(paymentStatus && { paymentStatus })
      })
        .populate("customerId", "name phone")
        .populate("createdBy", "name")
        .populate("cancelledBy", "name")
        .sort({ createdAt: -1, _id: -1 })
        .lean(), sortBy, sortOrder, (record, field) => udhaarSortFields[field](record));
      const canViewPayments = String(req.user.role || "").toLowerCase() === "admin" ||
        req.user.permissions?.includes("payments.history") ||
        req.user.permissions?.includes("udhaar.payment-history");
      const paymentRecords = canViewPayments && records.length
        ? await Payment.find({
          ...organizationFilter,
          udhaarId: { $in: records.map((record) => record._id) }
        })
          .populate("customerId", "name phone")
          .populate("createdBy", "name")
          .populate("manuallyVerifiedBy", "name")
          .sort({ createdAt: 1, _id: 1 })
          .lean()
        : [];
      const udhaarRows = records.flatMap((record) => {
        const items = record.items?.length ? record.items : [null];
        return items.map((item, index) => [
          record._id,
          record.customerId?._id || record.customerId,
          record.customerId?.name,
          record.customerId?.phone,
          record.status,
          record.paymentStatus,
          index === 0 ? Number(record.totalCents || 0) / 100 : "",
          index === 0 ? Number(record.paidCents || 0) / 100 : "",
          index === 0
            ? (Number(record.totalCents || 0) - Number(record.paidCents || 0)) / 100
            : "",
          item?.productId,
          item?.productName,
          item?.quantity,
          Number(item?.unitPriceCents || 0) / 100,
          Number(item?.lineTotalCents || 0) / 100,
          record.paymentMethod,
          record.createdBy?.name,
          record.cancelledBy?.name,
          record.cancelledAt,
          record.createdAt,
          record.updatedAt
        ]);
      });
      definition = {
        filename: "udhaar",
        sheetName: "Udhaar",
        headers: [
          "udhaarId", "customerId", "customerName", "customerPhone", "recordStatus",
          "paymentStatus", "totalAmountINR", "paidAmountINR", "outstandingINR",
          "productId", "productName", "quantity", "unitPriceINR", "lineTotalINR",
          "paymentMethod", "recordedBy", "cancelledBy", "cancelledAt", "createdAt", "updatedAt"
        ],
        rows: udhaarRows
      };
      if (canViewPayments) {
        relatedDefinition = {
          filename: "udhaar-payments",
          sheetName: "Udhaar payments",
          headers: [
            "paymentId", "udhaarId", "customerId", "customerName", "amountINR",
            "method", "note", "verification", "verifiedBy", "recordedBy", "createdAt"
          ],
          rows: paymentRecords.map((payment) => [
            payment._id,
            payment.udhaarId,
            payment.customerId?._id || payment.customerId,
            payment.customerId?.name,
            Number(payment.amountCents || 0) / 100,
            payment.method,
            payment.note,
            payment.verification,
            payment.manuallyVerifiedBy?.name,
            payment.createdBy?.name,
            payment.createdAt
          ])
        };
      }
    } else {
      return res.status(404).json({ message: "Unknown export dataset" });
    }

    const organization = await Organization.findById(organizationId).select("name").lean();
    const datasets = [definition, ...(relatedDefinition ? [relatedDefinition] : [])];
    const metadata = {
      organization: organization || {},
      storeSettings: {},
      exportedAt: new Date().toISOString(),
      recordCounts: Object.fromEntries(datasets.map(({ sheetName, rows }) => [sheetName, rows.length]))
    };
    res.setHeader("Cache-Control", "no-store");
    if (format === "csv") {
      if (dataset === "udhaar") {
        const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
        archive.on("error", (error) => {
          console.error(`Udhaar archive failed (${error.name || "Error"})`);
          if (res.headersSent) res.destroy(error);
          else handleControllerError(res, error, "Failed to create Udhaar export archive");
        });
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", 'attachment; filename="mystockhub-udhaar.zip"');
        archive.pipe(res);
        archive.append(JSON.stringify(metadata, null, 2), { name: "udhaar_meta.json" });
        datasets.forEach(({ filename, headers, rows }) => {
          archive.append(createCsv(headers, rows), { name: `${filename}.csv` });
        });
        await archive.finalize();
        return;
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="mystockhub-${definition.filename}.csv"`);
      return res.send(createCsv(definition.headers, definition.rows));
    }

    const workbookBuffer = await createExcelWorkbook(metadata, datasets);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="mystockhub-${definition.filename}.xlsx"`);
    return res.end(workbookBuffer);
  } catch (error) {
    console.error(`Organization ${dataset} export failed (${error.name || "Error"}): ${error.message}`);
    return handleControllerError(res, error, `Failed to export ${dataset}`);
  }
};

const downloadReports = async (req, res) => {
  const organizationId = req.user.organizationId;
  const format = req.query?.format || "xlsx";
  if (!["csv", "xlsx"].includes(format)) {
    return res.status(400).json({ message: "Unsupported report format. Choose csv or xlsx." });
  }

  const { category = "", type = "", startDate = "", endDate = "" } = req.query || {};
  if (
    typeof category !== "string" ||
    (category && !isValidObjectId(category)) ||
    typeof type !== "string" ||
    (type && !["in", "out"].includes(type)) ||
    typeof startDate !== "string" ||
    (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) ||
    typeof endDate !== "string" ||
    (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) ||
    (startDate && endDate && startDate > endDate)
  ) {
    return res.status(400).json({ message: "Invalid report filters" });
  }
  const dateValueIsValid = (value) => {
    if (!value) return true;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!dateValueIsValid(startDate) || !dateValueIsValid(endDate)) {
    return res.status(400).json({ message: "Invalid report dates" });
  }

  const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
  const isAdmin = String(req.user.role || "").toLowerCase() === "admin";
  const allowed = (scope) => isAdmin || permissions.includes(`reports.${scope}`);
  const datasets = [];
  const organizationFilter = { organizationId };
  const dateFilter = {};
  if (startDate) dateFilter.$gte = new Date(`${startDate}T00:00:00.000Z`);
  if (endDate) dateFilter.$lte = new Date(`${endDate}T23:59:59.999Z`);

  try {
    if (allowed("products")) {
      const canViewCost = isAdmin || permissions.some((permission) => (
        ["products.create", "products.update"].includes(permission)
      ));
      let productQuery = Product.find({
        ...organizationFilter,
        ...(category && { category })
      }).populate("category", "name").populate("createdBy", "name").sort({ name: 1, _id: 1 });
      if (canViewCost) productQuery = productQuery.select("+cost");
      const products = await productQuery.lean();
      datasets.push({
        filename: "products.csv",
        sheetName: "Products",
        headers: [
          "id", "name", "categoryId", "category", "quantity", "unitPriceINR",
          ...(canViewCost ? ["unitCostINR"] : []), "inventoryValueINR", "stockStatus", "image", "createdBy"
        ],
        rows: products.map((product) => [
          product._id,
          product.name,
          product.category?._id,
          product.category?.name || "Uncategorized",
          product.quantity,
          product.price,
          ...(canViewCost ? [product.cost] : []),
          Number(product.price || 0) * Number(product.quantity || 0),
          product.quantity === 0 ? "Out of stock" : product.quantity <= 5 ? "Low stock" : "In stock",
          product.image,
          product.createdBy?.name
        ])
      });
    }

    if (allowed("stock")) {
      const stockFilter = {
        ...organizationFilter,
        ...(type && { type }),
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter })
      };
      if (category) {
        const categoryProducts = await Product.find({ ...organizationFilter, category }).select("_id").lean();
        stockFilter.productId = { $in: categoryProducts.map((product) => product._id) };
      }
      const historyQuery = StockHistory.find(stockFilter)
        .populate("productId", "name")
        .populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 });
      const history = await historyQuery.lean();
      datasets.push({
        filename: "stock_activity.csv",
        sheetName: "Stock activity",
        headers: ["id", "productId", "productName", "type", "quantity", "sourceType", "sourceId", "recordedBy", "createdAt", "updatedAt"],
        rows: history.map((entry) => [
          entry._id,
          entry.productId?._id || entry.productId,
          entry.productId?.name,
          entry.type,
          entry.quantity,
          entry.sourceType,
          entry.sourceId,
          entry.createdBy?.name,
          entry.createdAt,
          entry.updatedAt
        ])
      });
    }

    if (allowed("sales")) {
      const sales = await Sale.find({
        ...organizationFilter,
        status: { $ne: "cancelled" },
        customerId: { $exists: false },
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter })
      })
        .populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      datasets.push({
        filename: "sales.csv",
        sheetName: "Sales",
        headers: [
          "saleId", "saleDate", "customerId", "customerName", "productId", "productName",
          "quantity", "unitPriceINR", "lineTotalINR", "saleTotalINR", "paidINR",
          "balanceINR", "paymentMethod", "verification", "soldBy", "createdAt", "updatedAt"
        ],
        rows: sales.flatMap((sale) => (sale.items || []).map((item, index) => [
          sale._id,
          sale.createdAt,
          sale.customerId,
          sale.customerName,
          item.productId,
          item.productName,
          item.quantity,
          Number(item.unitPriceCents || 0) / 100,
          Number(item.lineTotalCents || 0) / 100,
          index === 0 ? Number(sale.totalCents || 0) / 100 : "",
          index === 0 ? Number(sale.paidCents || 0) / 100 : "",
          index === 0
            ? (Number(sale.totalCents || 0) - Number(sale.paidCents || 0)) / 100
            : "",
          sale.paymentMethod,
          sale.verification,
          sale.createdBy?.name,
          sale.createdAt,
          sale.updatedAt
        ]))
      });
    }

    if (allowed("udhaar")) {
      const records = await Udhaar.find({
        ...organizationFilter,
        status: "active",
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter })
      }).populate("customerId", "name phone").populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 }).lean();
      const recordRows = records.flatMap((record) => {
        const items = record.items?.length ? record.items : [null];
        return items.map((item, index) => [
          record._id,
          record.customerId?._id || record.customerId,
          record.customerId?.name,
          record.customerId?.phone,
          record.paymentStatus,
          index === 0 ? Number(record.totalCents || 0) / 100 : "",
          index === 0 ? Number(record.paidCents || 0) / 100 : "",
          index === 0
            ? (Number(record.totalCents || 0) - Number(record.paidCents || 0)) / 100
            : "",
          item?.productId,
          item?.productName,
          item?.quantity,
          Number(item?.unitPriceCents || 0) / 100,
          Number(item?.lineTotalCents || 0) / 100,
          record.paymentMethod,
          record.createdBy?.name,
          record.createdAt,
          record.updatedAt
        ]);
      });
      datasets.push({
        filename: "udhaar.csv",
        sheetName: "Udhaar",
        headers: [
          "udhaarId", "customerId", "customerName", "customerPhone", "paymentStatus",
          "totalAmountINR", "paidAmountINR", "outstandingINR", "productId", "productName",
          "quantity", "unitPriceINR", "lineTotalINR", "paymentMethod", "recordedBy",
          "createdAt", "updatedAt"
        ],
        rows: recordRows
      });
    }

    if (!datasets.length) {
      return res.status(403).json({ message: "A report permission is required to export reports" });
    }
    const organization = await Organization.findById(organizationId).select("name").lean();
    const metadata = {
      organization: organization || {},
      storeSettings: {},
      exportedAt: new Date().toISOString(),
      reportFilters: { category, type, startDate, endDate },
      recordCounts: Object.fromEntries(datasets.map(({ sheetName, rows }) => [sheetName, rows.length]))
    };
    res.setHeader("Cache-Control", "no-store");

    if (format === "xlsx") {
      const workbookBuffer = await createExcelWorkbook(metadata, datasets);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="mystockhub-reports.xlsx"');
      return res.end(workbookBuffer);
    }

    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (error) => {
      console.error(`Report archive failed (${error.name || "Error"})`);
      if (res.headersSent) res.destroy(error);
      else handleControllerError(res, error, "Failed to create reports archive");
    });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="mystockhub-reports-csv.zip"');
    archive.pipe(res);
    archive.append(JSON.stringify(metadata, null, 2), { name: "report_meta.json" });
    datasets.forEach(({ filename, headers, rows }) => {
      archive.append(createCsv(headers, rows), { name: filename });
    });
    await archive.finalize();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    console.error(`Report export failed (${error.name || "Error"}): ${error.message}`);
    return handleControllerError(res, error, "Failed to export reports");
  }
};

const downloadFullBackup = async (req, res) => {
  const organizationId = req.user.organizationId;
  const format = req.query?.format || "csv";
  if (!["csv", "xlsx"].includes(format)) {
    return res.status(400).json({ message: "Unsupported backup format. Choose csv or xlsx." });
  }

  try {
    const organization = await Organization.findById(organizationId).lean();
    if (!organization) return res.status(404).json({ message: "Organization not found" });

    const organizationFilter = { organizationId };
    const [
      categories,
      products,
      sales,
      stockHistory,
      customers,
      udhaar,
      payments,
      notifications,
      members
    ] = await Promise.all([
      Category.find(organizationFilter).sort({ createdAt: 1, _id: 1 }).lean(),
      Product.find(organizationFilter).select("+cost").populate("category", "name").sort({ name: 1, _id: 1 }).lean(),
      Sale.find(organizationFilter).sort({ createdAt: 1, _id: 1 }).lean(),
      StockHistory.find(organizationFilter).sort({ createdAt: 1, _id: 1 }).lean(),
      Customer.find(organizationFilter).sort({ createdAt: 1, _id: 1 }).lean(),
      Udhaar.find(organizationFilter).sort({ createdAt: 1, _id: 1 }).lean(),
      Payment.find(organizationFilter).sort({ createdAt: 1, _id: 1 }).lean(),
      Notification.find(organizationFilter).sort({ createdAt: 1, _id: 1 }).lean(),
      User.find(organizationFilter)
        .select("_id name email role permissions profileImage mustChangePassword emailVerified twoFactorEnabled isActive legalAcceptedAt legalPolicyVersion createdAt updatedAt")
        .sort({ createdAt: 1, _id: 1 })
        .lean()
    ]);

    const saleRows = sales.flatMap((sale) => (
      (sale.items || []).map((item) => [
        sale._id,
        sale.createdAt,
        sale.updatedAt,
        sale.status,
        sale.customerId,
        sale.customerName,
        item.productId,
        item.productName,
        item.quantity,
        item.unitPriceCents,
        item.lineTotalCents,
        sale.totalCents,
        sale.paidCents,
        sale.paymentMethod,
        sale.verification,
        sale.createdBy
      ])
    ));

    const metadata = {
      organization,
      storeSettings: organization.settings || {},
      exportedAt: new Date().toISOString(),
      recordCounts: {
        categories: categories.length,
        products: products.length,
        sales: sales.length,
        stockHistory: stockHistory.length,
        customers: customers.length,
        udhaar: udhaar.length,
        payments: payments.length,
        notifications: notifications.length,
        members: members.length
      }
    };
    const datasets = [
      {
        filename: "categories.csv",
        sheetName: "Categories",
        headers: ["id", "name", "createdAt", "updatedAt"],
        rows: createRows(categories, ["_id", "name", "createdAt", "updatedAt"])
      },
      {
        filename: "inventory.csv",
        sheetName: "Inventory",
        headers: ["id", "name", "categoryId", "categoryName", "quantity", "unitPrice", "unitCost", "inventoryValue", "image", "createdAt"],
        rows: products.map((product) => [
          product._id,
          product.name,
          product.category?._id,
          product.category?.name,
          product.quantity,
          product.price,
          product.cost,
          Number(product.price || 0) * Number(product.quantity || 0),
          product.image,
          product.createdAt
        ])
      },
      {
        filename: "sales_history.csv",
        sheetName: "Sales history",
        headers: ["saleId", "createdAt", "updatedAt", "status", "customerId", "customerName", "productId", "productName", "quantity", "unitPriceCents", "lineTotalCents", "totalCents", "paidCents", "paymentMethod", "verification", "createdBy"],
        rows: saleRows
      },
      {
        filename: "stock_history.csv",
        sheetName: "Stock history",
        headers: ["id", "productId", "type", "quantity", "sourceType", "sourceId", "createdBy", "createdAt"],
        rows: createRows(stockHistory, ["_id", "productId", "type", "quantity", "sourceType", "sourceId", "createdBy", "createdAt"])
      },
      {
        filename: "udhaar.csv",
        sheetName: "Udhaar",
        headers: ["id", "customerId", "totalCents", "paidCents", "paymentStatus", "status", "paymentMethod", "items", "createdBy", "createdAt"],
        rows: createRows(udhaar, ["_id", "customerId", "totalCents", "paidCents", "paymentStatus", "status", "paymentMethod", "items", "createdBy", "createdAt"])
      },
      {
        filename: "payments.csv",
        sheetName: "Payments",
        headers: ["id", "saleId", "udhaarId", "customerId", "amountCents", "method", "note", "verification", "manuallyVerifiedBy", "createdBy", "createdAt"],
        rows: createRows(payments, ["_id", "saleId", "udhaarId", "customerId", "amountCents", "method", "note", "verification", "manuallyVerifiedBy", "createdBy", "createdAt"])
      },
      {
        filename: "customers.csv",
        sheetName: "Customers",
        headers: ["id", "name", "phone", "archivedAt", "createdBy", "createdAt", "updatedAt"],
        rows: createRows(customers, ["_id", "name", "phone", "archivedAt", "createdBy", "createdAt", "updatedAt"])
      },
      {
        filename: "notifications.csv",
        sheetName: "Notifications",
        headers: ["id", "type", "title", "message", "entityType", "entityId", "readBy", "createdBy", "createdAt"],
        rows: createRows(notifications, ["_id", "type", "title", "message", "entityType", "entityId", "readBy", "createdBy", "createdAt"])
      },
      {
        filename: "organization_members.csv",
        sheetName: "Members",
        headers: ["id", "name", "email", "role", "permissions", "profileImage", "mustChangePassword", "emailVerified", "twoFactorEnabled", "isActive", "legalAcceptedAt", "legalPolicyVersion", "createdAt", "updatedAt"],
        rows: createRows(members, ["_id", "name", "email", "role", "permissions", "profileImage", "mustChangePassword", "emailVerified", "twoFactorEnabled", "isActive", "legalAcceptedAt", "legalPolicyVersion", "createdAt", "updatedAt"])
      }
    ];

    res.status(200);
    res.setHeader("Cache-Control", "no-store");
    if (format === "xlsx") {
      const workbookBuffer = await createExcelWorkbook(metadata, datasets);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="mystockhub-full-backup.xlsx"');
      return res.end(workbookBuffer);
    }

    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (error) => {
      console.error(`Full backup archive failed (${error.name || "Error"})`);
      if (res.headersSent) res.destroy(error);
      else handleControllerError(res, error, "Failed to create full organization backup");
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="mystockhub-full-backup.zip"');
    archive.pipe(res);
    archive.append(JSON.stringify(metadata, null, 2), { name: "organization_meta.json" });
    datasets.forEach(({ filename, headers, rows }) => {
      archive.append(createCsv(headers, rows), { name: filename });
    });
    await archive.finalize();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    console.error(`Full organization backup failed (${error.name || "Error"}): ${error.message}`);
    return handleControllerError(res, error, "Failed to create full organization backup");
  }
};

module.exports = { downloadFullBackup, downloadDataset, downloadReports, createCsv, createExcelWorkbook };
