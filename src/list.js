const { express, apializeContext, ensureFn, asyncHandler } = require('./utils');
const Sequelize = require('sequelize');
const { withTransactionAndHooks, normalizeRows } = require('./operationUtils');
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
  defaultOrderBy: 'id', // default column to order by when no ordering is specified
  defaultOrderDir: 'ASC', // default order direction when no ordering is specified
  pre: null,
  post: null,
};

function getModelAttributes(model) {
  if (!model || !model.rawAttributes) return {};
  return model.rawAttributes;
}

function validateColumnExists(model, columnName) {
  const attributes = getModelAttributes(model);
  return Object.prototype.hasOwnProperty.call(attributes, columnName);
}

function resolveIncludedAttribute(rootModel, includes, dottedPath) {
  if (
    !dottedPath ||
    typeof dottedPath !== 'string' ||
    !dottedPath.includes('.')
  )
    return null;
  if (!Array.isArray(includes) || !includes.length) return null;

  const parts = dottedPath.split('.');
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
    aliasPath: `${aliasChain.join('.')}.${attrName}`,
  };
}

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
        return ['true', 'false', '1', '0', 'yes', 'no'].includes(
          String(value).toLowerCase()
        );
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

function setupPagination(req, query, modelCfg, defaultPageSize) {
  let page = parseInt(query['api:page'], 10);
  if (isNaN(page) || page < 1) page = 1;

  const effectivePageSize =
    Number.isInteger(modelCfg.page_size) && modelCfg.page_size > 0
      ? modelCfg.page_size
      : defaultPageSize;

  let pageSize = parseInt(query['api:pagesize'], 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = effectivePageSize;

  req.apialize.options.limit = pageSize;
  req.apialize.options.offset = (page - 1) * pageSize;

  return { page, pageSize };
}

function setupOrdering(
  req,
  res,
  model,
  query,
  modelCfg,
  allowOrdering,
  defaultOrderBy,
  defaultOrderDir,
  idMapping
) {
  let rawOrderBy, globalDir;

  if (allowOrdering) {
    rawOrderBy = query['api:orderby'] || modelCfg.orderby;
    globalDir = (query['api:orderdir'] || modelCfg.orderdir || 'ASC')
      .toString()
      .toUpperCase();
  } else {
    rawOrderBy = modelCfg.orderby;
    globalDir = (modelCfg.orderdir || 'ASC').toString().toUpperCase();
  }

  if (rawOrderBy) {
    const splitFields = rawOrderBy.split(',');
    const fields = [];
    for (let i = 0; i < splitFields.length; i++) {
      const trimmed =
        splitFields[i] != null ? String(splitFields[i]).trim() : '';
      if (trimmed) fields.push(trimmed);
    }

    const order = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f) continue;

      let columnName;
      let direction;
      if (f.charAt(0) === '-') {
        columnName = f.slice(1);
        direction = 'DESC';
      } else if (f.charAt(0) === '+') {
        columnName = f.slice(1);
        direction = 'ASC';
      } else {
        columnName = f;
        direction = globalDir === 'DESC' ? 'DESC' : 'ASC';
      }

      // Validate column exists on model
      if (!validateColumnExists(model, columnName)) {
        console.warn(
          `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`
        );
        res.status(400).json({
          success: false,
          error: 'Bad request',
        });
        return false; // Indicate validation failed
      }

      order.push([columnName, direction]);
    }
    if (order.length) req.apialize.options.order = order;
  }

  if (!req.apialize.options.order) {
    const effectiveDefaultOrderBy =
      defaultOrderBy === 'id' && idMapping ? idMapping : defaultOrderBy;
    req.apialize.options.order = [[effectiveDefaultOrderBy, defaultOrderDir]];
  }

  return true; // Indicate success
}

