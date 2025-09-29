/**
 * apialize
 * Build Express CRUD routes from a model exposing the following REQUIRED methods:
 *
 *   findAndCountAll(options)
 *   findOne(options)
 *   create(values, options)
 *   update(values, options)
 *   destroy(options)
 *
 * Expected (Sequelize-like) semantics, but any adapter implementing the same surface should work.
 *
 * Exported helpers each return an express.Router instance mapping to:
 *   list()    -> GET    /
 *   single()  -> GET    /:id
 *   create()  -> POST   /
 *   update()  -> PUT    /:id (full replace)
 *   patch()   -> PATCH  /:id (partial update)
 *   destroy() -> DELETE /:id
 */
const express = require("express");

// Internal middleware to ensure req.apialize exists with base options
function apializeContext(req, res, next) {
  // Preserve any existing req.apialize (e.g., set by earlier auth/ownership middleware)
  const existing = req.apialize || {};
  const existingOptions = existing.options || {};
  const existingValues = existing.values || {};
  // Merge query params into where only if not already defined (do not clobber ownership filters)
  const mergedWhere = { ...(existingOptions.where || {}) };
  for (const [k, v] of Object.entries(req.query || {})) {
    // Skip reserved api:* control keys
    if (k === "api:page" || k === "api:pagesize" || k === "api:orderby" || k === "api:orderdir") continue;
    if (typeof mergedWhere[k] === "undefined") mergedWhere[k] = v;
  }
  req.apialize = {
    ...existing,
    options: { ...existingOptions, where: mergedWhere },
    values: { ...existingValues, ...req.body },
  };
  next();
}

function ensureFn(obj, name) {
  if (!obj || typeof obj[name] !== "function") {
    throw new Error(`Model is missing required method: ${name}()`);
  }
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function defaultNotFound(res) {
  res.status(404).json({ success: false, error: "Not Found" });
}

// Legacy normalizeArgs removed: helpers now accept (model, ...middlewares)

// Determine identifier attribute for a model.
// Precedence:
// 1. model.apialize && string model.apialize.id_attribute
// 2. First primary key in rawAttributes not named 'id'
// 3. 'id'
function getIdField(model) {
  if (
    model &&
    model.apialize &&
    typeof model.apialize.id_attribute === "string" &&
    model.apialize.id_attribute.trim()
  ) {
    return model.apialize.id_attribute.trim();
  }
  if (model && model.rawAttributes) {
    const pkAttr = Object.values(model.rawAttributes).find((a) => a.primaryKey);
    if (pkAttr && pkAttr.fieldName && pkAttr.fieldName !== "id") {
      return pkAttr.fieldName;
    }
  }
  return "id";
}

// GET /
function list(model, ...middlewares) {
  const idField = getIdField(model);
  ensureFn(model, "findAndCountAll");
  const router = express.Router({ mergeParams: true });
  const inline = middlewares.filter((fn) => typeof fn === "function");
  router.get(
    "/",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
  // Pagination: derive from query params with model defaults (page default 1)
  const q = req.query || {};
  const modelCfg = (model && model.apialize) || {};
  let page = parseInt(q["api:page"], 10);
  if (isNaN(page) || page < 1) page = 1;
  const defaultPageSize = Number.isInteger(modelCfg.page_size) && modelCfg.page_size > 0 ? modelCfg.page_size : 100;
  let pageSize = parseInt(q["api:pagesize"], 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = defaultPageSize;
      // Apply to options (do not mutate original object reference unexpectedly)
      req.apialize.options.limit = pageSize;
      req.apialize.options.offset = (page - 1) * pageSize;

      // Ordering
      const rawOrderBy = q["api:orderby"] || modelCfg.orderby;
      const globalDir = (q["api:orderdir"] || modelCfg.orderdir || "ASC").toString().toUpperCase();
      if (rawOrderBy) {
        const fields = rawOrderBy.split(",").map((s) => s.trim()).filter(Boolean);
        const order = [];
        for (const f of fields) {
          if (!f) continue;
          if (f.startsWith("-")) {
            order.push([f.slice(1), "DESC"]);
          } else if (f.startsWith("+")) {
            order.push([f.slice(1), "ASC"]);
          } else {
            order.push([f, globalDir === "DESC" ? "DESC" : "ASC"]);
          }
        }
        if (order.length) {
          req.apialize.options.order = order;
        }
      }
      // Default ordering if none specified (stable deterministic pagination) -> model orderby fallback or id
      if (!req.apialize.options.order) {
        if (modelCfg.orderby) {
          // interpret single default orderby string (already processed above if rawOrderBy existed). If we reach here, treat as single ASC/DESC by globalDir.
          req.apialize.options.order = [[modelCfg.orderby, globalDir === "DESC" ? "DESC" : "ASC"]];
        } else {
          req.apialize.options.order = [[idField, "ASC"]];
        }
      }

      const result = await model.findAndCountAll(req.apialize.options);
      // Map rows so idField (custom) becomes 'id'
      const rows = Array.isArray(result.rows)
        ? result.rows.map((r) => {
            if (!r || typeof r !== "object") return r;
            const plain = r.get ? r.get({ plain: true }) : { ...r };
            if (
              idField !== "id" &&
              Object.prototype.hasOwnProperty.call(plain, idField)
            ) {
              plain.id = plain[idField];
              delete plain[idField];
            }
            return plain;
          })
        : result.rows;
      const totalPages = Math.max(1, Math.ceil(result.count / pageSize));
      const orderOut = Array.isArray(req.apialize.options.order)
        ? req.apialize.options.order.map((o) => {
            if (Array.isArray(o)) return [o[0], (o[1] || "ASC").toUpperCase()];
            if (typeof o === "string") return [o, "ASC"]; // string shorthand
            return o;
          })
        : [];
      res.json({
        success: true,
        meta: {
          page,
          page_size: pageSize,
          // Keep total_pages >= 1 even if empty set
          total_pages: totalPages,
          count: result.count,
          order: orderOut,
        },
        data: rows,
      });
    }),
  );
  // Expose idField for downstream (optional)
  router.apialize = { idField };
  return router;
}

