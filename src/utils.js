const express = require("express");

function apializeContext(req, res, next) {
  const existing = req.apialize || {};
  const existingOptions = existing.options || {};
  const existingValues = existing.values || {};
  const mergedWhere = { ...(existingOptions.where || {}) };
  if (!req._apializeDisableQueryFilters) {
    for (const [k, v] of Object.entries(req.query || {})) {
      if (
        k === "api:page" ||
        k === "api:pagesize" ||
        k === "api:orderby" ||
        k === "api:orderdir" ||
        k === "api:filter" ||
        k.includes('.')
      )
        continue;
      if (typeof mergedWhere[k] === "undefined") mergedWhere[k] = v;
    }
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

module.exports = {
  express,
  apializeContext,
  ensureFn,
  asyncHandler,
  defaultNotFound,
};
