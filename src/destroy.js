const {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  defaultNotFound,
} = require("./utils");

function destroy(model, options = {}, modelOptions = {}) {
  ensureFn(model, "destroy");
  const { middleware = [], id_mapping = 'id' } = options;
  const inline = middleware.filter((fn) => typeof fn === "function");
  const router = express.Router({ mergeParams: true });
  router.delete(
    "/:id",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const ownershipWhere =
        (req.apialize.options && req.apialize.options.where) || {};
      
      // Merge model options for destroy operation
      const destroyOptions = {
        ...modelOptions,
        where: { ...ownershipWhere, [id_mapping]: id },
      };
      const affected = await model.destroy(destroyOptions);
      if (!affected) return defaultNotFound(res);
      res.json({ success: true, id });
    }),
  );
  router.apialize = {};
  return router;
}

module.exports = destroy;
