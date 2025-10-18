const { express, apializeContext, ensureFn, asyncHandler } = require("./utils");
const Sequelize = require("sequelize");
const { withTransactionAndHooks, normalizeRows } = require("./operationUtils");
const { Op } = Sequelize;

// Default configuration for list operation
const LIST_DEFAULTS = {
  middleware: [],
  allowFiltering: true, // allow non "api:" query params to become where filters
  allowOrdering: true, // allow api:orderby / api:orderdir query params
  allowMultiColumnFiltering: true, // allow api:filterfields + api:filter for OR text match across columns
  filter_fields: [], // list of fields to apply case-insensitive contains when api:filter is provided
  metaShowFilters: false, // include applied filters in meta.filters
  metaShowOrdering: false, // include applied ordering in meta.order
  defaultPageSize: 100, // default page size when not specified in query or model config
  defaultOrderBy: "id", // default column to order by when no ordering is specified
  defaultOrderDir: "ASC", // default order direction when no ordering is specified
  // New: optional pre/post processing hooks for the list operation
  // pre(context): can mutate context and/or return a value; return value stored on context.preResult
  // post(context): can mutate context, including context.payload before response is sent
  pre: null,
  post: null,
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

// Resolve a dotted path like "Alias.field" (or deeper: "A.B.field") against includes
// Returns { foundModel, attribute, aliasPath } or null if not found
function resolveIncludedAttribute(rootModel, includes, dottedPath) {
  if (
    !dottedPath ||
    typeof dottedPath !== "string" ||
    !dottedPath.includes(".")
  )
    return null;
  if (!Array.isArray(includes) || !includes.length) return null;

  const parts = dottedPath.split(".");
  const attrName = parts.pop();
  let currIncludes = includes;
  let currModel = rootModel;
  const aliasChain = [];

  for (const alias of parts) {
    if (!Array.isArray(currIncludes)) return null;
    const match = currIncludes.find((inc) => inc && inc.as === alias);
    if (!match || !match.model) return null;
    aliasChain.push(alias);
    currModel = match.model;
    currIncludes = match.include || [];
  }

  const attrs = getModelAttributes(currModel);
  if (!attrs.hasOwnProperty(attrName)) return null;
  return {
    foundModel: currModel,
    attribute: attrs[attrName],
    aliasPath: `${aliasChain.join(".")}.${attrName}`,
  };
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
      case "integer":
      case "bigint":
        return !isNaN(parseInt(value, 10));
      case "float":
      case "real":
      case "double":
      case "decimal":
        return !isNaN(parseFloat(value));
      case "boolean":
        return ["true", "false", "1", "0", "yes", "no"].includes(
          String(value).toLowerCase(),
        );
      case "date":
      case "dateonly":
        return !isNaN(Date.parse(value));
      case "string":
      case "text":
      case "char":
      case "varchar":
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
function setupOrdering(
  req,
  res,
  model,
  query,
  modelCfg,
  allowOrdering,
  defaultOrderBy,
  defaultOrderDir,
  idMapping,
) {
  let rawOrderBy, globalDir;

  if (allowOrdering) {
    // Use query params first, then model config as fallback
    rawOrderBy = query["api:orderby"] || modelCfg.orderby;
    globalDir = (query["api:orderdir"] || modelCfg.orderdir || "ASC")
      .toString()
      .toUpperCase();
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
        console.warn(
          `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`,
        );
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
    const effectiveDefaultOrderBy =
      defaultOrderBy === "id" && idMapping ? idMapping : defaultOrderBy;
    req.apialize.options.order = [[effectiveDefaultOrderBy, defaultOrderDir]];
  }

  return true; // Indicate success
}

// Handle filtering logic
function setupFiltering(req, res, model, query, allowFiltering) {
  let appliedFilters = {};

  if (!allowFiltering) return appliedFilters;

  const includes =
    req.apialize.options && req.apialize.options.include
      ? req.apialize.options.include
      : [];

  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith("api:")) continue;
    if (value === undefined) continue;

    let targetModel = model;
    let outKey = key;
    let attribute;

    if (key.includes(".")) {
      const resolved = resolveIncludedAttribute(model, includes, key);
      if (!resolved) {
        console.warn(
          `[Apialize] Bad request: Invalid filter column '${key}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`,
        );
        res.status(400).json({ success: false, error: "Bad request" });
        return false;
      }
      targetModel = resolved.foundModel;
      attribute = resolved.attribute;
      outKey = `$${resolved.aliasPath}$`;
    } else {
      // Validate column exists on root model
      if (!validateColumnExists(model, key)) {
        console.warn(
          `[Apialize] Bad request: Invalid filter column '${key}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`,
        );
        res.status(400).json({ success: false, error: "Bad request" });
        return false; // Indicate validation failed
      }
      attribute = getModelAttributes(model)[key];
    }

    // Validate data type compatibility against the target model/attribute
    const okType =
      attribute && attribute.type
        ? validateDataType({ rawAttributes: { tmp: attribute } }, "tmp", value)
        : true;
    if (!okType) {
      console.warn(
        `[Apialize] Bad request: Invalid filter value '${value}' is not compatible with column '${key}' data type on model '${targetModel && targetModel.name ? targetModel.name : "Model"}'. Query: ${req.originalUrl}`,
      );
      res.status(400).json({ success: false, error: "Bad request" });
      return false; // Indicate validation failed
    }

    appliedFilters[outKey] = value;
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
function setupMultiColumnFilter(
  req,
  res,
  model,
  query,
  allowMultiColumnFiltering,
  configuredFields,
) {
  if (!allowMultiColumnFiltering) return true; // feature disabled

  const rawValue = (query["api:filter"] || "").toString();
  const fields = Array.isArray(configuredFields)
    ? configuredFields.filter(Boolean)
    : [];

  if (!fields.length) return true; // no configured fields -> nothing to apply
  if (!rawValue) return true; // empty value -> no additional filtering

  const includes =
    req.apialize.options && req.apialize.options.include
      ? req.apialize.options.include
      : [];
  const valueLower = rawValue.toLowerCase();
  const ors = [];
  for (const f of fields) {
    let colExpr = null;
    let attr;
    if (f.includes(".")) {
      const resolved = resolveIncludedAttribute(model, includes, f);
      if (!resolved) {
        console.warn(
          `[Apialize] Bad request: Invalid filter field '${f}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`,
        );
        res.status(400).json({ success: false, error: "Bad request" });
        return false;
      }
      attr = resolved.attribute;
      // For function wrapping (LOWER), reference the table alias column directly
      // e.g., Sequelize.col('Parent.parent_name') instead of using $...$ syntax
      colExpr = Sequelize.col(resolved.aliasPath);
    } else {
      if (!validateColumnExists(model, f)) {
        console.warn(
          `[Apialize] Bad request: Invalid filter field '${f}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`,
        );
        res.status(400).json({ success: false, error: "Bad request" });
        return false;
      }
      attr = getModelAttributes(model)[f];
      colExpr = Sequelize.col(f);
    }

    const typeName =
      attr && attr.type ? attr.type.constructor.name.toLowerCase() : "";
    const isStringLike = ["string", "text", "char", "varchar"].includes(
      typeName,
    );
    if (!isStringLike) {
      console.warn(
        `[Apialize] Bad request: Filter field '${f}' is not a text column on model '${model.name}'. Query: ${req.originalUrl}`,
      );
      res.status(400).json({ success: false, error: "Bad request" });
      return false;
    }

    ors.push(
      Sequelize.where(Sequelize.fn("LOWER", colExpr), {
        [Op.like]: `%${valueLower}%`,
      }),
    );
  }

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
function buildResponse(
  result,
  page,
  pageSize,
  appliedFilters,
  metaShowFilters,
  metaShowOrdering,
  allowFiltering,
  req,
  idMapping,
) {
  const rows = Array.isArray(result.rows)
    ? result.rows.map((r) => (r && r.get ? r.get({ plain: true }) : r))
    : result.rows;
  // Normalize id according to idMapping using shared utility
  const normalizedRows = normalizeRows(rows, idMapping);
  const totalPages = Math.max(1, Math.ceil(result.count / pageSize));

  let orderOut;
  if (metaShowOrdering) {
    orderOut = Array.isArray(req.apialize.options.order)
      ? req.apialize.options.order.map((o) => {
          if (Array.isArray(o)) return [o[0], (o[1] || "ASC").toUpperCase()];
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
    filter_fields,
    metaShowFilters,
    metaShowOrdering,
    defaultPageSize,
    defaultOrderBy,
    defaultOrderDir,
    id_mapping,
    pre,
    post,
  } = { ...LIST_DEFAULTS, ...options };
  const idMapping = id_mapping || "id";

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
      const { page, pageSize } = setupPagination(
        req,
        q,
        modelCfg,
        defaultPageSize,
      );

      // Setup ordering (returns false if validation fails)
      const orderingValid = setupOrdering(
        req,
        res,
        model,
        q,
        modelCfg,
        allowOrdering,
        defaultOrderBy,
        defaultOrderDir,
        idMapping,
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
        filter_fields && filter_fields.length
          ? filter_fields
          : modelCfg.filter_fields || [],
      );
      if (!multiOk) return; // Response already sent

      const payload = await withTransactionAndHooks(
        {
          model,
          options: { ...options, pre, post },
          req,
          res,
          modelOptions,
          idMapping,
          useReqOptionsTransaction: true,
        },
        async (context) => {
          const result = await model.findAndCountAll(req.apialize.options);
          const response = buildResponse(
            result,
            page,
            pageSize,
            appliedFilters,
            metaShowFilters,
            metaShowOrdering,
            allowFiltering,
            req,
            idMapping,
          );
          context.payload = response;
          return context.payload;
        },
      );
      if (!res.headersSent) {
        res.json(payload);
      }
    }),
  );

  router.apialize = {};
  return router;
}

module.exports = list;
