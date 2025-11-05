const { express, apializeContext, ensureFn, asyncHandler } = require('./utils');
const {
  withTransactionAndHooks,
  normalizeRows,
  normalizeRowsWithForeignKeys,
} = require('./operationUtils');
const {
  validateColumnExists,
  validateDataType,
  buildResponse,
  resolveIncludedAttribute,
  getModelAttributes,
} = require('./listUtils');

function getSequelizeOp(model) {
  // Prefer the Op from the model's Sequelize instance to avoid symbol mismatches
  const fromModel =
    model &&
    model.sequelize &&
    ((model.sequelize.constructor && model.sequelize.constructor.Op) ||
      (model.sequelize.Sequelize && model.sequelize.Sequelize.Op));
  if (fromModel) return fromModel;
  try {
    return require('sequelize').Op;
  } catch (_) {
    return {};
  }
}

// Defaults intentionally mirror list() where sensible so responses align
const SEARCH_DEFAULTS = {
  middleware: [],
  defaultPageSize: 100,
  defaultOrderBy: 'id',
  defaultOrderDir: 'ASC',
  metaShowOrdering: false, // keep parity with list option name
  pre: null,
  post: null,
  // id_mapping supported like other operations
  id_mapping: 'id',
  // relation_id_mapping allows mapping relation 'id' filters to custom fields
  relation_id_mapping: null,
  // configurable mount path for the POST route
  path: '/search',
};

// Convert a single key/value or { op: val } object to a Sequelize where fragment
function buildFieldPredicate(
  model,
  key,
  rawVal,
  Op,
  includes,
  relationIdMapping
) {
  const dialect =
    model &&
    model.sequelize &&
    typeof model.sequelize.getDialectx === 'function'
      ? model.sequelize.getDialect()
      : null;
  const CI = dialect === 'postgres' ? Op.iLike || Op.like : Op.like;
  const CInot = dialect === 'postgres' ? Op.notILike || Op.notLike : Op.notLike;

  // Support dotted path for included models using $alias.attr$ syntax
  let outKey = key;
  let validateModel = model;
  let validateColumn = key;
  let attribute;
  if (typeof key === 'string' && key.includes('.')) {
    const resolved = resolveIncludedAttribute(model, includes, key);
    if (!resolved) {
      return { error: `Invalid column '${key}'` };
    }

    // Apply relation_id_mapping if configured and the column is 'id'
    const parts = key.split('.');
    let actualColumn = parts[parts.length - 1];
    if (actualColumn === 'id' && Array.isArray(relationIdMapping)) {
      const relationMapping = relationIdMapping.find((mapping) => {
        // Compare models by name, tableName, or reference equality
        if (mapping.model === resolved.foundModel) return true;
        if (mapping.model && resolved.foundModel) {
          // Compare by model name
          if (mapping.model.name === resolved.foundModel.name) return true;
          // Compare by table name as fallback
          if (mapping.model.tableName === resolved.foundModel.tableName)
            return true;
        }
        return false;
      });
      if (relationMapping && relationMapping.id_field) {
        actualColumn = relationMapping.id_field;
        // Update the alias path to use the mapped field
        const aliasPrefix = resolved.aliasPath
          .split('.')
          .slice(0, -1)
          .join('.');
        const newAliasPath = aliasPrefix
          ? `${aliasPrefix}.${actualColumn}`
          : actualColumn;
        outKey = `$${newAliasPath}$`;
        // Update validation column for the mapped field
        validateColumn = actualColumn;
        const attrs = getModelAttributes(resolved.foundModel);
        attribute = attrs && attrs[actualColumn];
      } else {
        outKey = `$${resolved.aliasPath}$`;
        validateColumn = actualColumn;
        attribute = resolved.attribute;
      }
    } else {
      outKey = `$${resolved.aliasPath}$`;
      validateColumn = actualColumn;
      attribute = resolved.attribute;
    }
    validateModel = resolved.foundModel;
  } else {
    const attrs = getModelAttributes(validateModel);
    attribute = attrs && attrs[validateColumn];
  }

  // If the value is an object, map known operators
  if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
    if (!validateColumnExists(validateModel, validateColumn))
      return { error: `Invalid column '${key}'` };
    const out = {};
    const ops = {};
    const map = {
      // equality and inequality with common synonyms
      eq: Op.eq,
      '=': Op.eq,
      ieq: CI,
      neq: Op.ne,
      '!=': Op.ne,
      // comparisons and synonyms
      gt: Op.gt,
      '>': Op.gt,
      gte: Op.gte,
      '>=': Op.gte,
      lt: Op.lt,
      '<': Op.lt,
      lte: Op.lte,
      '<=': Op.lte,
      in: Op.in,
      not_in: Op.notIn,
      contains: Op.like,
      icontains: CI,
      not_contains: Op.notLike,
      not_icontains: CInot,
      starts_with: Op.like,
      ends_with: Op.like,
      not_starts_with: Op.notLike,
      not_ends_with: Op.notLike,
      is_true: Op.eq,
      is_false: Op.eq,
    };
    for (const k of Object.keys(rawVal)) {
      const v = rawVal[k];
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (k === 'contains' || k === 'not_contains') ops[map[k]] = `%${v}%`;
      else if (k === 'icontains' || k === 'not_icontains')
        ops[map[k]] = `%${v}%`;
      else if (k === 'starts_with' || k === 'not_starts_with')
        ops[map[k]] = `${v}%`;
      else if (k === 'ends_with' || k === 'not_ends_with')
        ops[map[k]] = `%${v}`;
      else if (k === 'is_true') ops[map[k]] = true;
      else if (k === 'is_false') ops[map[k]] = false;
      else ops[map[k]] = v;
    }
    if (Reflect.ownKeys(ops).length === 0) return {};
    if (!Array.isArray(rawVal.in) && rawVal.in !== undefined) {
      if (
        !validateDataType(
          validateModel,
          validateColumn,
          (rawVal && rawVal.in && rawVal.in[0]) || rawVal.in
        )
      ) {
        return { error: `Invalid value for '${key}'` };
      }
    }
    out[outKey] = ops;
    return out;
  }

  // Equality fallback (case-insensitive for strings)
  if (!validateColumnExists(validateModel, validateColumn))
    return { error: `Invalid column '${key}'` };
  if (!validateDataType(validateModel, validateColumn, rawVal))
    return { error: `Invalid value for '${key}'` };
  const typeName =
    attribute && attribute.type && attribute.type.constructor
      ? String(attribute.type.constructor.name).toLowerCase()
      : null;
  if (typeName && ['string', 'text', 'char', 'varchar'].includes(typeName)) {
    return { [outKey]: { [CI]: rawVal } };
  }
  return { [outKey]: rawVal };
}

