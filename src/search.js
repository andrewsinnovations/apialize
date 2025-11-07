const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  mergeReqOptionsIntoModelOptions,
} = require('./utils');
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
  if (model && model.sequelize) {
    if (model.sequelize.constructor && model.sequelize.constructor.Op) {
      return model.sequelize.constructor.Op;
    }
    if (model.sequelize.Sequelize && model.sequelize.Sequelize.Op) {
      return model.sequelize.Sequelize.Op;
    }
  }

  try {
    return require('sequelize').Op;
  } catch (error) {
    return {};
  }
}

const SEARCH_DEFAULTS = {
  middleware: [],
  defaultPageSize: 100,
  defaultOrderBy: 'id',
  defaultOrderDir: 'ASC',
  metaShowOrdering: false,
  pre: null,
  post: null,
  id_mapping: 'id',
  relation_id_mapping: null,
  path: '/search',
  disableSubqueryOnIncludeRequest: true,
};

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

function getCaseInsensitiveOperators(dialect, Op) {
  const isPostgres = dialect === 'postgres';
  const caseInsensitiveLike = isPostgres ? Op.iLike || Op.like : Op.like;
  const caseInsensitiveNotLike = isPostgres
    ? Op.notILike || Op.notLike
    : Op.notLike;

  return {
    like: caseInsensitiveLike,
    notLike: caseInsensitiveNotLike,
  };
}

function findRelationMapping(relationIdMapping, foundModel) {
  if (!Array.isArray(relationIdMapping)) {
    return null;
  }

  return relationIdMapping.find((mapping) => {
    if (mapping.model === foundModel) {
      return true;
    }

    if (mapping.model && foundModel) {
      if (mapping.model.name === foundModel.name) {
        return true;
      }
      if (mapping.model.tableName === foundModel.tableName) {
        return true;
      }
    }

    return false;
  });
}

function buildAliasPath(resolved, actualColumn) {
  const aliasPrefix = resolved.aliasPath.split('.').slice(0, -1).join('.');

  if (aliasPrefix) {
    return `${aliasPrefix}.${actualColumn}`;
  }

  return actualColumn;
}

function resolveIncludedModelColumn(model, includes, key, relationIdMapping) {
  const resolved = resolveIncludedAttribute(model, includes, key);
  if (!resolved) {
    return { error: `Invalid column '${key}'` };
  }

  const parts = key.split('.');
  let actualColumn = parts[parts.length - 1];
  let outKey;
  let validateColumn = actualColumn;
  let attribute = resolved.attribute;

  if (actualColumn === 'id') {
    const relationMapping = findRelationMapping(
      relationIdMapping,
      resolved.foundModel
    );

    if (relationMapping && relationMapping.id_field) {
      actualColumn = relationMapping.id_field;
      const newAliasPath = buildAliasPath(resolved, actualColumn);
      outKey = `$${newAliasPath}$`;
      validateColumn = actualColumn;
      const attrs = getModelAttributes(resolved.foundModel);
      attribute = attrs && attrs[actualColumn];
    } else {
      outKey = `$${resolved.aliasPath}$`;
    }
  } else {
    outKey = `$${resolved.aliasPath}$`;
  }

  return {
    outKey,
    validateModel: resolved.foundModel,
    validateColumn,
    attribute,
  };
}

function processFieldForFlattening(
  key,
  flattening,
  model,
  includes,
  relationIdMapping
) {
  if (!flattening || typeof key !== 'string') {
    return { isFlattened: false };
  }

  const {
    isFlattenedField,
    mapFlattenedFieldToIncludePath,
  } = require('./listUtils');
  if (!isFlattenedField(key, flattening)) {
    return { isFlattened: false };
  }

  const includePath = mapFlattenedFieldToIncludePath(key, flattening);
  if (!includePath) {
    return { isFlattened: false };
  }

  const resolved = resolveIncludedModelColumn(
    model,
    includes,
    includePath,
    relationIdMapping
  );
  if (resolved.error) {
    return { isFlattened: true, error: resolved.error };
  }

  return {
    isFlattened: true,
    outKey: resolved.outKey,
    validateModel: resolved.validateModel,
    validateColumn: resolved.validateColumn,
    attribute: resolved.attribute,
  };
}

