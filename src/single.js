const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  defaultNotFound,
} = require("./utils");
const list = require("./list");
const create = require("./create");
const update = require("./update");
const patch = require("./patch");
const destroy = require("./destroy");
const {
  withTransactionAndHooks,
  optionsWithTransaction,
  normalizeId,
  notFoundWithRollback,
} = require("./operationUtils");

function setupRelatedEndpoints(
  router,
  parentModel,
  related,
  parentIdMapping,
  parentModelOptions,
  parentParamName = "id",
) {
  related.forEach((relatedConfig) => {
    if (!relatedConfig.model) {
      throw new Error(
        "Related model configuration must include a 'model' property",
      );
    }

    const {
      model: relatedModel,
      options: relatedOptions = {},
      perOperation = {}, // new: per-op overrides { list, get, post, put, patch, delete }
      foreignKey,
      path,
      operations = ["list", "get", "post", "put", "patch", "delete"], // Default: all operations
    } = relatedConfig;

    // Determine the path for the related endpoints (pluralized by default)
    const endpointPath = path || modelNameToPath(relatedModel.name);

    // Determine the foreign key that links to the parent model
    const relatedForeignKey =
      foreignKey || `${parentModel.name.toLowerCase()}_id`;

    // Resolve parent's internal id (primary key) honoring the param name for this nesting level
    const resolveParentInternalId = async (
      req,
      currentParamName = parentParamName,
      preferStored = false,
    ) => {
      // Choose id source depending on context: for reads use current route param first; for writes prefer stored parentId
      const parentParamId = preferStored
        ? ((req.apialize && req.apialize.parentId) ??
          req.params[currentParamName] ??
          req.params["id"])
        : (req.params[currentParamName] ??
          req.params["id"] ??
          (req.apialize && req.apialize.parentId));
      if (!parentParamId) return null;
      if ((parentIdMapping || "id") === "id") return parentParamId;
      // Find parent by its exposed identifier to obtain internal id
      const where = { [parentIdMapping || "id"]: parentParamId };
      const queryOptions = {
        where,
        attributes: ["id"],
        ...(parentModelOptions || {}),
      };
      try {
        const parent = await parentModel.findOne(queryOptions);
        return parent ? (parent.get ? parent.get("id") : parent.id) : null;
      } catch (_e) {
        return null;
      }
    };

    // Create middleware that filters related records by parent internal ID
    const parentFilterMiddlewareFactory = (
      paramName = parentParamName,
      preferStored = false,
    ) =>
      asyncHandler(async (req, res, next) => {
        if (!req.apialize) req.apialize = {};
        if (!req.apialize.options) req.apialize.options = {};
        if (!req.apialize.options.where) req.apialize.options.where = {};

        // Resolve parent internal id for this nesting level
        const parentInternalId = await resolveParentInternalId(
          req,
          paramName,
          preferStored,
        );
        // If not found, use impossible value to ensure empty matches (for list)
        req.apialize.options.where[relatedForeignKey] =
          parentInternalId ?? "__apialize_none__";
        next();
      });

    // Create middleware for write operations that sets the foreign key (param-aware)
    const setForeignKeyMiddlewareFactory = (
      paramName = parentParamName,
      preferStored = false,
    ) =>
      asyncHandler(async (req, res, next) => {
        if (["POST", "PUT", "PATCH"].includes(req.method)) {
          if (!req.apialize) req.apialize = {};
          if (!req.apialize.values) req.apialize.values = {};
          const parentInternalId = await resolveParentInternalId(
            req,
            paramName,
            preferStored,
          );
          if (parentInternalId == null) return defaultNotFound(res);
          req.apialize.values[relatedForeignKey] = parentInternalId;
        }
        next();
      });

    // Create middleware instances for read and write operations
    const parentFilterForRead = parentFilterMiddlewareFactory(
      parentParamName,
      false,
    ); // reads: prefer route param
    const parentFilterForWrite = parentFilterMiddlewareFactory(
      parentParamName,
      true,
    ); // writes: prefer stored parentId

    // Base middleware (per-op middleware will be appended later)
    const baseReadMiddleware = [
      parentFilterForRead,
      ...(relatedOptions.middleware || []),
    ];
    const baseWriteMiddleware = [
      parentFilterForWrite,
      setForeignKeyMiddlewareFactory(parentParamName, true),
      ...(relatedOptions.middleware || []),
    ];

    // Helper: merge base related options with per-operation overrides and base middleware
    const resolveOpConfig = (opName) => {
      const op = (perOperation && perOperation[opName]) || {};
      const isWrite =
        opName === "post" ||
        opName === "put" ||
        opName === "patch" ||
        opName === "delete";
      const baseMiddleware = isWrite ? baseWriteMiddleware : baseReadMiddleware;
      return {
        options: {
          ...relatedOptions,
          ...op,
          middleware: [...baseMiddleware, ...(op.middleware || [])],
        },
        modelOptions: op.modelOptions || relatedOptions.modelOptions || {},
        id_mapping: op.id_mapping || relatedOptions.id_mapping || "id",
        middleware: [...baseMiddleware, ...(op.middleware || [])],
        allow_bulk_delete:
          typeof op.allow_bulk_delete === "boolean"
            ? op.allow_bulk_delete
            : true,
      };
    };

    // Create a sub-router for all related operations
    const relatedRouter = express.Router({ mergeParams: true });

    // Middleware to capture parent id before inner route adds its own ":id"/":relatedId"
    const storeParentIdMiddleware = (req, _res, next) => {
      req.apialize = req.apialize || {};
      // Always set current level parent id to ensure deeper levels can reference the latest context if they rely on parentId
      req.apialize.parentId = req.params[parentParamName];
      next();
    };

    // LIST operation: GET /:id/related_things
    if (operations.includes("list")) {
      const { options: listOptions, modelOptions: listModelOptions } =
        resolveOpConfig("list");
      const relatedListRouter = list(
        relatedModel,
        listOptions,
        listModelOptions,
      );
      relatedRouter.use("/", relatedListRouter);
    }

    // CREATE operation: POST /:id/related_things
    if (operations.includes("post") || operations.includes("create")) {
      const { options: createOptions, modelOptions: postModelOptions } =
        resolveOpConfig("post");
      const relatedCreateRouter = create(
        relatedModel,
        createOptions,
        postModelOptions,
      );
      relatedRouter.use("/", relatedCreateRouter);
    }

    // SINGLE operation: GET /:id/related_things/:relatedId using built-in single() via a nested router
    if (operations.includes("get")) {
      const { options: getOptions, modelOptions: getModelOptions } =
        resolveOpConfig("get");
      // Configure child single to read ':relatedId' param and pass child related configs for true recursion
      const childSingleRouter = single(
        relatedModel,
        {
          ...getOptions,
          param_name: "relatedId",
          related: Array.isArray(relatedConfig.related)
            ? relatedConfig.related
            : [],
        },
        getModelOptions,
      );
      const nested = express.Router({ mergeParams: true });
      // Mount at '/' so inner single's '/:relatedId' is the only id segment
      nested.use("/", storeParentIdMiddleware, childSingleRouter);
      relatedRouter.use("/", nested);
    }

    // UPDATE operation: PUT /:id/related_things/:relatedId
    if (operations.includes("put") || operations.includes("update")) {
      const { options: updateOptions, modelOptions: putModelOptions } =
        resolveOpConfig("put");
      const relatedUpdateRouter = update(
        relatedModel,
        updateOptions,
        putModelOptions || {},
      );
      // Mount at "/" so inner router's ":id" becomes ":relatedId" at the edge
      // Capture parent id before inner router param overrides req.params.id
      relatedRouter.use("/", storeParentIdMiddleware, relatedUpdateRouter);
    }

    // PATCH operation: PATCH /:id/related_things/:relatedId
    if (operations.includes("patch")) {
      const { options: patchOptions, modelOptions: patchModelOptions } =
        resolveOpConfig("patch");
      const relatedPatchRouter = patch(
        relatedModel,
        patchOptions,
        patchModelOptions || {},
      );
      // Mount at "/" so inner router's ":id" becomes ":relatedId" at the edge
      (storeParentIdMiddleware,
        relatedRouter.use("/", storeParentIdMiddleware, relatedPatchRouter));
    }

    // DELETE operation: DELETE /:id/related_things/:relatedId
    if (operations.includes("delete") || operations.includes("destroy")) {
      const { options: destroyOptions, modelOptions: deleteModelOptions } =
        resolveOpConfig("delete");
      const relatedDestroyRouter = destroy(
        relatedModel,
        destroyOptions,
        deleteModelOptions || {},
      );
      // Mount at "/" so inner router's ":id" becomes ":relatedId" at the edge
      relatedRouter.use("/", storeParentIdMiddleware, relatedDestroyRouter);

      // Bulk DELETE on collection: DELETE /:id/related_things?confirm=true
      // Behavior: when confirm!=true, act as dry run and return the list of ids to be deleted
      //           when confirm==true, delete all scoped related records and return count and ids
      const {
        modelOptions: bulkDelModelOptions,
        id_mapping: bulkDelIdMapping,
        middleware: bulkDelMiddleware,
        allow_bulk_delete,
      } = resolveOpConfig("delete");
      if (allow_bulk_delete) {
        relatedRouter.delete(
          "/",
          storeParentIdMiddleware,
          apializeContext,
          ...bulkDelMiddleware,
          asyncHandler(async (req, res) => {
            // Determine confirmation flag
            const q = req.query || {};
            const confirmed = ["true", "1", "yes", "y"].includes(
              String(q.confirm).toLowerCase(),
            );

            // Where clause should already include parent FK scope from middleware
            const baseWhere =
              (req.apialize &&
                req.apialize.options &&
                req.apialize.options.where) ||
              {};
            // Strip out non-column query flags potentially merged by apializeContext
            if (Object.prototype.hasOwnProperty.call(baseWhere, "confirm")) {
              delete baseWhere.confirm;
            }

            // Fetch ids to be affected (respect id_mapping override)
            const findOptions = {
              ...bulkDelModelOptions,
              where: baseWhere,
              attributes: [bulkDelIdMapping],
            };
            const rows = await relatedModel.findAll(findOptions);
            const ids = rows.map((r) =>
              r && r.get ? r.get(bulkDelIdMapping) : r[bulkDelIdMapping],
            );

            if (!confirmed) {
              return res.json({ success: true, confirm_required: true, ids });
            }

            // Perform deletion
            try {
              const destroyOptions = {
                ...bulkDelModelOptions,
                where: baseWhere,
              };
              const deleted = await relatedModel.destroy(destroyOptions);
              return res.json({ success: true, deleted, ids });
            } catch (err) {
              // Surface error for debugging purposes
              console.error("[Apialize] Bulk delete error:", err);
              return res
                .status(500)
                .json({
                  success: false,
                  error: String((err && err.message) || err),
                });
            }
          }),
        );
      }
    }

    // Attach an error handler for related routes to surface middleware errors as JSON
    relatedRouter.use((err, _req, res, _next) => {
      // eslint-disable-next-line no-console
      console.error("[Apialize] Related route error:", err);
      res
        .status(500)
        .json({ success: false, error: String((err && err.message) || err) });
    });

    // Mount the related router
    router.use(`/:${parentParamName}/${endpointPath}`, relatedRouter);
    // Note: true recursion is handled by passing 'related' to the child single() above
  });
}