function setupFiltering(req, res, model, query, allowFiltering) {
  let appliedFilters = {};

  if (!allowFiltering) return appliedFilters;

  const includes =
    req.apialize.options && req.apialize.options.include
      ? req.apialize.options.include
      : [];

  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('api:')) continue;
    if (value === undefined) continue;

    let targetModel = model;
    let outKey = key;
    let attribute;

    if (key.includes('.')) {
      const resolved = resolveIncludedAttribute(model, includes, key);
      if (!resolved) {
        console.warn(
          `[Apialize] Bad request: Invalid filter column '${key}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`
        );
        res.status(400).json({ success: false, error: 'Bad request' });
        return false;
      }
      targetModel = resolved.foundModel;
      attribute = resolved.attribute;
      outKey = `$${resolved.aliasPath}$`;
    } else {
      if (!validateColumnExists(model, key)) {
        console.warn(
          `[Apialize] Bad request: Invalid filter column '${key}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`
        );
        res.status(400).json({ success: false, error: 'Bad request' });
        return false; // Indicate validation failed
      }
      attribute = getModelAttributes(model)[key];
    }

    const okType =
      attribute && attribute.type
        ? validateDataType({ rawAttributes: { tmp: attribute } }, 'tmp', value)
        : true;
    if (!okType) {
      console.warn(
        `[Apialize] Bad request: Invalid filter value '${value}' is not compatible with column '${key}' data type on model '${targetModel && targetModel.name ? targetModel.name : 'Model'}'. Query: ${req.originalUrl}`
      );
      res.status(400).json({ success: false, error: 'Bad request' });
      return false; // Indicate validation failed
    }

    appliedFilters[outKey] = value;
  }

  if (Object.keys(appliedFilters).length) {
    const existingWhere = req.apialize.options.where || {};
    const mergedWhere = Object.assign({}, existingWhere);
    const appliedKeys = Object.keys(appliedFilters);
    for (let i = 0; i < appliedKeys.length; i++) {
      const k = appliedKeys[i];
      mergedWhere[k] = appliedFilters[k];
    }
    req.apialize.options.where = mergedWhere;
  }

  return appliedFilters;
}

