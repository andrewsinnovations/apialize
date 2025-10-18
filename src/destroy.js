const { express, apializeContext, ensureFn, asyncHandler } = require("./utils");
const {
  withTransactionAndHooks,
  optionsWithTransaction,
  notFoundWithRollback,
} = require("./operationUtils");

function destroy(model, options = {}, modelOptions = {}) {
  ensureFn(model, "destroy");
  const {
    middleware = [],
    id_mapping = "id",
    pre = null,
    post = null,
  } = options;
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

      const payload = await withTransactionAndHooks(
        {
          model,
          options: { ...options, pre, post },
          req,
          res,
          modelOptions,
          idMapping: id_mapping,
        },
        async (context) => {
          const destroyOptions = optionsWithTransaction(
            { ...modelOptions, where: { ...ownershipWhere, [id_mapping]: id } },
            context.transaction,
          );
          const affected = await model.destroy(destroyOptions);
          if (!affected) {
            return notFoundWithRollback(context);
          }
          context.payload = { success: true, id };
          return context.payload;
        },
      );
      if (!res.headersSent) {
        res.json(payload);
      }
    }),
  );
  router.apialize = {};
  return router;
}

module.exports = destroy;
