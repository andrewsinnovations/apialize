const Sequelize = require('sequelize');

function getModelAttributes(model) {
  if (!model || !model.rawAttributes) {
    return {};
  }
  return model.rawAttributes;
}

function validateColumnExists(model, columnName) {
  const attributes = getModelAttributes(model);
  return Object.prototype.hasOwnProperty.call(attributes, columnName);
}

function isValidDottedPath(dottedPath) {
  if (!dottedPath || typeof dottedPath !== 'string') {
    return false;
  }
  if (!dottedPath.includes('.')) {
    return false;
  }
  return true;
}

function isValidIncludesArray(includes) {
  if (!Array.isArray(includes) || includes.length === 0) {
    return false;
  }
  return true;
}

function findIncludeByAlias(includes, alias) {
  if (!Array.isArray(includes)) {
    return null;
  }

  for (let i = 0; i < includes.length; i++) {
    const include = includes[i];
    if (include && include.as === alias) {
      return include;
    }
  }
  return null;
}

function resolveIncludedAttribute(rootModel, includes, dottedPath) {
  if (!isValidDottedPath(dottedPath)) {
    return null;
  }
  if (!isValidIncludesArray(includes)) {
    return null;
  }

  const parts = dottedPath.split('.');
  const attrName = parts.pop();
  let currIncludes = includes;
  let currModel = rootModel;
  const aliasChain = [];
  const includeChain = [];

  for (let i = 0; i < parts.length; i++) {
    const alias = parts[i];
    const match = findIncludeByAlias(currIncludes, alias);
    if (!match || !match.model) {
      return null;
    }
    aliasChain.push(alias);
    currModel = match.model;
    currIncludes = match.include || [];
    includeChain.push({ model: match.model, as: alias });
  }

  const attrs = getModelAttributes(currModel);
  if (!Object.prototype.hasOwnProperty.call(attrs, attrName)) {
    return null;
  }

  return {
    foundModel: currModel,
    attribute: attrs[attrName],
    aliasPath: `${aliasChain.join('.')}.${attrName}`,
    aliasChain,
    includeChain,
  };
}

function isValidIntegerValue(value) {
  return !isNaN(parseInt(value, 10));
}

function isValidFloatValue(value) {
  return !isNaN(parseFloat(value));
}

function isValidBooleanValue(value) {
  const validBooleans = ['true', 'false', '1', '0', 'yes', 'no'];
  const stringValue = String(value).toLowerCase();
  return validBooleans.includes(stringValue);
}

function isValidDateValue(value) {
  return !isNaN(Date.parse(value));
}

function validateDataTypeByName(typeName, value) {
  if (typeName === 'integer' || typeName === 'bigint') {
    return isValidIntegerValue(value);
  }
  if (
    typeName === 'float' ||
    typeName === 'real' ||
    typeName === 'double' ||
    typeName === 'decimal'
  ) {
    return isValidFloatValue(value);
  }
  if (typeName === 'boolean') {
    return isValidBooleanValue(value);
  }
  if (typeName === 'date' || typeName === 'dateonly') {
    return isValidDateValue(value);
  }
  if (
    typeName === 'string' ||
    typeName === 'text' ||
    typeName === 'char' ||
    typeName === 'varchar'
  ) {
    return true;
  }
  return true;
}

function validateDataType(model, columnName, value) {
  const attributes = getModelAttributes(model);
  const attribute = attributes[columnName];

  if (!attribute || !attribute.type) {
    return true;
  }

  const dataType = attribute.type;
  const typeName = dataType.constructor.name.toLowerCase();

  try {
    return validateDataTypeByName(typeName, value);
  } catch (error) {
    return true;
  }
}

function extractValidPage(query) {
  const page = parseInt(query['api:page'], 10);
  if (isNaN(page) || page < 1) {
    return 1;
  }
  return page;
}

function calculateEffectivePageSize(modelCfg, defaultPageSize) {
  if (Number.isInteger(modelCfg.page_size) && modelCfg.page_size > 0) {
    return modelCfg.page_size;
  }
  return defaultPageSize;
}

function extractValidPageSize(query, effectivePageSize) {
  const pageSize = parseInt(query['api:page_size'], 10);
  if (isNaN(pageSize) || pageSize < 1) {
    return effectivePageSize;
  }
  return pageSize;
}

