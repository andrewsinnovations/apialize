const { mergeReqOptionsIntoModelOptions } = require('../utils');
const { normalizeRowsWithForeignKeys } = require('../operationUtils');
const {
  validateColumnExists,
  validateDataType,
  buildResponse,
  resolveIncludedAttribute,
  getModelAttributes,
  isFlattenedField,
  mapFlattenedFieldToIncludePath,
} = require('../listUtils');

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
  flattening: null,
};

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

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

function findForeignKeyRelationMapping(fieldName, model, relationIdMapping) {
  if (!Array.isArray(relationIdMapping) || !model || !model.associations) {
    return null;
  }

  // Check if this field is a foreign key in any association
  const associationNames = Object.keys(model.associations);
  for (let i = 0; i < associationNames.length; i++) {
    const association = model.associations[associationNames[i]];

    if (
      association.associationType === 'BelongsTo' &&
      association.foreignKey === fieldName
    ) {
      // This is a foreign key field - find the relation mapping for the target model
      const targetModel = association.target;
      const mapping = findRelationMapping(relationIdMapping, targetModel);

      if (mapping && mapping.id_field) {
        return {
          targetModel: targetModel,
          idField: mapping.id_field,
          association: association,
        };
      }
    }
  }

  return null;
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

  // Check if this is a foreign key field with relation_id_mapping
  // If so, we need to reverse-map: query the related model's id_field instead
  const fkMapping = findForeignKeyRelationMapping(
    key,
    model,
    relationIdMapping
  );
  if (fkMapping) {
    // Build a where condition using the association alias
    const alias =
      fkMapping.association.as || fkMapping.association.associationAccessor;

    // Create the where condition for the external ID
    let externalIdWhere;
    if (rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal)) {
      // Handle operators like {in: [...], gte: ...}
      const operatorMapping = getOperatorMapping(Op, operators);
      externalIdWhere = {};

      const opKeys = Object.keys(rawVal);

      for (let i = 0; i < opKeys.length; i++) {
        const opKey = opKeys[i];
        const opValue = rawVal[opKey];

        if (Object.prototype.hasOwnProperty.call(operatorMapping, opKey)) {
          const sequelizeOp = operatorMapping[opKey];
          const transformedValue = transformOperatorValue(opKey, opValue);
          externalIdWhere[sequelizeOp] = transformedValue;
        }
      }

      // If no operators were found, treat whole object as equality
      if (
        Object.keys(externalIdWhere).length === 0 &&
        Object.getOwnPropertySymbols(externalIdWhere).length === 0
      ) {
        externalIdWhere = rawVal;
      }
    } else {
      // Simple equality
      externalIdWhere = rawVal;
    }

    // For complex operators (objects with Symbol keys), we need to use a different approach
    // The $alias.field$ syntax doesn't work well with operators in Sequelize
    // Instead, we'll add the where clause to the include definition
    const hasOperators =
      typeof externalIdWhere === 'object' &&
      !Array.isArray(externalIdWhere) &&
      Object.getOwnPropertySymbols(externalIdWhere).length > 0;

    if (hasOperators) {
      // Use include-level where clause for operators
      const predicate = {};
      predicate.__requiredInclude = {
        model: fkMapping.targetModel,
        as: alias,
        attributes: [],
        required: false,
        where: {
          [fkMapping.idField]: externalIdWhere,
        },
      };
      return predicate;
    } else {
      // Use $alias.field$ syntax for simple equality
      const predicate = {
        [`$${alias}.${fkMapping.idField}$`]: externalIdWhere,
      };

      predicate.__requiredInclude = {
        model: fkMapping.targetModel,
        as: alias,
        attributes: [],
        required: false,
      };

      return predicate;
    }
  }

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

