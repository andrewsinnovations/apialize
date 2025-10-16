const { express, apializeContext, ensureFn, asyncHandler } = require("./utils");
const Sequelize = require("sequelize");
const { Op } = Sequelize;

// Default configuration for list operation
const LIST_DEFAULTS = {
  middleware: [],
  allowFiltering: true, // allow non "api:" query params to become where filters
  allowOrdering: true, // allow api:orderby / api:orderdir query params
  allowMultiColumnFiltering: true, // allow api:filterfields + api:filter for OR text match across columns
  metaShowFilters: false, // include applied filters in meta.filters
  metaShowOrdering: false, // include applied ordering in meta.order
  defaultPageSize: 100, // default page size when not specified in query or model config
  defaultOrderBy: "id", // default column to order by when no ordering is specified
  defaultOrderDir: "ASC", // default order direction when no ordering is specified
};

// Helper function to get model attributes with their data types
function getModelAttributes(model) {
  if (!model || !model.rawAttributes) return {};
  return model.rawAttributes;
}

// Helper function to validate if a column exists on the model
function validateColumnExists(model, columnName) {
  const attributes = getModelAttributes(model);
  return attributes.hasOwnProperty(columnName);
}

// Helper function to validate data type compatibility
function validateDataType(model, columnName, value) {
  const attributes = getModelAttributes(model);
  const attribute = attributes[columnName];
  
  if (!attribute || !attribute.type) return true; // Allow if no type info
  
  const dataType = attribute.type;
  const typeName = dataType.constructor.name.toLowerCase();
  
  try {
    switch (typeName) {
      case 'integer':
      case 'bigint':
        return !isNaN(parseInt(value, 10));
      case 'float':
      case 'real':
      case 'double':
      case 'decimal':
        return !isNaN(parseFloat(value));
      case 'boolean':
        return ['true', 'false', '1', '0', 'yes', 'no'].includes(String(value).toLowerCase());
      case 'date':
      case 'dateonly':
        return !isNaN(Date.parse(value));
      case 'string':
      case 'text':
      case 'char':
      case 'varchar':
        return true; // Strings are always valid
      default:
        return true; // Allow unknown types
    }
  } catch (err) {
    return true; // Allow if validation fails
  }
}