function setupPagination(req, query, modelCfg, defaultPageSize) {
  const page = extractValidPage(query);
  const effectivePageSize = calculateEffectivePageSize(
    modelCfg,
    defaultPageSize
  );
  const pageSize = extractValidPageSize(query, effectivePageSize);

  req.apialize.options.limit = pageSize;
  req.apialize.options.offset = (page - 1) * pageSize;

  return { page, pageSize };
}

function extractOrderByValue(query, modelCfg, allowOrdering) {
  if (allowOrdering) {
    return query['api:order_by'] || modelCfg.orderby;
  }
  return modelCfg.orderby;
}

function extractOrderDirection(query, modelCfg, allowOrdering) {
  let direction;
  if (allowOrdering) {
    direction = query['api:order_dir'] || modelCfg.orderdir || 'ASC';
  } else {
    direction = modelCfg.orderdir || 'ASC';
  }
  return direction.toString().toUpperCase();
}

function parseOrderByFields(rawOrderBy) {
  if (!rawOrderBy) {
    return [];
  }

  const splitFields = rawOrderBy.split(',');
  const fields = [];

  for (let i = 0; i < splitFields.length; i++) {
    const field = splitFields[i];
    const trimmed = field != null ? String(field).trim() : '';
    if (trimmed) {
      fields.push(trimmed);
    }
  }

  return fields;
}

function parseFieldDirection(field, globalDir) {
  if (!field) {
    return null;
  }

  let columnName;
  let direction;

  if (field.charAt(0) === '-') {
    columnName = field.slice(1);
    direction = 'DESC';
  } else if (field.charAt(0) === '+') {
    columnName = field.slice(1);
    direction = 'ASC';
  } else {
    columnName = field;
    if (globalDir === 'DESC') {
      direction = 'DESC';
    } else {
      direction = 'ASC';
    }
  }

  return { columnName, direction };
}

function getIncludesFromRequest(req) {
  if (req.apialize.options && Array.isArray(req.apialize.options.include)) {
    return req.apialize.options.include;
  }
  return [];
}

function sendBadRequestResponse(res, message) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(message);
  }
  res.status(400).json({ success: false, error: 'Bad request' });
}

function findRelationMapping(relationIdMapping, foundModel) {
  if (!Array.isArray(relationIdMapping)) {
    return null;
  }

  for (let i = 0; i < relationIdMapping.length; i++) {
    const mapping = relationIdMapping[i];
    if (mapping.model === foundModel) {
      return mapping;
    }
    if (mapping.model && foundModel) {
      if (mapping.model.name === foundModel.name) {
        return mapping;
      }
      if (mapping.model.tableName === foundModel.tableName) {
        return mapping;
      }
    }
  }
  return null;
}

function buildIncludeChainForOrder(resolved) {
  if (Array.isArray(resolved.includeChain)) {
    const chain = [];
    for (let i = 0; i < resolved.includeChain.length; i++) {
      const c = resolved.includeChain[i];
      chain.push({ model: c.model, as: c.as });
    }
    return chain;
  }

  const parts = resolved.aliasPath.split('.');
  return [
    {
      model: resolved.foundModel,
      as: parts.slice(0, -1).join('.') || parts[0],
    },
  ];
}