function buildWhere(model, filters, Op, includes, relationIdMapping) {
  if (!filters || typeof filters !== 'object') return {};

  // Explicit boolean arrays
  if (Array.isArray(filters.and)) {
    const parts = [];
    for (const item of filters.and) {
      const sub = buildWhere(model, item, Op, includes, relationIdMapping);
      if (sub && Object.keys(sub).length) parts.push(sub);
    }
    // Flatten AND into a single object when possible to avoid relying on Op.and
    const merged = {};
    const orClauses = [];
    for (const p of parts) {
      if (p[Op.or]) {
        // collect OR arrays
        const arr = Array.isArray(p[Op.or]) ? p[Op.or] : [p[Op.or]];
        orClauses.push(...arr);
        const { [Op.or]: _omit, ...rest } = p;
        for (const k of Object.keys(rest)) {
          if (
            merged[k] &&
            typeof merged[k] === 'object' &&
            typeof rest[k] === 'object'
          ) {
            merged[k] = Object.assign({}, merged[k], rest[k]);
          } else {
            merged[k] = rest[k];
          }
        }
      } else {
        for (const k of Object.keys(p)) {
          if (
            merged[k] &&
            typeof merged[k] === 'object' &&
            typeof p[k] === 'object'
          ) {
            merged[k] = Object.assign({}, merged[k], p[k]);
          } else {
            merged[k] = p[k];
          }
        }
      }
    }
    if (orClauses.length) merged[Op.or] = orClauses;
    return merged;
  }
  if (Array.isArray(filters.or)) {
    const parts = [];
    for (const item of filters.or) {
      const sub = buildWhere(model, item, Op, includes, relationIdMapping);
      if (sub && Object.keys(sub).length) parts.push(sub);
    }
    return parts.length ? { [Op.or]: parts } : {};
  }

  // Implicit AND across object keys
  const keys = Object.keys(filters);
  const andParts = [];
  for (const k of keys) {
    if (k === 'and' || k === 'or') continue; // handled above if present (non-array forms ignored)
    const v = filters[k];
    if (k === 'and' && Array.isArray(v)) continue;
    if (k === 'or' && Array.isArray(v)) continue;
    const pred = buildFieldPredicate(
      model,
      k,
      v,
      Op,
      includes,
      relationIdMapping
    );
    if (pred && pred.error) return { __error: pred.error };
    if (pred && Object.keys(pred).length) andParts.push(pred);
  }
  if (andParts.length === 0) return {};
  if (andParts.length === 1) return andParts[0];
  // Merge multiple field predicates into one object (deep merge per-field)
  const merged = {};
  for (const p of andParts) {
    for (const k of Object.keys(p)) {
      if (
        merged[k] &&
        typeof merged[k] === 'object' &&
        typeof p[k] === 'object'
      ) {
        merged[k] = Object.assign({}, merged[k], p[k]);
      } else {
        merged[k] = p[k];
      }
    }
  }
  return merged;
}