function processFieldForIncludes(key, model, includes, relationIdMapping) {
  if (typeof key !== 'string' || !key.includes('.')) {
    return { hasIncludes: false };
  }

  const resolved = resolveIncludedModelColumn(
    model,
    includes,
    key,
    relationIdMapping
  );
  if (resolved.error) {
    return { hasIncludes: true, error: resolved.error };
  }

  return {
    hasIncludes: true,
    outKey: resolved.outKey,
    validateModel: resolved.validateModel,
    validateColumn: resolved.validateColumn,
    attribute: resolved.attribute,
  };
}

function resolveFieldContext(
  key,
  model,
  includes,
  relationIdMapping,
  flattening
) {
  const flattenedResult = processFieldForFlattening(
    key,
    flattening,
    model,
    includes,
    relationIdMapping
  );
  if (flattenedResult.error) {
    return flattenedResult;
  }
  if (flattenedResult.isFlattened) {
    return flattenedResult;
  }

  const includesResult = processFieldForIncludes(
    key,
    model,
    includes,
    relationIdMapping
  );
  if (includesResult.error) {
    return includesResult;
  }
  if (includesResult.hasIncludes) {
    return includesResult;
  }

  const attrs = getModelAttributes(model);
  return {
    outKey: key,
    validateModel: model,
    validateColumn: key,
    attribute: attrs && attrs[key],
  };
}

function buildFieldPredicate(
  model,
  key,
  rawVal,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const dialect = getDatabaseDialect(model);
  const operators = getCaseInsensitiveOperators(dialect, Op);

  const fieldContext = resolveFieldContext(
    key,
    model,
    includes,
    relationIdMapping,
    flattening
  );
  if (fieldContext.error) {
    return fieldContext;
  }

  const { outKey, validateModel, validateColumn, attribute } = fieldContext;

  if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
    return buildObjectPredicate(
      rawVal,
      key,
      outKey,
      validateModel,
      validateColumn,
      Op,
      operators
    );
  }

  return buildEqualityPredicate(
    rawVal,
    key,
    outKey,
    validateModel,
    validateColumn,
    attribute,
    operators
  );
}

function getOperatorMapping(Op, operators) {
  return {
    eq: Op.eq,
    '=': Op.eq,
    ieq: operators.like,
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
    icontains: operators.like,
    not_contains: Op.notLike,
    not_icontains: operators.notLike,
    starts_with: Op.like,
    ends_with: Op.like,
    not_starts_with: Op.notLike,
    not_ends_with: Op.notLike,
    is_true: Op.eq,
    is_false: Op.eq,
  };
}

function isContainsOperator(operatorKey) {
  return (
    operatorKey === 'contains' ||
    operatorKey === 'not_contains' ||
    operatorKey === 'icontains' ||
    operatorKey === 'not_icontains'
  );
}

function isStartsEndOperator(operatorKey) {
  return (
    operatorKey === 'starts_with' ||
    operatorKey === 'not_starts_with' ||
    operatorKey === 'ends_with' ||
    operatorKey === 'not_ends_with'
  );
}

function isBooleanOperator(operatorKey) {
  return operatorKey === 'is_true' || operatorKey === 'is_false';
}

function transformOperatorValue(operatorKey, value) {
  if (isContainsOperator(operatorKey)) {
    return `%${value}%`;
  }
  if (operatorKey === 'starts_with' || operatorKey === 'not_starts_with') {
    return `${value}%`;
  }
  if (operatorKey === 'ends_with' || operatorKey === 'not_ends_with') {
    return `%${value}`;
  }
  if (operatorKey === 'is_true') {
    return true;
  }
  if (operatorKey === 'is_false') {
    return false;
  }
  return value;
}

