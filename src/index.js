// Public barrel file re-exporting separated route helpers & utilities.
// Keeping original names / CommonJS export shape for backwards compatibility.
const crud = require("./crud");
const list = require("./list");
const single = require("./single");
const create = require("./create");
const update = require("./update");
const patch = require("./patch");
const destroy = require("./destroy");
const { apializeContext } = require("./utils");

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