function modelNameToPath(modelName) {
  // Convert CamelCase/PascalCase to snake_case for URL paths
  const snakeCase = modelName
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, ""); // Remove leading underscore

  // Simple pluralization
  return pluralize(snakeCase);
}

function pluralize(word) {
  // Simple pluralization rules
  if (word.endsWith("y")) {
    return word.slice(0, -1) + "ies";
  } else if (
    word.endsWith("s") ||
    word.endsWith("sh") ||
    word.endsWith("ch") ||
    word.endsWith("x") ||
    word.endsWith("z")
  ) {
    return word + "es";
  } else {
    return word + "s";
  }
}

function single(model, options = {}, modelOptions = {}) {
  ensureFn(model, "findOne");
  const {
    middleware = [],
    id_mapping = "id",
    param_name = "id",
    related = [],
    pre = null,
    post = null,
  } = options;
  const inline = middleware.filter((fn) => typeof fn === "function");
  const router = express.Router({ mergeParams: true });

  // Main single record endpoint
  router.get(
    `/:${param_name}`,
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const paramValue = req.params[param_name];
      req.apialize.id = paramValue;
      if (!req.apialize.where) req.apialize.where = {};
      if (typeof req.apialize.where[id_mapping] === "undefined")
        req.apialize.where[id_mapping] = paramValue;
      // Merge modelOptions with any apialize options (which may be mutated by middleware)
      // Follow list() behavior: request-specific options should override base model options
      req.apialize.options = { ...modelOptions, ...(req.apialize.options || {}) };

      // Combine where clauses from modelOptions, existing req options, and the id-mapping constraint
      const modelWhere = (modelOptions && modelOptions.where) || {};
      const reqOptionsWhere =
        (req.apialize.options && req.apialize.options.where) || {};
      const fullWhere = { ...modelWhere, ...reqOptionsWhere, ...req.apialize.where };
      // Persist merged where back to req.apialize.options so hooks/transactions see it
      req.apialize.options.where = fullWhere;
      const payload = await withTransactionAndHooks(
        {
          model,
          options: { ...options, pre, post },
          req,
          res,
          modelOptions,
          idMapping: id_mapping,
          useReqOptionsTransaction: true,
        },
        async (context) => {
          const result = await model.findOne(req.apialize.options);
          if (result == null) {
            return notFoundWithRollback(context);
          }

          context.record = result;
          let recordPayload = result;
          if (recordPayload && typeof recordPayload === "object")
            recordPayload = recordPayload.get
              ? recordPayload.get({ plain: true })
              : { ...recordPayload };

          recordPayload = normalizeId(recordPayload, id_mapping);

          context.payload = { success: true, record: recordPayload };
          // Do not send the response here; return the payload so post hooks can run.
          return context.payload;
        },
      );

      // Send the response after hooks/transaction complete, unless already sent (e.g., 404 path)
      if (!res.headersSent) {
        res.json(payload);
      }
    }),
  );

  // Create related model endpoints
  if (Array.isArray(related) && related.length > 0) {
    // Propagate param_name to ensure child routes mount under the correct parent param segment
    setupRelatedEndpoints(
      router,
      model,
      related,
      id_mapping,
      modelOptions,
      param_name,
    );
  }

  router.apialize = {};
  return router;
}

module.exports = single;