function processOperatorValues(rawVal, operatorMapping) {
  const sequelizeOperators = {};

  for (const operatorKey of Object.keys(rawVal)) {
    const value = rawVal[operatorKey];

    if (!Object.prototype.hasOwnProperty.call(operatorMapping, operatorKey)) {
      continue;
    }

    const sequelizeOp = operatorMapping[operatorKey];
    const transformedValue = transformOperatorValue(operatorKey, value);
    sequelizeOperators[sequelizeOp] = transformedValue;
  }

  return sequelizeOperators;
}

function validateInOperatorValue(rawVal, validateModel, validateColumn, key) {
  if (!Array.isArray(rawVal.in) && rawVal.in !== undefined) {
    const valueToValidate = (rawVal && rawVal.in && rawVal.in[0]) || rawVal.in;
    if (!validateDataType(validateModel, validateColumn, valueToValidate)) {
      return { error: `Invalid value for '${key}'` };
    }
  }
  return null;
}

function buildObjectPredicate(
  rawVal,
  key,
  outKey,
  validateModel,
  validateColumn,
  Op,
  operators
) {
  if (!validateColumnExists(validateModel, validateColumn)) {
    return { error: `Invalid column '${key}'` };
  }

  const operatorMapping = getOperatorMapping(Op, operators);
  const sequelizeOperators = processOperatorValues(rawVal, operatorMapping);

  if (Reflect.ownKeys(sequelizeOperators).length === 0) {
    return {};
  }

  const validationError = validateInOperatorValue(
    rawVal,
    validateModel,
    validateColumn,
    key
  );
  if (validationError) {
    return validationError;
  }

  return { [outKey]: sequelizeOperators };
}

function isStringType(attribute) {
  if (!attribute || !attribute.type || !attribute.type.constructor) {
    return false;
  }

  const typeName = String(attribute.type.constructor.name).toLowerCase();
  const stringTypes = ['string', 'text', 'char', 'varchar'];

  return stringTypes.includes(typeName);
}

function buildEqualityPredicate(
  rawVal,
  key,
  outKey,
  validateModel,
  validateColumn,
  attribute,
  operators
) {
  if (!validateColumnExists(validateModel, validateColumn)) {
    return { error: `Invalid column '${key}'` };
  }

  if (!validateDataType(validateModel, validateColumn, rawVal)) {
    return { error: `Invalid value for '${key}'` };
  }

  if (isStringType(attribute)) {
    return { [outKey]: { [operators.like]: rawVal } };
  }

  return { [outKey]: rawVal };
}

function mergeObjectProperties(target, source) {
  for (const key of Object.keys(source)) {
    if (
      target[key] &&
      typeof target[key] === 'object' &&
      typeof source[key] === 'object'
    ) {
      target[key] = { ...target[key], ...source[key] };
    } else {
      target[key] = source[key];
    }
  }
}

function collectWhereClauseParts(
  filters,
  model,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const parts = [];

  for (const item of filters) {
    const subWhere = buildWhere(
      model,
      item,
      Op,
      includes,
      relationIdMapping,
      flattening
    );
    if (subWhere && Object.keys(subWhere).length) {
      parts.push(subWhere);
    }
  }

  return parts;
}

function separateOrClauses(parts, Op) {
  const merged = {};
  const orClauses = [];

  for (const part of parts) {
    if (part[Op.or]) {
      const orArray = Array.isArray(part[Op.or]) ? part[Op.or] : [part[Op.or]];
      orClauses.push(...orArray);

      const { [Op.or]: omitted, ...rest } = part;
      mergeObjectProperties(merged, rest);
    } else {
      mergeObjectProperties(merged, part);
    }
  }

  return { merged, orClauses };
}

function processAndFilters(
  filters,
  model,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const parts = collectWhereClauseParts(
    filters.and,
    model,
    Op,
    includes,
    relationIdMapping,
    flattening
  );
  const { merged, orClauses } = separateOrClauses(parts, Op);

  if (orClauses.length) {
    merged[Op.or] = orClauses;
  }

  return merged;
}

function processOrFilters(
  filters,
  model,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const parts = collectWhereClauseParts(
    filters.or,
    model,
    Op,
    includes,
    relationIdMapping,
    flattening
  );

  if (parts.length === 0) {
    return {};
  }

  return { [Op.or]: parts };
}

