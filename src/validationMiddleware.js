// Import asyncHandler from utils - but we'll implement our own to avoid circular dependency
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Creates a validation middleware that runs Sequelize model validations
 * before other middleware when the 'validate' option is enabled.
 * 
 * @param {Object} model - The Sequelize model to validate against
 * @param {Object} options - Options object that may contain validation settings
 * @returns {Function} Express middleware function
 */
function createValidationMiddleware(model, options = {}) {
  return asyncHandler(async (req, res, next) => {
    // Skip validation if not enabled
    if (!options.validate) {
      return next();
    }

    // Skip validation if no body data to validate
    if (!req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0)) {
      return next();
    }

    try {
      // Handle bulk operations (arrays)
      if (Array.isArray(req.body)) {
        for (let i = 0; i < req.body.length; i++) {
          const item = req.body[i];
          if (item && typeof item === 'object') {
            // Create a temporary instance for validation without saving
            const instance = model.build(item);
            await instance.validate();
          }
        }
      } else {
        // Handle single object validation
        // For patch operations, only validate the fields that are being updated
        const isPatchOperation = req.method === 'PATCH';
        
        if (isPatchOperation) {
          // For PATCH, validate only the fields being provided
          const fieldsToValidate = Object.keys(req.body);
          const instance = model.build(req.body);
          
          // Validate only the specified fields
          await instance.validate({ fields: fieldsToValidate });
        } else {
          // For other operations, validate the entire object
          const instance = model.build(req.body);
          await instance.validate();
        }
      }

      // If we get here, validation passed
      next();
    } catch (error) {
      // Handle Sequelize validation errors
      if (error.name === 'SequelizeValidationError') {
        const validationErrors = error.errors.map(err => ({
          field: err.path,
          message: err.message,
          value: err.value
        }));

        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validationErrors
        });
      }

      // Handle other Sequelize errors that might occur during validation
      if (error.name && error.name.startsWith('Sequelize')) {
        return res.status(400).json({
          success: false,
          error: error.message || 'Validation error'
        });
      }

      // For any other unexpected errors, pass them along
      throw error;
    }
  });
}

module.exports = {
  createValidationMiddleware
};