function transformOperatorValue(operatorKey, value) {
  if (operatorKey === 'contains' || operatorKey === 'not_contains') {
    return `%${value}%`;
  }
  if (operatorKey === 'icontains' || operatorKey === 'not_icontains') {
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

  if (Reflect.ownKeys(sequelizeOperators).length === 0) {
    return {};
  }

  if (!Array.isArray(rawVal.in) && rawVal.in !== undefined) {
    const valueToValidate = (rawVal && rawVal.in && rawVal.in[0]) || rawVal.in;
    if (!validateDataType(validateModel, validateColumn, valueToValidate)) {
      return { error: `Invalid value for '${key}'` };
    }
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
  // Handle both string keys and symbol keys (for Sequelize operators)
  const stringKeys = Object.keys(source);
  const symbolKeys = Object.getOwnPropertySymbols(source);
  const allKeys = [...stringKeys, ...symbolKeys];

  for (const key of allKeys) {
    if (
      target[key] &&
      typeof target[key] === 'object' &&
      typeof source[key] === 'object'
    ) {
      target[key] = Object.assign({}, target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

function processAndFilters(
  filters,
  model,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const parts = [];

  for (const item of filters.and) {
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
  const parts = [];

  for (const item of filters.or) {
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

  if (parts.length === 0) {
    return {};
  }

  return { [Op.or]: parts };
}

function processImplicitAndFilters(
  filters,
  model,
  Op,
  includes,
  relationIdMapping,
  flattening
) {
  const keys = Object.keys(filters);
  const andParts = [];
  const requiredIncludes = [];

  for (const key of keys) {
    if (key === 'and' || key === 'or') {
      continue;
    }

    const value = filters[key];

    if (key === 'and' && Array.isArray(value)) {
      continue;
    }
    if (key === 'or' && Array.isArray(value)) {
      continue;
    }

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
      // Extract required include if present
      if (predicate.__requiredInclude) {
        requiredIncludes.push(predicate.__requiredInclude);
        delete predicate.__requiredInclude;
      }

      andParts.push(predicate);
    }
  }

  if (andParts.length === 0) {
    return requiredIncludes.length > 0
      ? { __whereTree: {}, __requiredIncludes: requiredIncludes }
      : {};
  }

  let result;
  if (andParts.length === 1) {
    result = andParts[0];
  } else {
    const merged = {};
    for (const part of andParts) {
      mergeObjectProperties(merged, part);
    }
    result = merged;
  }

  if (requiredIncludes.length > 0) {
    return {
      __whereTree: result,
      __requiredIncludes: requiredIncludes,
    };
  }

  return result;
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
  const orderClauses = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const column = extractOrderColumn(item);
    if (!column) {
      continue;
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
      return flattenedResult;
    }
    if (flattenedResult.processed) {
      orderClauses.push(flattenedResult.orderClause);
      continue;
    }

    const includesResult = processOrderItemForIncludes(
      columnName,
      model,
      includes,
      relationIdMapping,
      direction
    );
    if (includesResult.error) {
      return includesResult;
    }
    if (includesResult.processed) {
      orderClauses.push(includesResult.orderClause);
      continue;
    }

    if (!validateColumnExists(model, columnName)) {
      return { error: `Invalid order column '${columnName}'` };
    }
    orderClauses.push([columnName, direction]);
  }

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
  const merged = Object.assign({}, SEARCH_DEFAULTS, searchOptions || {});

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
      const { page, pageSize } = processPaging(paging, options.defaultPageSize);
      req.apialize.options.limit = pageSize;
      req.apialize.options.offset = (page - 1) * pageSize;

      const includes = getIncludesFromContext(req, model);

      const whereTree = buildWhere(
        model,
        filters || {},
        Op,
        includes,
        options.relationIdMapping
      );
      if (whereTree && whereTree.__error) {
        logBadRequest('Search bad request', whereTree.__error, body, req);
        context.res.status(400).json({ success: false, error: 'Bad request' });
        return;
      }

      if (Reflect.ownKeys(whereTree).length) {
        req.apialize.options.where = Object.assign(
          {},
          req.apialize.options.where || {},
          whereTree
        );
      }

      const orderArray = buildOrdering(
        model,
        ordering,
        options.defaultOrderBy,
        options.defaultOrderDir,
        options.idMapping,
        includes,
        options.relationIdMapping
      );

      if (orderArray && orderArray.error) {
        logBadRequest('Search bad request', orderArray.error, body, req);
        context.res.status(400).json({ success: false, error: 'Bad request' });
        return;
      }

      req.apialize.options.order = orderArray;

      const result = await model.findAndCountAll(req.apialize.options);

      const normalizeRowsFn = async (rows, idMappingParam) => {
        return await normalizeRowsWithForeignKeys(
          rows,
          idMappingParam,
          options.relationIdMapping,
          model
        );
      };

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
        normalizeRowsFn
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

function hasIncludedFieldsInFilters(filters) {
  if (!filters || typeof filters !== 'object') {
    return false;
  }

  if (Array.isArray(filters.and)) {
    return filters.and.some((item) => hasIncludedFieldsInFilters(item));
  }

  if (Array.isArray(filters.or)) {
    return filters.or.some((item) => hasIncludedFieldsInFilters(item));
  }

  const keys = Object.keys(filters);
  for (const key of keys) {
    if (key === 'and' || key === 'or') {
      continue;
    }
    if (typeof key === 'string' && key.includes('.')) {
      return true;
    }
  }

  return false;
}

function hasIncludedFieldsInOrdering(ordering) {
  if (!ordering) {
    return false;
  }

  const items = Array.isArray(ordering) ? ordering : [ordering];

  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const column = item.order_by || item.orderby || item.column || item.field;
    if (typeof column === 'string' && column.includes('.')) {
      return true;
    }
  }

  return false;
}

function configureSubqueryOptions(config, filters, ordering, req) {
  if (!config.disableSubqueryOnIncludeRequest) {
    return;
  }

  const hasIncludedFiltering = hasIncludedFieldsInFilters(filters);
  const hasIncludedOrdering = hasIncludedFieldsInOrdering(ordering);
  const hasFlattening = !!config.flattening;

  if (hasIncludedFiltering || hasIncludedOrdering || hasFlattening) {
    req.apialize.options.subQuery = false;
  }
}

async function processSearchRequest(context, config, req, res) {
  const body = (req && req.body) || {};
  const { filters, ordering, paging } = extractSearchParameters(body);

  const mergedReqOptions = mergeReqOptionsIntoModelOptions(
    req,
    context.modelOptions
  );
  req.apialize.options = mergedReqOptions;

  const includes = getIncludesFromContext(req, context.model);

  // Validate flattening config if provided
  if (config.flattening) {
    const { validateFlatteningConfig } = require('../listUtils');
    const validation = validateFlatteningConfig(
      config.flattening,
      context.model,
      includes
    );

    if (!validation.isValid) {
      logBadRequest(
        'Flattening validation failed',
        validation.error,
        body,
        req
      );
      throw new ValidationError('Bad request');
    }

    // If include was auto-created, update the request options
    if (validation.autoCreated) {
      req.apialize.options.include = includes;
    }
  }

  const Op = getSequelizeOp(context.model);
  const { page, pageSize } = processPaging(paging, config.defaultPageSize);

  req.apialize.options.limit = pageSize;
  req.apialize.options.offset = (page - 1) * pageSize;

  configureSubqueryOptions(config, filters, ordering, req);

  const whereResult = buildWhere(
    context.model,
    filters || {},
    Op,
    includes,
    config.relation_id_mapping,
    config.flattening
  );

  let whereTree = whereResult;
  let requiredIncludes = [];

  // Check if buildWhere returned additional includes needed for FK reverse mapping
  if (whereResult && whereResult.__whereTree) {
    whereTree = whereResult.__whereTree;
    requiredIncludes = whereResult.__requiredIncludes || [];
  }

  if (whereTree && whereTree.__error) {
    logBadRequest('Search bad request', whereTree.__error, body, req);
    throw new ValidationError('Bad request');
  }

  // Add any required includes for FK reverse mapping
  if (requiredIncludes.length > 0) {
    const currentIncludes = req.apialize.options.include || [];
    const includeMap = new Map();

    // Index existing includes by association name
    currentIncludes.forEach((inc) => {
      const key = inc.as || (inc.association && inc.association.as);
      if (key) {
        includeMap.set(key, inc);
      }
    });

    // Add new required includes or merge where clauses if include already exists
    requiredIncludes.forEach((reqInc) => {
      const key = reqInc.as || (reqInc.association && reqInc.association.as);
      if (key) {
        const existing = includeMap.get(key);
        if (existing) {
          // Merge where clauses
          if (reqInc.where) {
            if (existing.where) {
              // Both have where clauses - merge them
              existing.where = Object.assign({}, existing.where, reqInc.where);
            } else {
              // Only new one has where clause
              existing.where = reqInc.where;
            }
          }
          // Keep attributes minimal for filtering
          if (reqInc.attributes && reqInc.attributes.length === 0) {
            existing.attributes = [];
          }
        } else {
          // New include
          currentIncludes.push(reqInc);
          includeMap.set(key, reqInc);
        }
      }
    });

    req.apialize.options.include = currentIncludes;

    // Disable subqueries when using FK reverse mapping with $alias.field$ syntax
    // This prevents "missing FROM-clause entry" errors
    if (config.disableSubqueryOnIncludeRequest) {
      req.apialize.options.subQuery = false;
    }
  }

  if (Reflect.ownKeys(whereTree).length) {
    const existingWhere = req.apialize.options.where || {};

    if (config.flattening) {
      const cleanedWhere = {};
      for (const [key, value] of Object.entries(existingWhere)) {
        const isFlattened = isFlattenedField(key, config.flattening);
        if (!isFlattened) {
          cleanedWhere[key] = value;
        }
      }
      req.apialize.options.where = Object.assign({}, cleanedWhere, whereTree);
    } else {
      req.apialize.options.where = Object.assign({}, existingWhere, whereTree);
    }
  }

  const orderArray = buildOrdering(
    context.model,
    ordering,
    config.defaultOrderBy,
    config.defaultOrderDir,
    config.id_mapping,
    includes,
    config.relation_id_mapping,
    config.flattening
  );

  if (orderArray && orderArray.error) {
    logBadRequest('Search bad request', orderArray.error, body, req);
    throw new ValidationError('Bad request');
  }

  req.apialize.options.order = orderArray;

  const result = await context.model.findAndCountAll(req.apialize.options);

  const normalizeRowsFn = async (rows, idMappingParam) => {
    return await normalizeRowsWithForeignKeys(
      rows,
      idMappingParam,
      config.relation_id_mapping,
      context.model
    );
  };

  const response = await buildResponse(
    result,
    page,
    pageSize,
    undefined,
    false,
    config.metaShowOrdering,
    false,
    req,
    config.id_mapping,
    normalizeRowsFn,
    config.flattening
  );

  return response;
}

module.exports = {
  processSearchRequest,
};