function isLogicalOperator(key, value) {
  return (key === 'and' || key === 'or') && Array.isArray(value);
}

function buildFieldPredicates(
  filters,
  model,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const keys = Object.keys(filters);
  const andParts = [];

  for (const key of keys) {
    if (isLogicalOperator(key, filters[key])) {
      continue;
    }

    const value = filters[key];
    const predicate = buildFieldPredicate(
      model,
      key,
      value,
      Op,
      includes,
      relationIdMapping,
      flattening
    );

    if (predicate && predicate.error) {
      return { __error: predicate.error };
    }

    if (predicate && Object.keys(predicate).length) {
      andParts.push(predicate);
    }
  }

  return andParts;
}

function mergePredicateParts(andParts) {
  if (andParts.length === 0) {
    return {};
  }

  if (andParts.length === 1) {
    return andParts[0];
  }

  const merged = {};
  for (const part of andParts) {
    mergeObjectProperties(merged, part);
  }

  return merged;
}

function processImplicitAndFilters(
  filters,
  model,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const andParts = buildFieldPredicates(
    filters,
    model,
    Op,
    includes,
    relationIdMapping,
    flattening
  );

  if (andParts.__error) {
    return andParts;
  }

  return mergePredicateParts(andParts);
}

function buildWhere(
  model,
  filters,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  if (!filters || typeof filters !== 'object') {
    return {};
  }

  if (Array.isArray(filters.and)) {
    return processAndFilters(
      filters,
      model,
      Op,
      includes,
      relationIdMapping,
      flattening
    );
  }

  if (Array.isArray(filters.or)) {
    return processOrFilters(
      filters,
      model,
      Op,
      includes,
      relationIdMapping,
      flattening
    );
  }

  return processImplicitAndFilters(
    filters,
    model,
    Op,
    includes,
    relationIdMapping,
    flattening
  );
}

function normalizeOrderingItems(ordering) {
  if (!ordering) {
    return [];
  }

  if (Array.isArray(ordering)) {
    return ordering;
  }

  return [ordering];
}

function extractOrderColumn(item) {
  return item.order_by || item.orderby || item.column || item.field;
}