function setupMultiColumnFilter(
  req,
  res,
  model,
  query,
  allowMultiColumnFiltering,
  configuredFields
) {
  if (!allowMultiColumnFiltering) return true; // feature disabled

  const rawValue = (query['api:filter'] || '').toString();
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
    if (f.includes('.')) {
      const resolved = resolveIncludedAttribute(model, includes, f);
      if (!resolved) {
        console.warn(
          `[Apialize] Bad request: Invalid filter field '${f}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`
        );
        res.status(400).json({ success: false, error: 'Bad request' });
        return false;
      }
      attr = resolved.attribute;
      colExpr = Sequelize.col(resolved.aliasPath);
    } else {
      if (!validateColumnExists(model, f)) {
        console.warn(
          `[Apialize] Bad request: Invalid filter field '${f}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`
        );
        res.status(400).json({ success: false, error: 'Bad request' });
        return false;
      }
      attr = getModelAttributes(model)[f];
      colExpr = Sequelize.col(f);
    }

    const typeName =
      attr && attr.type ? attr.type.constructor.name.toLowerCase() : '';
    const isStringLike = ['string', 'text', 'char', 'varchar'].includes(
      typeName
    );
    if (!isStringLike) {
      console.warn(
        `[Apialize] Bad request: Filter field '${f}' is not a text column on model '${model.name}'. Query: ${req.originalUrl}`
      );
      res.status(400).json({ success: false, error: 'Bad request' });
      return false;
    }

    ors.push(
      Sequelize.where(Sequelize.fn('LOWER', colExpr), {
        [Op.like]: `%${valueLower}%`,
      })
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

function buildResponse(
  result,
  page,
  pageSize,
  appliedFilters,
  metaShowFilters,
  metaShowOrdering,
  allowFiltering,
  req,
  idMapping
) {
  let rows;
  if (Array.isArray(result.rows)) {
    rows = [];
    for (let i = 0; i < result.rows.length; i++) {
      const r = result.rows[i];
      if (r && typeof r.get === 'function') {
        rows.push(r.get({ plain: true }));
      } else {
        rows.push(r);
      }
    }
  } else {
    rows = result.rows;
  }
  const normalizedRows = normalizeRows(rows, idMapping);
  const totalPages = Math.max(1, Math.ceil(result.count / pageSize));

  let orderOut;
  if (metaShowOrdering) {
    if (Array.isArray(req.apialize.options.order)) {
      orderOut = [];
      for (let i = 0; i < req.apialize.options.order.length; i++) {
        const o = req.apialize.options.order[i];
        if (Array.isArray(o)) {
          const dir = (o[1] || 'ASC').toString().toUpperCase();
          orderOut.push([o[0], dir]);
        } else if (typeof o === 'string') {
          orderOut.push([o, 'ASC']);
        } else {
          orderOut.push(o);
        }
      }
    } else {
      orderOut = [];
    }
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

function list(model, options = {}, modelOptions = {}) {
  ensureFn(model, 'findAndCountAll');
  const mergedOptions = Object.assign({}, LIST_DEFAULTS, options);
  const middleware = mergedOptions.middleware;
  const allowFiltering = mergedOptions.allowFiltering;
  const allowOrdering = mergedOptions.allowOrdering;
  const allowMultiColumnFiltering = mergedOptions.allowMultiColumnFiltering;
  const filter_fields = mergedOptions.filter_fields;
  const metaShowFilters = mergedOptions.metaShowFilters;
  const metaShowOrdering = mergedOptions.metaShowOrdering;
  const defaultPageSize = mergedOptions.defaultPageSize;
  const defaultOrderBy = mergedOptions.defaultOrderBy;
  const defaultOrderDir = mergedOptions.defaultOrderDir;
  const id_mapping = mergedOptions.id_mapping;
  const pre = mergedOptions.pre;
  const post = mergedOptions.post;

  const idMapping = id_mapping || 'id';

  const inline = [];
  for (let i = 0; i < middleware.length; i++) {
    const fn = middleware[i];
    if (typeof fn === 'function') inline.push(fn);
  }
  const router = express.Router({ mergeParams: true });

  router.get(
    '/',
    (req, _res, next) => {
      if (!allowFiltering) req._apializeDisableQueryFilters = true;
      next();
    },
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const q = req.query || {};
      const modelCfg = (model && model.apialize) || {};

      const mergedReqOptions = Object.assign({}, modelOptions);
      if (req.apialize.options && typeof req.apialize.options === 'object') {
        const keys = Object.keys(req.apialize.options);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          mergedReqOptions[k] = req.apialize.options[k];
        }
      }
      req.apialize.options = mergedReqOptions;

      const { page, pageSize } = setupPagination(
        req,
        q,
        modelCfg,
        defaultPageSize
      );

      const orderingValid = setupOrdering(
        req,
        res,
        model,
        q,
        modelCfg,
        allowOrdering,
        defaultOrderBy,
        defaultOrderDir,
        idMapping
      );
      if (!orderingValid) return; // Response already sent

      const appliedFilters = setupFiltering(req, res, model, q, allowFiltering);
      if (appliedFilters === false) return; // Response already sent

      let multiFilterFields;
      if (Array.isArray(filter_fields) && filter_fields.length > 0) {
        multiFilterFields = filter_fields;
      } else if (
        modelCfg &&
        Array.isArray(modelCfg.filter_fields) &&
        modelCfg.filter_fields.length > 0
      ) {
        multiFilterFields = modelCfg.filter_fields;
      } else {
        multiFilterFields = [];
      }

      const multiOk = setupMultiColumnFilter(
        req,
        res,
        model,
        q,
        allowMultiColumnFiltering,
        multiFilterFields
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
            idMapping
          );
          context.payload = response;
          return context.payload;
        }
      );
      if (!res.headersSent) {
        res.json(payload);
      }
    })
  );

  router.apialize = {};
  return router;
}

module.exports = list;
