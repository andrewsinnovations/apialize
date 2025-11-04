const Sequelize = require('sequelize');

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
  const includeChain = [];

  for (const alias of parts) {
    if (!Array.isArray(currIncludes)) return null;
    const match = currIncludes.find((inc) => inc && inc.as === alias);
    if (!match || !match.model) return null;
    aliasChain.push(alias);
    currModel = match.model;
    currIncludes = match.include || [];
    includeChain.push({ model: match.model, as: alias });
  }

  const attrs = getModelAttributes(currModel);
  if (!Object.prototype.hasOwnProperty.call(attrs, attrName)) return null;
  return {
    foundModel: currModel,
    attribute: attrs[attrName],
    aliasPath: `${aliasChain.join('.')}.${attrName}`,
    aliasChain,
    includeChain,
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
  } catch (_err) {
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
  idMapping,
  relationIdMapping
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
    const includes =
      req.apialize.options && Array.isArray(req.apialize.options.include)
        ? req.apialize.options.include
        : [];
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

      // Support dotted-path for included attributes
      if (columnName.includes('.')) {
        const resolved = resolveIncludedAttribute(model, includes, columnName);
        if (!resolved) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`
            );
          }
          res.status(400).json({ success: false, error: 'Bad request' });
          return false;
        }
        const parts = columnName.split('.');
        let attr = parts[parts.length - 1];
        
        // Apply relation_id_mapping if configured and the attribute is 'id'
        if (attr === 'id' && Array.isArray(relationIdMapping)) {
          const relationMapping = relationIdMapping.find(mapping => 
            mapping.model === resolved.foundModel
          );
          if (relationMapping && relationMapping.id_field) {
            attr = relationMapping.id_field;
          }
        }
        
        const chain = Array.isArray(resolved.includeChain)
          ? resolved.includeChain.map((c) => ({ model: c.model, as: c.as }))
          : [{ model: resolved.foundModel, as: parts.slice(0, -1).join('.') || parts[0] }];
        order.push([...chain, attr, direction]);
      } else {
        // Validate column exists on root model
        if (!validateColumnExists(model, columnName)) {
          if (process.env.NODE_ENV === 'development') {
            console.warn(
              `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`
            );
          }
          res.status(400).json({ success: false, error: 'Bad request' });
          return false; // Indicate validation failed
        }
        order.push([columnName, direction]);
      }
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

function getSequelizeOp(model) {
  if (
    model &&
    model.sequelize &&
    ((model.sequelize.constructor && model.sequelize.constructor.Op) ||
      (model.sequelize.Sequelize && model.sequelize.Sequelize.Op))
  ) {
    return (
      (model.sequelize.constructor && model.sequelize.constructor.Op) ||
      (model.sequelize.Sequelize && model.sequelize.Sequelize.Op)
    );
  }
  try {
    return require('sequelize').Op;
  } catch (_) {
    return {};
  }
}

function setupFiltering(req, res, model, query, allowFiltering, relationIdMapping) {
  // appliedFiltersMeta is returned (for meta), dbFilters are merged into Sequelize where
  let appliedFiltersMeta = {};
  let appliedFiltersDb = {};

  if (!allowFiltering) return appliedFiltersMeta;

  const includes =
    req.apialize.options && req.apialize.options.include
      ? req.apialize.options.include
      : [];
  const Op = getSequelizeOp(model);
  const dialect =
    model &&
    model.sequelize &&
    typeof model.sequelize.getDialect === 'function'
      ? model.sequelize.getDialect()
      : null;
  const CI = dialect === 'postgres' ? Op.iLike || Op.like : Op.like;
  const CInot = dialect === 'postgres' ? Op.notILike || Op.notLike : Op.notLike;

  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('api:')) continue;
    if (value === undefined) continue;

    let targetModel = model;
    let rawKey = key;
    let operator = null;
    // Support 'field:operator' form
    if (rawKey.includes(':')) {
      const idx = rawKey.lastIndexOf(':');
      operator = rawKey.slice(idx + 1);
      rawKey = rawKey.slice(0, idx);
    }

  let outKey = rawKey;
  let attribute;

    if (rawKey.includes('.')) {
      const resolved = resolveIncludedAttribute(model, includes, rawKey);
      if (!resolved) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[Apialize] Bad request: Invalid filter column '${rawKey}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`
          );
        }
        res.status(400).json({ success: false, error: 'Bad request' });
        return false;
      }
      
      // Apply relation_id_mapping if configured and the column is 'id'
      const parts = rawKey.split('.');
      let actualColumn = parts[parts.length - 1];
      if (actualColumn === 'id' && Array.isArray(relationIdMapping)) {
        const relationMapping = relationIdMapping.find(mapping => 
          mapping.model === resolved.foundModel
        );
        if (relationMapping && relationMapping.id_field) {
          actualColumn = relationMapping.id_field;
          // Update the alias path to use the mapped field
          const aliasPrefix = resolved.aliasPath.split('.').slice(0, -1).join('.');
          const newAliasPath = aliasPrefix ? `${aliasPrefix}.${actualColumn}` : actualColumn;
          outKey = `$${newAliasPath}$`;
          // Update attribute for the mapped field
          const attrs = getModelAttributes(resolved.foundModel);
          attribute = attrs && attrs[actualColumn];
        } else {
          outKey = `$${resolved.aliasPath}$`;
          attribute = resolved.attribute;
        }
      } else {
        outKey = `$${resolved.aliasPath}$`;
        attribute = resolved.attribute;
      }
      targetModel = resolved.foundModel;
    } else {
      if (!validateColumnExists(model, rawKey)) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[Apialize] Bad request: Invalid filter column '${rawKey}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`
          );
        }
        res.status(400).json({ success: false, error: 'Bad request' });
        return false; // Indicate validation failed
      }
      attribute = getModelAttributes(model)[rawKey];
    }

    const okType =
      attribute && attribute.type
        ? validateDataType({ rawAttributes: { tmp: attribute } }, 'tmp', value)
        : true;
    if (!okType) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[Apialize] Bad request: Invalid filter value '${value}' is not compatible with column '${rawKey}' data type on model '${targetModel && targetModel.name ? targetModel.name : 'Model'}'. Query: ${req.originalUrl}`
        );
      }
      res.status(400).json({ success: false, error: 'Bad request' });
      return false; // Indicate validation failed
    }

    // If no operator provided, default to equality (case-insensitive for strings)
    if (!operator) {
      const typeName =
        attribute && attribute.type && attribute.type.constructor
          ? String(attribute.type.constructor.name).toLowerCase()
          : null;
      if (typeName && ['string', 'text', 'char', 'varchar'].includes(typeName)) {
        appliedFiltersMeta[outKey] = value;
        appliedFiltersDb[outKey] = { [CI]: value };
      } else {
        appliedFiltersMeta[outKey] = value;
        appliedFiltersDb[outKey] = value;
      }
    } else {
      // Map operator to Sequelize operator
      const opMap = {
        eq: Op.eq,
        '=': Op.eq,
        ieq: CI,
        neq: Op.ne,
        '!=': Op.ne,
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
      if (!Object.prototype.hasOwnProperty.call(opMap, operator)) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[Apialize] Bad request: Invalid operator '${operator}' for filter '${rawKey}'. Query: ${req.originalUrl}`
          );
        }
        res.status(400).json({ success: false, error: 'Bad request' });
        return false;
      }
      const opSymbol = opMap[operator];
      let opValue;
      if (operator === 'contains' || operator === 'not_contains') opValue = `%${value}%`;
      else if (operator === 'icontains' || operator === 'not_icontains') opValue = `%${value}%`;
      else if (operator === 'starts_with' || operator === 'not_starts_with') opValue = `${value}%`;
      else if (operator === 'ends_with' || operator === 'not_ends_with') opValue = `%${value}`;
      else if (operator === 'is_true') opValue = true;
      else if (operator === 'is_false') opValue = false;
      else if (operator === 'in' || operator === 'not_in') {
        // Split comma-separated values; trim spaces
        opValue = String(value)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } else {
        opValue = value;
      }

      // Meta: reflect the operator application (symbol keys are fine for internal meta consumers)
      appliedFiltersMeta[outKey] = Object.assign(
        {},
        appliedFiltersMeta[outKey] || {},
        { [opSymbol]: opValue }
      );
      appliedFiltersDb[outKey] = Object.assign(
        {},
        appliedFiltersDb[outKey] || {},
        { [opSymbol]: opValue }
      );
    }
  }

  if (Object.keys(appliedFiltersDb).length) {
    const existingWhere = req.apialize.options.where || {};
    const mergedWhere = Object.assign({}, existingWhere);
    const appliedKeys = Object.keys(appliedFiltersDb);
    for (let i = 0; i < appliedKeys.length; i++) {
      const k = appliedKeys[i];
      mergedWhere[k] = appliedFiltersDb[k];
    }
    req.apialize.options.where = mergedWhere;
  }

  return appliedFiltersMeta;
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
  idMapping,
  normalizeRows // function injected at call site if not globally available
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

  const normFn = normalizeRows || ((x) => x);
  const normalizedRows = normFn(rows, idMapping);
  const totalPages = Math.max(1, Math.ceil(result.count / pageSize));

  let orderOut;
  if (metaShowOrdering) {
    if (Array.isArray(req.apialize.options.order)) {
      orderOut = [];
      for (let i = 0; i < req.apialize.options.order.length; i++) {
        const o = req.apialize.options.order[i];
        if (Array.isArray(o)) {
          // Handle formats: [field, dir] OR [ {model,as}, ..., attr, dir ]
          const dir = (o[o.length - 1] || 'ASC').toString().toUpperCase();
          // Find last string before dir as attribute
          let attrIndex = -1;
          for (let j = o.length - 2; j >= 0; j--) {
            if (typeof o[j] === 'string') {
              attrIndex = j;
              break;
            }
          }
          if (attrIndex === 0) {
            // Simple [field, dir]
            let field = o[0];
            if (typeof field === 'string' && field.startsWith('$') && field.endsWith('$')) {
              field = field.slice(1, -1);
            }
            orderOut.push([field, dir]);
          } else if (attrIndex > 0) {
            // Nested include path: objects from 0..attrIndex-1, then attrIndex is attribute
            const attr = o[attrIndex];
            const aliases = [];
            for (let k = 0; k < attrIndex; k++) {
              const seg = o[k];
              if (seg && typeof seg === 'object' && seg.as) aliases.push(seg.as);
            }
            const field = aliases.length ? `${aliases.join('.')}.${attr}` : attr;
            orderOut.push([field, dir]);
          } else {
            // Fallback: unknown format, push as-is
            orderOut.push(o);
          }
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

module.exports = {
  getModelAttributes,
  validateColumnExists,
  resolveIncludedAttribute,
  validateDataType,
  setupPagination,
  setupOrdering,
  setupFiltering,
  buildResponse,
};
