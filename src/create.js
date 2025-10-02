const { express, apializeContext, ensureFn, asyncHandler } = require("./utils");

function create(model, options = {}, modelOptions = {}) {
  ensureFn(model, "create");
  const { middleware = [] } = options;
  const inline = middleware.filter((fn) => typeof fn === "function");
  const router = express.Router({ mergeParams: true });
  router.post(
    "/",
    apializeContext,
    ...inline,
    asyncHandler(async (req, res) => {
      // Merge model options with request options
      const createOptions = { ...modelOptions, ...req.apialize.options };
      const created = await model.create(
        req.apialize.values,
        createOptions,
      );
      const idValue = created?.id ?? created?.dataValues?.id;
      res.status(201).json({ success: true, id: idValue });
    }),
  );
  router.apialize = {};
  return router;
}

module.exports = create;
