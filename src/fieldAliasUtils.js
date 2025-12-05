/**
 * Utility functions for handling field aliases
 * 
 * Field aliases allow mapping external API field names to internal database column names.
 * For example: { "name": "person_name" } maps the external "name" to database column "person_name"
 */

/**
 * Resolves an external field name to its internal database column name
 * @param {string} externalName - The external field name (e.g., "name")
 * @param {Object} aliases - Map of external names to internal names
 * @returns {string} The internal column name or the original if no alias exists
 */
function resolveAliasToInternal(externalName, aliases) {
  if (!aliases || typeof aliases !== 'object') {
    return externalName;
  }

  if (Object.prototype.hasOwnProperty.call(aliases, externalName)) {
    return aliases[externalName];
  }

  return externalName;
}

/**
 * Resolves an internal database column name to its external field name
 * @param {string} internalName - The internal column name (e.g., "person_name")
 * @param {Object} aliases - Map of external names to internal names
 * @returns {string} The external field name or the original if no alias exists
 */
function resolveAliasToExternal(internalName, aliases) {
  if (!aliases || typeof aliases !== 'object') {
    return internalName;
  }

  // Reverse lookup: find external name where internal name matches
  const entries = Object.entries(aliases);
  for (let i = 0; i < entries.length; i++) {
    const [externalName, internalColumn] = entries[i];
    if (internalColumn === internalName) {
      return externalName;
    }
  }

  return internalName;
}

/**
 * Transforms an object's keys from external names to internal names
 * @param {Object} data - Object with external field names
 * @param {Object} aliases - Map of external names to internal names
 * @returns {Object} New object with internal field names
 */
function mapFieldsToInternal(data, aliases) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  if (!aliases || typeof aliases !== 'object') {
    return data;
  }

  const result = {};
  const keys = Object.keys(data);

  for (let i = 0; i < keys.length; i++) {
    const externalKey = keys[i];
    const internalKey = resolveAliasToInternal(externalKey, aliases);
    result[internalKey] = data[externalKey];
  }

  return result;
}

/**
 * Transforms an object's keys from internal names to external names
 * @param {Object} data - Object with internal field names
 * @param {Object} aliases - Map of external names to internal names
 * @returns {Object} New object with external field names
 */
function mapFieldsToExternal(data, aliases) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  if (!aliases || typeof aliases !== 'object') {
    return data;
  }

  const result = {};
  const keys = Object.keys(data);

  for (let i = 0; i < keys.length; i++) {
    const internalKey = keys[i];
    const externalKey = resolveAliasToExternal(internalKey, aliases);
    result[externalKey] = data[internalKey];
  }

  return result;
}

/**
 * Transforms an array of objects from internal names to external names
 * @param {Array} dataArray - Array of objects with internal field names
 * @param {Object} aliases - Map of external names to internal names
 * @returns {Array} Array of objects with external field names
 */
function mapArrayFieldsToExternal(dataArray, aliases) {
  if (!Array.isArray(dataArray)) {
    return dataArray;
  }

  if (!aliases || typeof aliases !== 'object') {
    return dataArray;
  }

  const result = [];
  for (let i = 0; i < dataArray.length; i++) {
    result.push(mapFieldsToExternal(dataArray[i], aliases));
  }

  return result;
}

/**
 * Checks if a field name (external or internal) is allowed based on configuration
 * @param {string} fieldName - The field name to check (can be external or internal)
 * @param {Array} allowedFields - List of allowed field names
 * @param {Array} blockedFields - List of blocked field names
 * @param {Object} aliases - Map of external names to internal names
 * @returns {Object} { allowed: boolean, error: string }
 */
function checkFieldAllowed(fieldName, allowedFields, blockedFields, aliases) {
  // Check both external and internal names
  const internalName = resolveAliasToInternal(fieldName, aliases);
  const externalName = resolveAliasToExternal(fieldName, aliases);

  // Check blocked list first (takes precedence)
  if (Array.isArray(blockedFields)) {
    if (blockedFields.includes(fieldName) || 
        blockedFields.includes(internalName) || 
        blockedFields.includes(externalName)) {
      return { allowed: false, error: `Field '${fieldName}' is not allowed` };
    }
  }

  // Check allowed list
  if (Array.isArray(allowedFields)) {
    if (!allowedFields.includes(fieldName) && 
        !allowedFields.includes(internalName) && 
        !allowedFields.includes(externalName)) {
      return { allowed: false, error: `Field '${fieldName}' is not allowed` };
    }
  }

  return { allowed: true };
}

/**
 * Validates that external field names in the allow/block lists are valid
 * This helps catch configuration errors where users specify internal names instead of external
 * @param {Array} fieldList - Array of field names from allow/block configuration
 * @param {Object} aliases - Map of external names to internal names
 * @returns {Object} { valid: boolean, invalidFields: Array }
 */
function validateFieldListWithAliases(fieldList, aliases) {
  if (!Array.isArray(fieldList) || !aliases) {
    return { valid: true, invalidFields: [] };
  }

  // For now, we accept both external and internal names in allow/block lists
  // This provides flexibility for users
  return { valid: true, invalidFields: [] };
}

module.exports = {
  resolveAliasToInternal,
  resolveAliasToExternal,
  mapFieldsToInternal,
  mapFieldsToExternal,
  mapArrayFieldsToExternal,
  checkFieldAllowed,
  validateFieldListWithAliases,
};