// Handle pagination logic
function setupPagination(req, query, modelCfg, defaultPageSize) {
  let page = parseInt(query["api:page"], 10);
  if (isNaN(page) || page < 1) page = 1;
  
  const effectivePageSize =
    Number.isInteger(modelCfg.page_size) && modelCfg.page_size > 0
      ? modelCfg.page_size
      : defaultPageSize;
  
  let pageSize = parseInt(query["api:pagesize"], 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = effectivePageSize;
  
  req.apialize.options.limit = pageSize;
  req.apialize.options.offset = (page - 1) * pageSize;
  
  return { page, pageSize };
}

// Handle ordering logic
function setupOrdering(req, res, model, query, modelCfg, allowOrdering, defaultOrderBy, defaultOrderDir, idMapping) {
  let rawOrderBy, globalDir;
  
  if (allowOrdering) {
    // Use query params first, then model config as fallback
    rawOrderBy = query["api:orderby"] || modelCfg.orderby;
    globalDir = (query["api:orderdir"] || modelCfg.orderdir || "ASC").toString().toUpperCase();
  } else {
    // When ordering is disabled, still use model config but ignore query params
    rawOrderBy = modelCfg.orderby;
    globalDir = (modelCfg.orderdir || "ASC").toString().toUpperCase();
  }

  if (rawOrderBy) {
    const fields = rawOrderBy
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const order = [];
    
    for (const f of fields) {
      if (!f) continue;
      
      let columnName;
      let direction;
      if (f.startsWith("-")) {
        columnName = f.slice(1);
        direction = "DESC";
      } else if (f.startsWith("+")) {
        columnName = f.slice(1);
        direction = "ASC";
      } else {
        columnName = f;
        direction = globalDir === "DESC" ? "DESC" : "ASC";
      }
      
      // Validate column exists on model
      if (!validateColumnExists(model, columnName)) {
        console.warn(`[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`);
        res.status(400).json({
          success: false,
          error: "Bad request",
        });
        return false; // Indicate validation failed
      }
      
      order.push([columnName, direction]);
    }
    if (order.length) req.apialize.options.order = order;
  }
  
  // Default ordering if none specified
  if (!req.apialize.options.order) {
    const effectiveDefaultOrderBy = defaultOrderBy === 'id' && idMapping ? idMapping : defaultOrderBy;
    req.apialize.options.order = [[effectiveDefaultOrderBy, defaultOrderDir]];
  }
  
  return true; // Indicate success
}

// Handle filtering logic
function setupFiltering(req, res, model, query, allowFiltering) {
  let appliedFilters = {};
  
  if (!allowFiltering) return appliedFilters;
  
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith("api:")) continue;
    if (value === undefined) continue;
    
    // Validate column exists on model
    if (!validateColumnExists(model, key)) {
      console.warn(`[Apialize] Bad request: Invalid filter column '${key}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`);
      res.status(400).json({
        success: false,
        error: "Bad request",
      });
      return false; // Indicate validation failed
    }
    
    // Validate data type compatibility
    if (!validateDataType(model, key, value)) {
      console.warn(`[Apialize] Bad request: Invalid filter value '${value}' is not compatible with column '${key}' data type on model '${model.name}'. Query: ${req.originalUrl}`);
      res.status(400).json({
        success: false,
        error: "Bad request",
      });
      return false; // Indicate validation failed
    }
    
    appliedFilters[key] = value;
  }
  
  if (Object.keys(appliedFilters).length) {
    req.apialize.options.where = {
      ...(req.apialize.options.where || {}),
      ...appliedFilters,
    };
  }
  
  return appliedFilters;
}

// Handle multi-column text search filtering using api:filterfields and api:filter
function setupMultiColumnFilter(req, res, model, query, allowMultiColumnFiltering) {
  if (!allowMultiColumnFiltering) return true; // nothing to do

  const rawFields = (query["api:filterfields"] || "").toString().trim();
  const rawValue = (query["api:filter"] || "").toString();

  if (!rawFields) return true; // no fields specified
  if (!rawValue) return true; // empty value means no additional filtering

  const fields = rawFields
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!fields.length) return true;

  // Validate fields exist and are string-like
  for (const f of fields) {
    if (!validateColumnExists(model, f)) {
      console.warn(
        `[Apialize] Bad request: Invalid filter field '${f}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`,
      );
      res.status(400).json({ success: false, error: "Bad request" });
      return false;
    }
    const attr = getModelAttributes(model)[f];
    const typeName = attr && attr.type ? attr.type.constructor.name.toLowerCase() : "";
    const isStringLike = ["string", "text", "char", "varchar"].includes(typeName);
    if (!isStringLike) {
      console.warn(
        `[Apialize] Bad request: Filter field '${f}' is not a text column on model '${model.name}'. Query: ${req.originalUrl}`,
      );
      res.status(400).json({ success: false, error: "Bad request" });
      return false;
    }
  }

  const valueLower = rawValue.toLowerCase();
  const ors = fields.map((f) =>
    Sequelize.where(Sequelize.fn("LOWER", Sequelize.col(f)), { [Op.like]: `%${valueLower}%` }),
  );

  const existingWhere = req.apialize.options.where || {};
  if (Object.keys(existingWhere).length) {
    req.apialize.options.where = {
      [Op.and]: [existingWhere, { [Op.or]: ors }],
    };
  } else {
    req.apialize.options.where = { [Op.or]: ors };
  }

  return true;
}

