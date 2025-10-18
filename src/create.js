const { express, apializeContext, ensureFn, asyncHandler } = require("./utils");
const {
  withTransactionAndHooks,
  optionsWithTransaction,
} = require("./operationUtils");

function create(model, options = {}, modelOptions = {}) {
  ensureFn(model, "create");
  const {
    middleware = [],
    id_mapping = "id",
    pre = null,
    post = null,
  } = options;
  const inline = middleware.filter((fn) => typeof fn === "function");
  const router = express.Router({ mergeParams: true });
  router.post(
    "/",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
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
          const createOptions = optionsWithTransaction(
            { ...modelOptions, ...req.apialize.options },
            context.transaction,
          );
          const created = await model.create(
            req.apialize.values,
            createOptions,
          );
          context.created = created;
          let idValue;
          if (created && typeof created.get === "function") {
            idValue = created.get(id_mapping);
          }
          if (typeof idValue === "undefined") {
            idValue =
              (created && created[id_mapping]) ??
              (created?.dataValues && created.dataValues[id_mapping]);
          }
          if (typeof idValue === "undefined") {
            idValue = created?.id ?? created?.dataValues?.id;
          }

          context.payload = { success: true, id: idValue };
          return context.payload;
        },
      );
      if (!res.headersSent) {
        res.status(201).json(payload);
      }
    }),
  );
  router.apialize = {};
  return router;
}

module.exports = create;