function buildOrdering(
  model,
  ordering,
  defaultOrderBy,
  defaultOrderDir,
  idMapping,
  includes,
  relationIdMapping
) {
  let items = ordering;
  if (!items) items = [];
  if (!Array.isArray(items)) items = [items];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const col = item.orderby || item.column || item.field;
    if (!col) continue;
    const dir =
      String(
        item.direction || item.dir || defaultOrderDir || 'ASC'
      ).toUpperCase() === 'DESC'
        ? 'DESC'
        : 'ASC';
    const colName = col === 'id' && idMapping ? idMapping : col;
    if (typeof colName === 'string' && colName.includes('.')) {
      const resolved = resolveIncludedAttribute(model, includes || [], colName);
      if (!resolved) {
        return { error: `Invalid order column '${colName}'` };
      }
      const parts = colName.split('.');
      let attr = parts[parts.length - 1];

      // Apply relation_id_mapping if configured and the attribute is 'id'
      if (attr === 'id' && Array.isArray(relationIdMapping)) {
        const relationMapping = relationIdMapping.find((mapping) => {
          // Compare models by name, tableName, or reference equality
          if (mapping.model === resolved.foundModel) return true;
          if (mapping.model && resolved.foundModel) {
            // Compare by model name
            if (mapping.model.name === resolved.foundModel.name) return true;
            // Compare by table name as fallback
            if (mapping.model.tableName === resolved.foundModel.tableName)
              return true;
          }
          return false;
        });
        if (relationMapping && relationMapping.id_field) {
          attr = relationMapping.id_field;
        }
      }

      const chain = Array.isArray(resolved.includeChain)
        ? resolved.includeChain.map((c) => ({ model: c.model, as: c.as }))
        : [
            {
              model: resolved.foundModel,
              as: parts.slice(0, -1).join('.') || parts[0],
            },
          ];
      out.push([...chain, attr, dir]);
    } else {
      if (!validateColumnExists(model, colName)) {
        return { error: `Invalid order column '${colName}'` };
      }
      out.push([colName, dir]);
    }
  }
  if (!out.length) {
    const eff =
      defaultOrderBy === 'id' && idMapping ? idMapping : defaultOrderBy;
    out.push([eff, defaultOrderDir || 'ASC']);
  }
  return out;
}