function processOrderField(
  field,
  globalDir,
  model,
  includes,
  req,
  res,
  relationIdMapping
) {
  const parsedField = parseFieldDirection(field, globalDir);
  if (!parsedField) {
    return null;
  }

  const { columnName, direction } = parsedField;

  if (columnName.includes('.')) {
    const resolved = resolveIncludedAttribute(model, includes, columnName);
    if (!resolved) {
      const message = `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}' or its includes. Query: ${req.originalUrl}`;
      sendBadRequestResponse(res, message);
      return false;
    }

    const parts = columnName.split('.');
    let attr = parts[parts.length - 1];

    if (attr === 'id') {
      const relationMapping = findRelationMapping(
        relationIdMapping,
        resolved.foundModel
      );
      if (relationMapping && relationMapping.id_field) {
        attr = relationMapping.id_field;
      }
    }

    const chain = buildIncludeChainForOrder(resolved);
    return [...chain, attr, direction];
  } else {
    if (!validateColumnExists(model, columnName)) {
      const message = `[Apialize] Bad request: Invalid order column '${columnName}' does not exist on model '${model.name}'. Query: ${req.originalUrl}`;
      sendBadRequestResponse(res, message);
      return false;
    }
    return [columnName, direction];
  }
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
  const rawOrderBy = extractOrderByValue(query, modelCfg, allowOrdering);
  const globalDir = extractOrderDirection(query, modelCfg, allowOrdering);

  if (rawOrderBy) {
    const fields = parseOrderByFields(rawOrderBy);
    const order = [];
    const includes = getIncludesFromRequest(req);

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) {
        continue;
      }

      const orderEntry = processOrderField(
        field,
        globalDir,
        model,
        includes,
        req,
        res,
        relationIdMapping
      );
      if (orderEntry === false) {
        return false;
      }
      if (orderEntry) {
        order.push(orderEntry);
      }
    }

    if (order.length) {
      req.apialize.options.order = order;
    }
  }

  if (!req.apialize.options.order) {
    let effectiveDefaultOrderBy = defaultOrderBy;
    if (defaultOrderBy === 'id' && idMapping) {
      effectiveDefaultOrderBy = idMapping;
    }
    req.apialize.options.order = [[effectiveDefaultOrderBy, defaultOrderDir]];
  }

  return true;
}

function getSequelizeOpFromModel(model) {
  if (!model || !model.sequelize) {
    return null;
  }

  if (model.sequelize.constructor && model.sequelize.constructor.Op) {
    return model.sequelize.constructor.Op;
  }

  if (model.sequelize.Sequelize && model.sequelize.Sequelize.Op) {
    return model.sequelize.Sequelize.Op;
  }

  return null;
}

function getSequelizeOp(model) {
  const opFromModel = getSequelizeOpFromModel(model);
  if (opFromModel) {
    return opFromModel;
  }

  try {
    return require('sequelize').Op;
  } catch (error) {
    return {};
  }
}

function getFilteringIncludes(req) {
  if (req.apialize.options && req.apialize.options.include) {
    return req.apialize.options.include;
  }
  return [];
}

function getDatabaseDialect(model) {
  if (
    model &&
    model.sequelize &&
    typeof model.sequelize.getDialect === 'function'
  ) {
    return model.sequelize.getDialect();
  }
  return null;
}

function getCaseInsensitiveOperators(Op, dialect) {
  const CI = dialect === 'postgres' ? Op.iLike || Op.like : Op.like;
  const CInot = dialect === 'postgres' ? Op.notILike || Op.notLike : Op.notLike;
  return { CI, CInot };
}

function parseFilterKey(key) {
  let rawKey = key;
  let operator = null;

  if (rawKey.includes(':')) {
    const idx = rawKey.lastIndexOf(':');
    operator = rawKey.slice(idx + 1);
    rawKey = rawKey.slice(0, idx);
  }

  return { rawKey, operator };
}