function normalizeOrderDirection(item, defaultOrderDir) {
  const direction = item.direction || item.dir || defaultOrderDir || 'ASC';
  return String(direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
}

function resolveOrderColumnName(column, idMapping) {
  if (column === 'id' && idMapping) {
    return idMapping;
  }
  return column;
}

function buildIncludeChain(resolved, parts) {
  if (Array.isArray(resolved.includeChain)) {
    return resolved.includeChain.map((c) => ({ model: c.model, as: c.as }));
  }

  return [
    {
      model: resolved.foundModel,
      as: parts.slice(0, -1).join('.') || parts[0],
    },
  ];
}

function processIncludedOrderColumn(
  model,
  columnName,
  includes,
  relationIdMapping
) {
  const resolved = resolveIncludedAttribute(model, includes || [], columnName);
  if (!resolved) {
    return { error: `Invalid order column '${columnName}'` };
  }

  const parts = columnName.split('.');
  let attribute = parts[parts.length - 1];

  if (attribute === 'id') {
    const relationMapping = findRelationMapping(
      relationIdMapping,
      resolved.foundModel
    );
    if (relationMapping && relationMapping.id_field) {
      attribute = relationMapping.id_field;
    }
  }

  const includeChain = buildIncludeChain(resolved, parts);
  return { includeChain, attribute };
}

function processOrderItemForFlattening(
  columnName,
  flattening,
  model,
  includes,
  relationIdMapping,
  direction
) {
  if (!flattening || typeof columnName !== 'string') {
    return { processed: false };
  }

  const {
    isFlattenedField,
    mapFlattenedFieldToIncludePath,
  } = require('./listUtils');
  if (!isFlattenedField(columnName, flattening)) {
    return { processed: false };
  }

  const includePath = mapFlattenedFieldToIncludePath(columnName, flattening);
  if (!includePath) {
    return { processed: false };
  }

  const result = processIncludedOrderColumn(
    model,
    includePath,
    includes,
    relationIdMapping
  );
  if (result.error) {
    return { processed: true, error: result.error };
  }

  return {
    processed: true,
    orderClause: [...result.includeChain, result.attribute, direction],
  };
}

function processOrderItemForIncludes(
  columnName,
  model,
  includes,
  relationIdMapping,
  direction
) {
  if (typeof columnName !== 'string' || !columnName.includes('.')) {
    return { processed: false };
  }

  const result = processIncludedOrderColumn(
    model,
    columnName,
    includes,
    relationIdMapping
  );
  if (result.error) {
    return { processed: true, error: result.error };
  }

  return {
    processed: true,
    orderClause: [...result.includeChain, result.attribute, direction],
  };
}

function processOrderItem(
  item,
  model,
  defaultOrderDir,
  idMapping,
  includes,
  relationIdMapping,
  flattening
) {
  if (!item || typeof item !== 'object') {
    return { skip: true };
  }

  const column = extractOrderColumn(item);
  if (!column) {
    return { skip: true };
  }

  const direction = normalizeOrderDirection(item, defaultOrderDir);
  const columnName = resolveOrderColumnName(column, idMapping);

  const flattenedResult = processOrderItemForFlattening(
    columnName,
    flattening,
    model,
    includes,
    relationIdMapping,
    direction
  );
  if (flattenedResult.error) {
    return { error: flattenedResult.error };
  }
  if (flattenedResult.processed) {
    return { orderClause: flattenedResult.orderClause };
  }

  const includesResult = processOrderItemForIncludes(
    columnName,
    model,
    includes,
    relationIdMapping,
    direction
  );
  if (includesResult.error) {
    return { error: includesResult.error };
  }
  if (includesResult.processed) {
    return { orderClause: includesResult.orderClause };
  }

  if (!validateColumnExists(model, columnName)) {
    return { error: `Invalid order column '${columnName}'` };
  }

  return { orderClause: [columnName, direction] };
}

function buildOrderClauses(
  items,
  model,
  defaultOrderDir,
  idMapping,
  includes,
  relationIdMapping,
  flattening
) {
  const orderClauses = [];

  for (const item of items) {
    const result = processOrderItem(
      item,
      model,
      defaultOrderDir,
      idMapping,
      includes,
      relationIdMapping,
      flattening
    );

    if (result.error) {
      return { error: result.error };
    }
    if (result.skip) {
      continue;
    }
    if (result.orderClause) {
      orderClauses.push(result.orderClause);
    }
  }

  return { orderClauses };
}

function buildOrdering(
  model,
  ordering,
  defaultOrderBy,
  defaultOrderDir,
  idMapping,
  includes,
  relationIdMapping,
  flattening
) {
  const items = normalizeOrderingItems(ordering);
  const result = buildOrderClauses(
    items,
    model,
    defaultOrderDir,
    idMapping,
    includes,
    relationIdMapping,
    flattening
  );

  if (result.error) {
    return result;
  }

  const { orderClauses } = result;

  if (orderClauses.length === 0) {
    const effectiveOrderBy = resolveOrderColumnName(defaultOrderBy, idMapping);
    orderClauses.push([effectiveOrderBy, defaultOrderDir || 'ASC']);
  }

  return orderClauses;
}

function extractSearchParameters(body) {
  return {
    filters: body.filtering || {},
    ordering: body.ordering || null,
    paging: body.paging || {},
  };
}

function extractMergedOptions(searchOptions) {
  const merged = { ...SEARCH_DEFAULTS, ...(searchOptions || {}) };

  return {
    defaultPageSize: merged.defaultPageSize,
    defaultOrderBy: merged.defaultOrderBy,
    defaultOrderDir: merged.defaultOrderDir,
    metaShowOrdering: !!merged.metaShowOrdering,
    idMapping: merged.id_mapping || 'id',
    relationIdMapping: merged.relation_id_mapping,
    disableSubqueryOnIncludeRequest: merged.disableSubqueryOnIncludeRequest,
    flattening: merged.flattening,
    pre: merged.pre,
    post: merged.post,
  };
}

function hasIncludedFieldsInFilters(filters) {
  if (!filters || typeof filters !== 'object') {
    return false;
  }

  for (const key in filters) {
    if (typeof key === 'string' && key.includes('.')) {
      return true;
    }

    if (key === 'and' || key === 'or') {
      const nestedFilters = filters[key];
      if (Array.isArray(nestedFilters)) {
        for (const nestedFilter of nestedFilters) {
          if (hasIncludedFieldsInFilters(nestedFilter)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function hasIncludedFieldsInOrdering(ordering) {
  if (!ordering) {
    return false;
  }

  const items = normalizeOrderingItems(ordering);

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const column = extractOrderColumn(item);
    if (!column) {
      continue;
    }

    if (typeof column === 'string' && column.includes('.')) {
      return true;
    }
  }

  return false;
}

function validateFlatteningConfiguration(options, model, req, res, body) {
  if (!options.flattening) {
    return true;
  }

  const includes = getIncludesFromContext(req, model);
  const { validateFlatteningConfig } = require('./listUtils');
  const validation = validateFlatteningConfig(
    options.flattening,
    model,
    includes
  );

  if (!validation.isValid) {
    logBadRequest(
      'Search flattening validation failed',
      validation.error,
      body,
      req
    );
    res.status(400).json({ success: false, error: 'Bad request' });
    return false;
  }

  return true;
}

function configureSubqueryOptions(options, filters, ordering, req) {
  if (!options.disableSubqueryOnIncludeRequest) {
    return;
  }

  const hasIncludedFiltering = hasIncludedFieldsInFilters(filters);
  const hasIncludedOrdering = hasIncludedFieldsInOrdering(ordering);
  const hasFlattening = !!options.flattening;

  if (hasIncludedFiltering || hasIncludedOrdering || hasFlattening) {
    req.apialize.options.subQuery = false;
  }
}

function setupPaginationOptions(paging, defaultPageSize, req) {
  const { page, pageSize } = processPaging(paging, defaultPageSize);
  req.apialize.options.limit = pageSize;
  req.apialize.options.offset = (page - 1) * pageSize;
  return { page, pageSize };
}

function processWhereClause(
  model,
  filters,
  Op,
  includes,
  relationIdMapping,
  flattening,
  req,
  body,
  context
) {
  const whereTree = buildWhere(
    model,
    filters || {},
    Op,
    includes,
    relationIdMapping,
    flattening
  );

  if (whereTree && whereTree.__error) {
    logBadRequest('Search bad request', whereTree.__error, body, req);
    context.res.status(400).json({ success: false, error: 'Bad request' });
    return { error: true };
  }

  if (Reflect.ownKeys(whereTree).length === 0) {
    return { success: true };
  }

  const existingWhere = req.apialize.options.where || {};

  if (flattening) {
    const { isFlattenedField } = require('./listUtils');
    const cleanedWhere = {};

    for (const [key, value] of Object.entries(existingWhere)) {
      const isFlattened = isFlattenedField(key, flattening);
      if (!isFlattened) {
        cleanedWhere[key] = value;
      }
    }

    req.apialize.options.where = { ...cleanedWhere, ...whereTree };
  } else {
    req.apialize.options.where = { ...existingWhere, ...whereTree };
  }

  return { success: true };
}

function processOrderingClause(
  model,
  ordering,
  options,
  includes,
  req,
  body,
  context
) {
  const orderArray = buildOrdering(
    model,
    ordering,
    options.defaultOrderBy,
    options.defaultOrderDir,
    options.idMapping,
    includes,
    options.relationIdMapping,
    options.flattening
  );

  if (orderArray && orderArray.error) {
    logBadRequest('Search bad request', orderArray.error, body, req);
    context.res.status(400).json({ success: false, error: 'Bad request' });
    return { error: true };
  }

  req.apialize.options.order = orderArray;
  return { success: true };
}

async function executeSearchQuery(model, options, req) {
  const result = await model.findAndCountAll(req.apialize.options);

  const normalizeRowsFn = async (rows, idMappingParam) => {
    return await normalizeRowsWithForeignKeys(
      rows,
      idMappingParam,
      options.relationIdMapping,
      model
    );
  };

  return { result, normalizeRowsFn };
}

async function executeSearchOperation(
  model,
  searchOptions,
  modelOptions,
  req,
  res,
  body = {}
) {
  const options = extractMergedOptions(searchOptions);
  const { filters, ordering, paging } = extractSearchParameters(body);

  const mergedReqOptions = mergeReqOptionsIntoModelOptions(req, modelOptions);
  req.apialize.options = mergedReqOptions;

  if (!validateFlatteningConfiguration(options, model, req, res, body)) {
    return;
  }

  configureSubqueryOptions(options, filters, ordering, req);

  const Op = getSequelizeOp(model);

  return await withTransactionAndHooks(
    {
      model,
      options: { ...searchOptions, pre: options.pre, post: options.post },
      req,
      res,
      modelOptions,
      idMapping: options.idMapping,
      useReqOptionsTransaction: true,
    },
    async (context) => {
      const { page, pageSize } = setupPaginationOptions(
        paging,
        options.defaultPageSize,
        req
      );
      const includes = getIncludesFromContext(req, model);

      const whereResult = processWhereClause(
        model,
        filters,
        Op,
        includes,
        options.relationIdMapping,
        options.flattening,
        req,
        body,
        context
      );
      if (whereResult.error) {
        return;
      }

      const orderResult = processOrderingClause(
        model,
        ordering,
        options,
        includes,
        req,
        body,
        context
      );
      if (orderResult.error) {
        return;
      }

      const { result, normalizeRowsFn } = await executeSearchQuery(
        model,
        options,
        req
      );

      const response = await buildResponse(
        result,
        page,
        pageSize,
        undefined,
        false,
        options.metaShowOrdering,
        false,
        req,
        options.idMapping,
        normalizeRowsFn,
        options.flattening
      );

      context.payload = response;
      return context.payload;
    }
  );
}

function processPaging(paging, defaultPageSize) {
  let page = parseInt(paging.page, 10);
  if (isNaN(page) || page < 1) {
    page = 1;
  }

  let pageSize = parseInt(paging.size ?? paging.page_size, 10);
  if (isNaN(pageSize) || pageSize < 1) {
    pageSize = defaultPageSize;
  }

  return { page, pageSize };
}

function getIncludesFromContext(req, model) {
  let includes = req.apialize.options.include || [];

  if (model && model._scope && model._scope.include) {
    const scopeIncludes = Array.isArray(model._scope.include)
      ? model._scope.include
      : [model._scope.include];

    if (Array.isArray(includes)) {
      includes = [...includes, ...scopeIncludes];
    } else {
      includes = [...scopeIncludes, includes];
    }
  }

  return includes;
}

function logBadRequest(message, error, body, req) {
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `[Apialize] ${message}: ${error}. Body:`,
      JSON.stringify(body, null, 2),
      `URL: ${req.originalUrl}`
    );
  }
}

function getMiddlewareFunctions(middleware) {
  if (!Array.isArray(middleware)) {
    return [];
  }

  return middleware.filter((fn) => typeof fn === 'function');
}

function normalizePath(path) {
  const basePath = (typeof path === 'string' && path.trim()) || '/search';

  if (basePath.startsWith('/')) {
    return basePath;
  }

  return `/${basePath}`;
}

function disableQueryFilters(req, res, next) {
  req._apializeDisableQueryFilters = true;
  next();
}

function search(model, options = {}, modelOptions = {}) {
  ensureFn(model, 'findAndCountAll');
  const merged = { ...SEARCH_DEFAULTS, ...(options || {}) };

  const middlewareFunctions = getMiddlewareFunctions(merged.middleware);
  const router = express.Router({ mergeParams: true });
  const mountPath = normalizePath(merged.path);

  router.post(
    mountPath,
    disableQueryFilters,
    apializeContext,
    ...middlewareFunctions,
    asyncHandler(async (req, res) => {
      const body = (req && req.body) || {};

      const payload = await executeSearchOperation(
        model,
        options,
        modelOptions,
        req,
        res,
        body
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
module.exports.executeSearchOperation = executeSearchOperation;