// GET /:id
function single(model, ...middlewares) {
  const idField = getIdField(model);
  ensureFn(model, "findOne");
  const router = express.Router({ mergeParams: true });
  router.get(
    `/:id`,
    apializeContext,
    ...middlewares.filter((fn) => typeof fn === "function"),
    asyncHandler(async (req, res) => {
      // Ensure the apialize context includes id for model adapters expecting explicit id
      req.apialize.id = req.params.id; // kept for backwards compat
      if (!req.apialize.where) req.apialize.where = {};
      if (typeof req.apialize.where[idField] === "undefined") {
        req.apialize.where[idField] = req.params.id;
      }
      // Combine any access-control filters provided via req.apialize.options.where
      const baseWhere =
        (req.apialize.options && req.apialize.options.where) || {};
      const fullWhere = { ...baseWhere, ...req.apialize.where };
      const result = await model.findOne({ where: fullWhere });
      if (result === null || typeof result === "undefined") {
        return defaultNotFound(res);
      }
      let payload = result;
      if (payload && typeof payload === "object") {
        const plain = payload.get
          ? payload.get({ plain: true })
          : { ...payload };
        if (
          idField !== "id" &&
          Object.prototype.hasOwnProperty.call(plain, idField)
        ) {
          plain.id = plain[idField];
          delete plain[idField];
        }
        payload = plain;
      }
      res.json(payload);
    }),
  );
  router.apialize = { idField };
  return router;
}

// POST /
function create(model, ...middlewares) {
  const idField = getIdField(model);
  ensureFn(model, "create");
  const router = express.Router({ mergeParams: true });
  const inline = middlewares.filter((fn) => typeof fn === "function");
  router.post(
    "/",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const created = await model.create(
        req.apialize.values,
        req.apialize.options,
      );
      const idValue = created?.[idField] ?? created?.dataValues?.[idField];
      res.status(201).json({ success: true, id: idValue });
    }),
  );
  router.apialize = { idField };
  return router;
}

