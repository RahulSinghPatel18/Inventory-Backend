const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { Writable } = require("node:stream");
const ExcelJS = require("exceljs");
const {
  createCsv,
  createExcelWorkbook,
  downloadDataset,
  downloadReports,
  downloadFullBackup
} = require("../controllers/exportController");
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

const createResponse = () => {
  const chunks = [];
  const response = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  response.chunks = chunks;
  response.statusCode = 200;
  response.headers = {};
  response.status = function setStatus(statusCode) {
    this.statusCode = statusCode;
    return this;
  };
  response.setHeader = function setHeader(name, value) {
    this.headers[name] = value;
  };
  response.json = function json(body) {
    this.body = body;
    this.end(JSON.stringify(body));
    return this;
  };
  response.send = function send(body) {
    this.end(body);
    return this;
  };
  return response;
};

test("CSV output includes an Excel-friendly BOM and escapes delimiters and quotes", () => {
  const csv = createCsv(["name", "note"], [["Fresh, food", 'Owner said "keep"']]);

  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /"Fresh, food","Owner said ""keep"""/);
});

test("CSV output neutralizes spreadsheet formulas in user-provided text", () => {
  const csv = createCsv(["name"], [
    ["=HYPERLINK(\"https://example.com\")"],
    [" \t=1+1"]
  ]);

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  assert.match(csv, /"' \t=1\+1"/);
});

test("Excel backup is a workbook with data sheets and formula-safe string values", async () => {
  const buffer = await createExcelWorkbook({
    organization: { name: "Example Store" },
    storeSettings: { currency: "INR" },
    exportedAt: "2026-10-18T00:00:00.000Z",
    recordCounts: { products: 1 }
  }, [{
    sheetName: "Inventory",
    headers: ["name", "quantity"],
    rows: [["=HYPERLINK(\"https://example.com\")", 5]]
  }]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer));

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Organization", "Inventory"]);
  assert.equal(workbook.getWorksheet("Inventory").getCell("A2").value, "'=HYPERLINK(\"https://example.com\")");
  assert.equal(workbook.getWorksheet("Inventory").getCell("B2").value, 5);
  assert.equal(workbook.getWorksheet("Inventory").views[0].ySplit, 1);
});

test("full backup ZIP uses only organization-scoped records and contains the promised files", async () => {
  const organizationId = "507f1f77bcf86cd799439011";
  const models = [Category, Product, Sale, StockHistory, Customer, Udhaar, Payment, Notification, User];
  const previousMethods = models.map((model) => [model, model.find]);
  const originalFindById = Organization.findById;
  const filters = [];
  Organization.findById = () => ({
    lean: async () => ({
      _id: organizationId,
      name: "Example Store",
      settings: { currency: "INR" }
    })
  });
  for (const model of models) {
    model.find = (filter) => {
      filters.push(filter);
      return {
        populate() { return this; },
        sort() { return this; },
        select() { return this; },
        lean: async () => []
      };
    };
  }

  try {
    const response = createResponse();
    const finished = once(response, "finish");
    await downloadFullBackup({ user: { organizationId } }, response);
    await finished;

    const archive = Buffer.concat(response.chunks);
    const archiveDirectory = archive.toString("latin1");
    assert.deepEqual(filters, models.map(() => ({ organizationId })));
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "application/zip");
    for (const filename of ["inventory.csv", "sales_history.csv", "categories.csv", "organization_meta.json"]) {
      assert.ok(archiveDirectory.includes(filename), `archive should contain ${filename}`);
    }
    assert.equal(archive.readUInt32LE(0), 0x04034b50);

    const excelResponse = createResponse();
    const excelFinished = once(excelResponse, "finish");
    await downloadFullBackup({ user: { organizationId }, query: { format: "xlsx" } }, excelResponse);
    await excelFinished;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.concat(excelResponse.chunks));
    assert.equal(excelResponse.headers["Content-Type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(excelResponse.headers["Content-Disposition"], 'attachment; filename="mystockhub-full-backup.xlsx"');
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
      "Organization",
      "Categories",
      "Inventory",
      "Sales history",
      "Stock history",
      "Udhaar",
      "Payments",
      "Customers",
      "Notifications",
      "Members"
    ]);
    assert.deepEqual(filters, models.flatMap(() => [{ organizationId }, { organizationId }]));
  } finally {
    Organization.findById = originalFindById;
    for (const [model, originalFind] of previousMethods) model.find = originalFind;
  }
});

test("full backup rejects unsupported formats", async () => {
  const response = {
    statusCode: 200,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  await downloadFullBackup({ user: { organizationId: "org-id" }, query: { format: "pdf" } }, response);

  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /Unsupported backup format/);
});

test("product exports stay organization-scoped and hide cost from read-only members", async () => {
  const organizationId = "507f1f77bcf86cd799439011";
  const originalProductFind = Product.find;
  const originalOrganizationFindById = Organization.findById;
  const filters = [];
  let selectedCost = false;
  Product.find = (filter) => {
    filters.push(filter);
    return {
      populate() { return this; },
      sort() { return this; },
      select(value) {
        if (value === "+cost") selectedCost = true;
        return this;
      },
      lean: async () => [{
        _id: "product-id",
        name: "Sample",
        quantity: 3,
        price: 20,
        cost: 8,
        category: { _id: "category-id", name: "Food" },
        createdAt: new Date("2026-10-18T00:00:00.000Z")
      }]
    };
  };
  Organization.findById = () => ({
    select() {
      return { lean: async () => ({ name: "Example Store" }) };
    }
  });

  try {
    const response = createResponse();
    const finished = once(response, "finish");
    await downloadDataset("products")({
      user: { organizationId, role: "member", permissions: ["products.view"] },
      query: { format: "csv" }
    }, response);
    await finished;

    const csv = Buffer.concat(response.chunks).toString("utf8");
    assert.deepEqual(filters, [{ organizationId }]);
    assert.equal(selectedCost, false);
    assert.match(csv, /"unitPrice","inventoryValue"/);
    assert.doesNotMatch(csv, /unitCost/);
    assert.match(csv, /"Sample","category-id","Food","3","20"/);
    assert.equal(response.headers["Content-Disposition"], 'attachment; filename="mystockhub-products.csv"');
  } finally {
    Product.find = originalProductFind;
    Organization.findById = originalOrganizationFindById;
  }
});

