const archiver = require("archiver");
const ExcelJS = require("exceljs");
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
    if (dataset === "products") {
      const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      const canViewCost = String(req.user.role || "").toLowerCase() === "admin" ||
        permissions.some((permission) => ["products.create", "products.update"].includes(permission));
      let query = Product.find(organizationFilter)
        .populate("category", "name")
        .sort({ name: 1, _id: 1 });
      if (canViewCost) query = query.select("+cost");
      const products = await query.lean();
      definition = {
        filename: "products",
        sheetName: "Products",
        headers: [
          "id", "name", "categoryId", "categoryName", "quantity", "unitPrice",
          ...(canViewCost ? ["unitCost"] : []),
          "inventoryValue", "image", "createdAt", "updatedAt"
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
          product.image,
          product.createdAt,
          product.updatedAt
        ])
      };
    } else if (dataset === "sales") {
      const sales = await Sale.find({
        ...organizationFilter,
        status: { $ne: "cancelled" },
        customerId: { $exists: false }
      })
        .populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      definition = {
        filename: "sales",
        sheetName: "Sales",
        headers: [
          "saleId", "createdAt", "status", "customerId", "customerName", "productId",
          "productName", "quantity", "unitPriceCents", "lineTotalCents", "totalCents",
          "paidCents", "paymentMethod", "verification", "soldBy"
        ],
        rows: sales.flatMap((sale) => (sale.items || []).map((item) => [
          sale._id,
          sale.createdAt,
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
          sale.createdBy?.name
        ]))
      };
    } else if (dataset === "stock-history") {
      const history = await StockHistory.find(organizationFilter)
        .populate("productId", "name")
        .populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      definition = {
        filename: "stock-history",
        sheetName: "Stock history",
        headers: ["id", "productId", "productName", "type", "quantity", "sourceType", "sourceId", "recordedBy", "createdAt"],
        rows: history.map((entry) => [
          entry._id,
          entry.productId?._id || entry.productId,
          entry.productId?.name,
          entry.type,
          entry.quantity,
          entry.sourceType,
          entry.sourceId,
          entry.createdBy?.name,
          entry.createdAt
        ])
      };
    } else if (dataset === "customers") {
      const customers = await Customer.find(organizationFilter)
        .sort({ name: 1, _id: 1 })
        .lean();
      definition = {
        filename: "customers",
        sheetName: "Customers",
        headers: ["id", "name", "phone", "archivedAt", "createdBy", "createdAt", "updatedAt"],
        rows: createRows(customers, ["_id", "name", "phone", "archivedAt", "createdBy", "createdAt", "updatedAt"])
      };
    } else if (dataset === "udhaar") {
      const records = await Udhaar.find(organizationFilter)
        .populate("customerId", "name phone")
        .populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      definition = {
        filename: "udhaar",
        sheetName: "Udhaar",
        headers: ["id", "customerId", "customerName", "customerPhone", "items", "totalCents", "paidCents", "paymentStatus", "status", "paymentMethod", "recordedBy", "createdAt", "updatedAt"],
        rows: records.map((record) => [
          record._id,
          record.customerId?._id || record.customerId,
          record.customerId?.name,
          record.customerId?.phone,
          record.items,
          record.totalCents,
          record.paidCents,
          record.paymentStatus,
          record.status,
          record.paymentMethod,
          record.createdBy?.name,
          record.createdAt,
          record.updatedAt
        ])
      };
    } else {
      return res.status(404).json({ message: "Unknown export dataset" });
    }

    const organization = await Organization.findById(organizationId).select("name").lean();
    const metadata = {
      organization: organization || {},
      storeSettings: {},
      exportedAt: new Date().toISOString(),
      recordCounts: { [dataset]: definition.rows.length }
    };
    res.setHeader("Cache-Control", "no-store");
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="mystockhub-${definition.filename}.csv"`);
      return res.send(createCsv(definition.headers, definition.rows));
    }

    const workbookBuffer = await createExcelWorkbook(metadata, [definition]);
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
      }).populate("category", "name").sort({ name: 1, _id: 1 });
      if (canViewCost) productQuery = productQuery.select("+cost");
      const products = await productQuery.lean();
      datasets.push({
        filename: "products.csv",
        sheetName: "Products",
        headers: [
          "id", "name", "category", "quantity", "unitPrice",
          ...(canViewCost ? ["unitCost"] : []), "inventoryValue"
        ],
        rows: products.map((product) => [
          product._id,
          product.name,
          product.category?.name || "Uncategorized",
          product.quantity,
          product.price,
          ...(canViewCost ? [product.cost] : []),
          Number(product.price || 0) * Number(product.quantity || 0)
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
        headers: ["id", "productId", "productName", "type", "quantity", "recordedBy", "createdAt"],
        rows: history.map((entry) => [
          entry._id,
          entry.productId?._id || entry.productId,
          entry.productId?.name,
          entry.type,
          entry.quantity,
          entry.createdBy?.name,
          entry.createdAt
        ])
      });
    }

    if (allowed("sales")) {
      const sales = await Sale.find({
        ...organizationFilter,
        status: { $ne: "cancelled" },
        customerId: { $exists: false }
      }).populate("createdBy", "name").sort({ createdAt: -1, _id: -1 }).lean();
      datasets.push({
        filename: "sales.csv",
        sheetName: "Sales",
        headers: ["saleId", "createdAt", "product", "quantity", "unitPriceCents", "lineTotalCents", "totalCents", "paidCents", "paymentMethod", "soldBy"],
        rows: sales.flatMap((sale) => (sale.items || []).map((item) => [
          sale._id,
          sale.createdAt,
          item.productName,
          item.quantity,
          item.unitPriceCents,
          item.lineTotalCents,
          sale.totalCents,
          sale.paidCents,
          sale.paymentMethod,
          sale.createdBy?.name
        ]))
      });
    }

    if (allowed("udhaar")) {
      const records = await Udhaar.find({
        ...organizationFilter,
        status: "active"
      }).populate("customerId", "name phone").populate("createdBy", "name")
        .sort({ createdAt: -1, _id: -1 }).lean();
      datasets.push({
        filename: "udhaar.csv",
        sheetName: "Udhaar",
        headers: ["id", "customer", "customerPhone", "items", "totalCents", "paidCents", "paymentStatus", "recordedBy", "createdAt"],
        rows: records.map((record) => [
          record._id,
          record.customerId?.name,
          record.customerId?.phone,
          record.items,
          record.totalCents,
          record.paidCents,
          record.paymentStatus,
          record.createdBy?.name,
          record.createdAt
        ])
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
        .select("_id name email role permissions profileImage mustChangePassword emailVerified twoFactorEnabled isActive createdAt updatedAt")
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
        headers: ["id", "name", "email", "role", "permissions", "profileImage", "mustChangePassword", "emailVerified", "twoFactorEnabled", "isActive", "createdAt", "updatedAt"],
        rows: createRows(members, ["_id", "name", "email", "role", "permissions", "profileImage", "mustChangePassword", "emailVerified", "twoFactorEnabled", "isActive", "createdAt", "updatedAt"])
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