// PUT /:id
function update(model, ...middlewares) {
  const idField = getIdField(model);
  ensureFn(model, "update");
  const router = express.Router({ mergeParams: true });
  const inline = middlewares.filter((fn) => typeof fn === "function");
  router.put(
    "/:id",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      // Merge ownership / access filters if present
      const ownershipWhere =
        (req.apialize.options && req.apialize.options.where) || {};
      var existing = await model.findOne({
        where: { ...ownershipWhere, [idField]: req.params.id },
      });

      if (!existing) {
        return defaultNotFound(res);
      }

      // Build full replacement object
      const allAttrs = Object.keys(existing.constructor.rawAttributes).filter(
        (a) =>
          a !== idField &&
          !existing.constructor.rawAttributes[a]._autoGenerated,
      );

      const nextValues = {};
      for (const attr of allAttrs) {
        if (Object.prototype.hasOwnProperty.call(req.body, attr)) {
          nextValues[attr] = req.body[attr];
        } else {
          // Decide: null, leave out, or defaultValue
          const def = existing.constructor.rawAttributes[attr].defaultValue;
          nextValues[attr] = typeof def !== "undefined" ? def : null;
        }
      }

      // Keep id
      nextValues[idField] = req.params.id;

      // Perform update (instance form to ensure all fields written)
      existing.set(nextValues);
      // Ensure save respects ownership filter by validating instance still matches (lightweight check)
      if (ownershipWhere && Object.keys(ownershipWhere).length) {
        for (const [k, v] of Object.entries(ownershipWhere)) {
          if (existing[k] !== v) {
            return defaultNotFound(res);
          }
        }
      }
      await existing.save({ fields: Object.keys(nextValues) });

      let plain = existing.get
        ? existing.get({ plain: true })
        : { ...existing };
      if (
        idField !== "id" &&
        Object.prototype.hasOwnProperty.call(plain, idField)
      ) {
        plain.id = plain[idField];
        delete plain[idField];
      }
      res.json(plain);
    }),
  );
  router.apialize = { idField };
  return router;
}

// PATCH /:id
function patch(model, ...middlewares) {
  const idField = getIdField(model);
  ensureFn(model, "update");
  const router = express.Router({ mergeParams: true });
  const inline = middlewares.filter((fn) => typeof fn === "function");
  router.patch(
    "/:id",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const id = req.params.id;

      // Gather provided fields (prefer req.apialize.body, fallback to values/body)
      const provided =
        (req.apialize && (req.apialize.body || req.apialize.values)) ||
        req.body ||
        {};

      // Do not allow id overwrite
      if (idField in provided) {
        delete provided[idField];
      }

      // Use model rawAttributes (no need to load full instance)
      const rawAttrs =
        model.rawAttributes ||
        (model.prototype && model.prototype.rawAttributes) ||
        {};
      const updatableKeys = Object.keys(provided).filter(
        (k) =>
          Object.prototype.hasOwnProperty.call(rawAttrs, k) &&
          k !== idField &&
          !rawAttrs[k]?._autoGenerated,
      );

      // If nothing to change, just verify the record exists (lightweight)
      if (updatableKeys.length === 0) {
        const exists = await model.findOne({
          where: { [idField]: id },
          attributes: [idField],
        });
        if (!exists) {
          return defaultNotFound(res);
        }
        return res.json({ success: true, [idField]: id });
      }

      // Perform partial update without fetching full row
      const ownershipWhere =
        (req.apialize.options && req.apialize.options.where) || {};
      const [affected] = await model.update(provided, {
        where: { ...ownershipWhere, [idField]: id },
        fields: updatableKeys,
      });

      if (!affected) {
        return defaultNotFound(res);
      }

      res.json({ success: true, id: id });
    }),
  );
  router.apialize = { idField };
  return router;
}

// DELETE /:id
function destroy(model, ...middlewares) {
  const idField = getIdField(model);
  ensureFn(model, "destroy");
  const router = express.Router({ mergeParams: true });
  const inline = middlewares.filter((fn) => typeof fn === "function");
  router.delete(
    "/:id",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const ownershipWhere =
        (req.apialize.options && req.apialize.options.where) || {};
      const affected = await model.destroy({
        where: { ...ownershipWhere, [idField]: id },
      });
      if (!affected) {
        return defaultNotFound(res);
      }
      res.json({ success: true, id: id });
    }),
  );
  router.apialize = { idField };
  return router;
}

// Combined CRUD router (no explicit idField config). Options: { middlewares?, routes?: { list, single, create, update, patch, destroy } }
function crud(model, options = {}) {
  const { middlewares = [], routes = {} } = options || {};
  const router = express.Router({ mergeParams: true });
  const collect = (arr) => [...middlewares, ...(arr || [])];
  router.use(list(model, ...collect(routes.list)));
  router.use(single(model, ...collect(routes.single)));
  router.use(create(model, ...collect(routes.create)));
  router.use(update(model, ...collect(routes.update)));
  router.use(patch(model, ...collect(routes.patch)));
  router.use(destroy(model, ...collect(routes.destroy)));
  return router;
}

module.exports = {
  crud,
  list,
  single,
  create,
  update,
  patch,
  destroy,
  apializeContext,
};