// Process query results and build response
function buildResponse(result, page, pageSize, appliedFilters, metaShowFilters, metaShowOrdering, allowFiltering, req, idMapping) {
  const rows = Array.isArray(result.rows)
    ? result.rows.map((r) => (r && r.get ? r.get({ plain: true }) : r))
    : result.rows;
  // Normalize id according to idMapping if provided
  const normalizedRows = Array.isArray(rows)
    ? rows.map((row) => {
        if (!row || typeof row !== 'object') return row;
        if (idMapping && idMapping !== 'id' && Object.prototype.hasOwnProperty.call(row, idMapping)) {
          const next = { ...row, id: row[idMapping] };
          delete next[idMapping];
          return next;
        }
        return row;
      })
    : rows;
  const totalPages = Math.max(1, Math.ceil(result.count / pageSize));

  let orderOut;
  if (metaShowOrdering) {
    orderOut = Array.isArray(req.apialize.options.order)
      ? req.apialize.options.order.map((o) => {
          if (Array.isArray(o))
            return [o[0], (o[1] || "ASC").toUpperCase()];
          if (typeof o === "string") return [o, "ASC"];
          return o;
        })
      : [];
  }

  const meta = {
    page,
    page_size: pageSize,
    total_pages: totalPages,
    count: result.count,
  };
  
  if (metaShowOrdering) meta.order = orderOut;
  if (metaShowFilters) meta.filters = allowFiltering ? appliedFilters : {};

  return {
    success: true,
    meta,
    data: normalizedRows,
  };
}

// list(model, options, modelOptions)
// options.middleware: array of express middleware
// Configurable flags (all optional, see LIST_DEFAULTS above for defaults)
// modelOptions: passed directly to Sequelize findAndCountAll (attributes, include, etc.)
function list(model, options = {}, modelOptions = {}) {
  ensureFn(model, "findAndCountAll");
  const {
    middleware,
    allowFiltering,
    allowOrdering,
    allowMultiColumnFiltering,
    metaShowFilters,
    metaShowOrdering,
    defaultPageSize,
    defaultOrderBy,
    defaultOrderDir,
    id_mapping,
  } = { ...LIST_DEFAULTS, ...options };
  const idMapping = id_mapping || 'id';

  const inline = middleware.filter((fn) => typeof fn === "function");
  const router = express.Router({ mergeParams: true });

  router.get(
    "/",
    // Pre-middleware to disable query param filtering when allowFiltering is false
    (req, _res, next) => {
      if (!allowFiltering) req._apializeDisableQueryFilters = true;
      next();
    },
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const q = req.query || {};
      const modelCfg = (model && model.apialize) || {};

      // Merge base model options with request-specific options
      req.apialize.options = { ...modelOptions, ...req.apialize.options };

      // Setup pagination
      const { page, pageSize } = setupPagination(req, q, modelCfg, defaultPageSize);

      // Setup ordering (returns false if validation fails)
      const orderingValid = setupOrdering(
        req, res, model, q, modelCfg,
        allowOrdering, defaultOrderBy, defaultOrderDir, idMapping
      );
      if (!orderingValid) return; // Response already sent

      // Setup filtering (returns false if validation fails)
      const appliedFilters = setupFiltering(req, res, model, q, allowFiltering);
      if (appliedFilters === false) return; // Response already sent

      // Setup multi-column text filtering (returns false if validation fails)
      const multiOk = setupMultiColumnFilter(
        req,
        res,
        model,
        q,
        allowMultiColumnFiltering,
      );
      if (!multiOk) return; // Response already sent

      // Execute query
      const result = await model.findAndCountAll(req.apialize.options);

      // Build and send response
      const response = buildResponse(
        result, page, pageSize, appliedFilters,
        metaShowFilters, metaShowOrdering, allowFiltering, req, idMapping
      );
      
      res.json(response);
    }),
  );

  router.apialize = {};
  return router;
}

module.exports = list;