function search(model, options = {}, modelOptions = {}) {
  ensureFn(model, 'findAndCountAll');
  const merged = Object.assign({}, SEARCH_DEFAULTS, options || {});
  const middleware = Array.isArray(merged.middleware) ? merged.middleware : [];
  const defaultPageSize = merged.defaultPageSize;
  const defaultOrderBy = merged.defaultOrderBy;
  const defaultOrderDir = merged.defaultOrderDir;
  const metaShowOrdering = !!merged.metaShowOrdering;
  const idMapping = merged.id_mapping || 'id';
  const relationIdMapping = merged.relation_id_mapping;
  const pre = merged.pre;
  const post = merged.post;

  const inline = middleware.filter((fn) => typeof fn === 'function');
  const router = express.Router({ mergeParams: true });

  // ensure path starts with '/'
  const basePath =
    (typeof merged.path === 'string' && merged.path.trim()) || '/search';
  const mountPath = basePath.startsWith('/') ? basePath : `/${basePath}`;

  router.post(
    mountPath,
    // Disable query-string auto filters; search uses body exclusively
    (req, _res, next) => {
      req._apializeDisableQueryFilters = true;
      next();
    },
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const body = (req && req.body) || {};
      const filters = body.filters || {};
      const ordering = body.ordering || null;
      const paging = body.paging || {};

      // Start with modelOptions, then merge any req.apialize.options from middleware
      const mergedReqOptions = Object.assign({}, modelOptions);
      if (req.apialize.options && typeof req.apialize.options === 'object') {
        for (const k of Object.keys(req.apialize.options)) {
          mergedReqOptions[k] = req.apialize.options[k];
        }
      }
      req.apialize.options = mergedReqOptions;

      // Build where with Op from the model's Sequelize
      const Op = getSequelizeOp(model);

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
          // Paging (after pre-hooks so they can modify pagination)
          let page = parseInt(paging.page, 10);
          if (isNaN(page) || page < 1) page = 1;
          let pageSize = parseInt(paging.size ?? paging.page_size, 10);
          if (isNaN(pageSize) || pageSize < 1) pageSize = defaultPageSize;
          req.apialize.options.limit = pageSize;
          req.apialize.options.offset = (page - 1) * pageSize;

          // Get includes from current req.apialize.options and any model scope state
          // This runs after pre-hooks, ensuring we see any scoped includes applied in hooks
          let includes = req.apialize.options.include || [];

          // If model has scoped includes that aren't in req.apialize.options, merge them
          if (model && model._scope && model._scope.include) {
            const scopeIncludes = Array.isArray(model._scope.include)
              ? model._scope.include
              : [model._scope.include];
            includes = Array.isArray(includes)
              ? [...includes, ...scopeIncludes]
              : [...scopeIncludes, includes];
          }

          // Build where using current includes state (after pre-hooks have run)
          const whereTree = buildWhere(
            model,
            filters || {},
            Op,
            includes,
            relationIdMapping
          );
          if (whereTree && whereTree.__error) {
            if (process.env.NODE_ENV === 'development') {
              console.warn(
                `[Apialize] Search bad request: ${whereTree.__error}. Body:`,
                JSON.stringify(body, null, 2),
                `URL: ${req.originalUrl}`
              );
            }
            context.res
              .status(400)
              .json({ success: false, error: 'Bad request' });
            return;
          }
          // Use Reflect.ownKeys so we don't drop symbol-keyed operators like Op.or
          if (Reflect.ownKeys(whereTree).length) {
            req.apialize.options.where = Object.assign(
              {},
              req.apialize.options.where || {},
              whereTree
            );
          }

          // Build ordering (also use current includes state after pre-hooks)
          const orderArr = buildOrdering(
            model,
            ordering,
            defaultOrderBy,
            defaultOrderDir,
            idMapping,
            includes,
            relationIdMapping
          );
          if (orderArr && orderArr.error) {
            if (process.env.NODE_ENV === 'development') {
              console.warn(
                `[Apialize] Search bad request: ${orderArr.error}. Body:`,
                JSON.stringify(body, null, 2),
                `URL: ${req.originalUrl}`
              );
            }
            context.res
              .status(400)
              .json({ success: false, error: 'Bad request' });
            return;
          }
          req.apialize.options.order = orderArr;

          const result = await model.findAndCountAll(req.apialize.options);

          // Create a normalizer function that includes foreign key mapping
          const normalizeRowsFn = async (rows, idMappingParam) => {
            return await normalizeRowsWithForeignKeys(
              rows,
              idMappingParam,
              relationIdMapping,
              model
            );
          };

          const response = await buildResponse(
            result,
            page,
            pageSize,
            undefined,
            false,
            metaShowOrdering,
            false,
            req,
            idMapping,
            normalizeRowsFn
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

module.exports = search;
