const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  defaultNotFound,
} = require("./utils");

function single(model, options = {}, modelOptions = {}) {
  ensureFn(model, "findOne");
  const { middleware = [], id_mapping = 'id' } = options;
  const inline = middleware.filter((fn) => typeof fn === "function");
  const router = express.Router({ mergeParams: true });
  router.get(
    "/:id",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      req.apialize.id = req.params.id;
      if (!req.apialize.where) req.apialize.where = {};
      if (typeof req.apialize.where[id_mapping] === "undefined")
        req.apialize.where[id_mapping] = req.params.id;
      const baseWhere =
        (req.apialize.options && req.apialize.options.where) || {};
      const fullWhere = { ...baseWhere, ...req.apialize.where };
      
      // Merge model options with where clause
      const queryOptions = { ...modelOptions, where: fullWhere };
      const result = await model.findOne(queryOptions);
      if (result == null) return defaultNotFound(res);
      let payload = result;
      if (payload && typeof payload === "object")
        payload = payload.get ? payload.get({ plain: true }) : { ...payload };
      res.json(payload);
    }),
  );
  router.apialize = {};
  return router;
}

module.exports = single;