test("report exports include only permission-scoped organization datasets and honor filters", async () => {
    const organizationId = "507f1f77bcf86cd799439011";
    const filters = {};
    const originalMethods = [
      [Product, Product.find],
      [StockHistory, StockHistory.find],
      [Sale, Sale.find],
      [Udhaar, Udhaar.find],
      [Organization, Organization.findById]
    ];
    const makeQuery = (result) => ({
      populate() { return this; },
      sort() { return this; },
      select() { return this; },
      lean: async () => result
    });

    Product.find = (filter) => {
      filters.products = filter;
      return makeQuery([{
        _id: "product-id",
        name: "Sample",
        quantity: 2,
        price: 10,
        category: { name: "Food" }
      }]);
    };
    StockHistory.find = (filter) => {
      filters.stock = filter;
      return makeQuery([{
        _id: "history-id",
        productId: { _id: "product-id", name: "Sample" },
        type: "in",
        quantity: 2,
        createdAt: new Date("2026-10-10T00:00:00.000Z")
      }]);
    };
    Sale.find = (filter) => {
      filters.sales = filter;
      return makeQuery([{
        _id: "sale-id",
        items: [{ productName: "Sample", quantity: 1 }],
        createdAt: new Date("2026-10-10T00:00:00.000Z")
      }]);
    };
    Udhaar.find = (filter) => {
      filters.udhaar = filter;
      return makeQuery([]);
    };
    Organization.findById = () => ({
      select() {
        return { lean: async () => ({ name: "Example Store" }) };
      }
    });

    try {
      const response = createResponse();
      const finished = once(response, "finish");
      await downloadReports({
        user: {
          organizationId,
          role: "user",
          permissions: ["reports.products", "reports.stock", "reports.sales"]
        },
        query: { format: "xlsx", startDate: "2026-10-01", endDate: "2026-10-31", type: "in" }
      }, response);
      await finished;

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.concat(response.chunks));
      assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
        "Organization",
        "Products",
        "Stock activity",
        "Sales"
      ]);
      assert.equal(filters.products.organizationId, organizationId);
      assert.deepEqual(filters.stock.organizationId, organizationId);
      assert.equal(filters.stock.type, "in");
      assert.equal(filters.stock.createdAt.$gte.toISOString(), "2026-10-01T00:00:00.000Z");
      assert.equal(filters.stock.createdAt.$lte.toISOString(), "2026-10-31T23:59:59.999Z");
      assert.equal(filters.sales.organizationId, organizationId);
      assert.equal(filters.sales.status.$ne, "cancelled");
      assert.equal(filters.udhaar, undefined);
      assert.equal(response.headers["Content-Disposition"], 'attachment; filename="mystockhub-reports.xlsx"');
    } finally {
      for (const [model, originalMethod] of originalMethods) {
        if (model === Organization) model.findById = originalMethod;
        else model.find = originalMethod;
      }
    }
  });

test("report exports reject invalid filters and unsupported formats", async () => {
    const response = {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };

    await downloadReports({
      user: { organizationId: "507f1f77bcf86cd799439011", permissions: [] },
      query: { format: "pdf" }
    }, response);
    assert.equal(response.statusCode, 400);

    const invalidDateResponse = {
      ...response,
      statusCode: 200,
      status: response.status,
      json: response.json
    };
    await downloadReports({
      user: { organizationId: "507f1f77bcf86cd799439011", permissions: [] },
      query: { format: "xlsx", startDate: "2026-02-31" }
    }, invalidDateResponse);
    assert.equal(invalidDateResponse.statusCode, 400);
  });

  test("report CSV download is a ZIP with only the member's permitted sheets", async () => {
    const organizationId = "507f1f77bcf86cd799439011";
    const originalSaleFind = Sale.find;
    const originalOrganizationFindById = Organization.findById;
    Sale.find = (filter) => {
      assert.deepEqual(filter, {
        organizationId,
        status: { $ne: "cancelled" },
        customerId: { $exists: false }
      });
      return {
        populate() { return this; },
        sort() { return this; },
        lean: async () => []
      };
    };
    Organization.findById = () => ({
      select() {
        return { lean: async () => ({ name: "Example Store" }) };
      }
    });

    try {
      const response = createResponse();
      const finished = once(response, "finish");
      await downloadReports({
        user: { organizationId, role: "user", permissions: ["reports.sales"] },
        query: { format: "csv" }
      }, response);
      await finished;

      const archive = Buffer.concat(response.chunks);
      const archiveListing = archive.toString("latin1");
      assert.equal(archive.readUInt32LE(0), 0x04034b50);
      assert.match(archiveListing, /sales\.csv/);
      assert.match(archiveListing, /report_meta\.json/);
      assert.doesNotMatch(archiveListing, /udhaar\.csv|stock_activity\.csv|products\.csv/);
      assert.equal(response.headers["Content-Type"], "application/zip");
    } finally {
      Sale.find = originalSaleFind;
      Organization.findById = originalOrganizationFindById;
    }
  });