function setupFiltering(
  req,
  res,
  model,
  query,
  allowFiltering,
  relationIdMapping
) {
  let appliedFiltersMeta = {};
  let appliedFiltersDb = {};

  if (!allowFiltering) {
    return appliedFiltersMeta;
  }

  const includes = getFilteringIncludes(req);
  const Op = getSequelizeOp(model);
  const dialect = getDatabaseDialect(model);
  const { CI, CInot } = getCaseInsensitiveOperators(Op, dialect);

  function shouldSkipFilterKey(key, value) {
    if (key.startsWith('api:')) {
      return true;
    }
    if (value === undefined) {
      return true;
    }
    return false;
  }

  const queryKeys = Object.keys(query);
  for (let i = 0; i < queryKeys.length; i++) {
    const key = queryKeys[i];
    const value = query[key];

    if (shouldSkipFilterKey(key, value)) {
      continue;
    }

    let targetModel = model;
    const { rawKey, operator } = parseFilterKey(key);
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
      if (
        typeName &&
        ['string', 'text', 'char', 'varchar'].includes(typeName)
      ) {
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
      if (operator === 'contains' || operator === 'not_contains')
        opValue = `%${value}%`;
      else if (operator === 'icontains' || operator === 'not_icontains')
        opValue = `%${value}%`;
      else if (operator === 'starts_with' || operator === 'not_starts_with')
        opValue = `${value}%`;
      else if (operator === 'ends_with' || operator === 'not_ends_with')
        opValue = `%${value}`;
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

function convertResultRowsToPlainObjects(resultRows) {
  if (!Array.isArray(resultRows)) {
    return resultRows;
  }

  const rows = [];
  for (let i = 0; i < resultRows.length; i++) {
    const r = resultRows[i];
    if (r && typeof r.get === 'function') {
      rows.push(r.get({ plain: true }));
    } else {
      rows.push(r);
    }
  }
  return rows;
}

function createDefaultNormalizeFunction() {
  return function (x) {
    return x;
  };
}

async function buildResponse(
  result,
  page,
  pageSize,
  appliedFilters,
  metaShowFilters,
  metaShowOrdering,
  allowFiltering,
  req,
  idMapping,
  normalizeRows
) {
  const rows = convertResultRowsToPlainObjects(result.rows);
  const normFn = normalizeRows || createDefaultNormalizeFunction();
  const normalizedRows = await normFn(rows, idMapping);
  const totalPages = Math.max(1, Math.ceil(result.count / pageSize));

  function cleanFieldName(field) {
    if (
      typeof field === 'string' &&
      field.startsWith('$') &&
      field.endsWith('$')
    ) {
      return field.slice(1, -1);
    }
    return field;
  }

  function findLastStringIndex(orderArray) {
    for (let j = orderArray.length - 2; j >= 0; j--) {
      if (typeof orderArray[j] === 'string') {
        return j;
      }
    }
    return -1;
  }

  function extractAliasesFromOrderArray(orderArray, attrIndex) {
    const aliases = [];
    for (let k = 0; k < attrIndex; k++) {
      const seg = orderArray[k];
      if (seg && typeof seg === 'object' && seg.as) {
        aliases.push(seg.as);
      }
    }
    return aliases;
  }

  function processOrderArrayEntry(orderEntry) {
    if (Array.isArray(orderEntry)) {
      const dir = (orderEntry[orderEntry.length - 1] || 'ASC')
        .toString()
        .toUpperCase();
      const attrIndex = findLastStringIndex(orderEntry);

      if (attrIndex === 0) {
        const field = cleanFieldName(orderEntry[0]);
        return [field, dir];
      } else if (attrIndex > 0) {
        const attr = orderEntry[attrIndex];
        const aliases = extractAliasesFromOrderArray(orderEntry, attrIndex);
        const field = aliases.length ? `${aliases.join('.')}.${attr}` : attr;
        return [field, dir];
      } else {
        return orderEntry;
      }
    } else if (typeof orderEntry === 'string') {
      return [orderEntry, 'ASC'];
    } else {
      return orderEntry;
    }
  }

  function buildOrderOutput(req) {
    if (!Array.isArray(req.apialize.options.order)) {
      return [];
    }

    const orderOut = [];
    for (let i = 0; i < req.apialize.options.order.length; i++) {
      const orderEntry = req.apialize.options.order[i];
      const processedEntry = processOrderArrayEntry(orderEntry);
      orderOut.push(processedEntry);
    }
    return orderOut;
  }

  let orderOut;
  if (metaShowOrdering) {
    orderOut = buildOrderOutput(req);
  }

  function buildMetaObject(
    page,
    pageSize,
    totalPages,
    count,
    metaShowOrdering,
    metaShowFilters,
    orderOut,
    appliedFilters,
    allowFiltering
  ) {
    const meta = {
      page: page,
      page_size: pageSize,
      total_pages: totalPages,
      count: count,
    };

    if (metaShowOrdering) {
      meta.order = orderOut;
    }

    if (metaShowFilters) {
      if (allowFiltering) {
        meta.filters = appliedFilters;
      } else {
        meta.filters = {};
      }
    }

    return meta;
  }

  const meta = buildMetaObject(
    page,
    pageSize,
    totalPages,
    result.count,
    metaShowOrdering,
    metaShowFilters,
    orderOut,
    appliedFilters,
    allowFiltering
  );

  return {
    success: true,
    meta: meta,
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
