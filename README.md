# apialize

Turn a Sequelize‑like model into a production‑ready REST(ish) CRUD API in a few lines.

Drop‑in Express routers for list / read / create / update / patch / destroy with:

- Pluggable middleware (auth, ownership, validation)
- Simple primary identifier assumption (`id` column, configurable)
- Per‑model default pagination + ordering (`page_size`, `orderby`, `orderdir`)
- Automatic equality filtering from query string (`?field=value`)
- Consistent response shapes + 404 handling

No heavy abstractions: you keep full control of Express and your models. Works with Sequelize or any model object that implements the required methods.

---

## Contents

1. Installation
2. Quick start
3. API reference (helpers, options)
4. Response formats
5. Filtering, pagination, ordering
6. Middleware and `req.apialize`
7. Pre/Post Hooks and Query Control
8. Related models with `single(..., { related: [...] })`
9. Member routes (follow-up routes on a single resource)
10. Nested related routes (recursion)
11. Bulk delete on related collections

## 1. Installation

```bash
npm install apialize
# or
yarn add apialize
```

Peer expectations: you provide an Express app and a “Sequelize‑like” model exposing the following methods (same signatures as Sequelize):

- `findAndCountAll(options)`
- `findOne(options)`
- `create(values, options)`
- `update(values, options)` (static)
- `destroy(options)` (static)

Instances returned by `create` / `findOne` can optionally implement `.get({ plain: true })`; if not present, objects are shallow‑copied.

---

## 2. Quick start

```js
const express = require("express");
const bodyParser = require("body-parser");
const { crud } = require("apialize");
const { Thing } = require("./models"); // Sequelize model example

const app = express();
app.use(bodyParser.json());

// Mount full CRUD at /things (uses default identifier = "id")
app.use("/things", crud(Thing));

app.listen(3000, () => console.log("API on :3000"));
```

You instantly get:

| Method | Path        | Helper    | Description                                    |
| ------ | ----------- | --------- | ---------------------------------------------- |
| GET    | /things     | `list`    | List + count (with optional filters)           |
| GET    | /things/:id | `single`  | Fetch one (404 if not found)                   |
| POST   | /things     | `create`  | Create (201) returns `{ success: true, id }`   |
| PUT    | /things/:id | `update`  | Full replace (unspecified fields null/default) |
| PATCH  | /things/:id | `patch`   | Partial update (only provided fields)          |
| DELETE | /things/:id | `destroy` | Delete (404 if nothing affected)               |

---

## 3. API reference

All helpers return an `express.Router` you mount under a base path:

```js
const {
  list,
  single,
  create,
  update,
  patch,
  destroy,
  crud,
} = require("apialize");
```

Individual mounting (choose only what you need):

```js
app.use("/widgets", create(Widget)); // POST /widgets
app.use("/widgets", list(Widget)); // GET /widgets
app.use("/widgets", single(Widget)); // GET /widgets/:id
app.use("/widgets", update(Widget)); // PUT /widgets/:id
app.use("/widgets", patch(Widget)); // PATCH /widgets/:id
app.use("/widgets", destroy(Widget)); // DELETE /widgets/:id
```

Bundled mounting:

```js
app.use("/widgets", crud(Widget));
// Exposes all endpoints:
// GET /widgets          (list)
// GET /widgets/:id      (single)
// POST /widgets         (create)
// PUT /widgets/:id      (update)
// PATCH /widgets/:id    (patch)
// DELETE /widgets/:id   (destroy)
```

`crud(model, options)` is sugar that internally mounts every operation with shared configuration + shared/global middleware.

### Helper signatures

Each helper accepts `(model, options = {}, modelOptions = {})` unless otherwise stated. `options.middleware` is an array of Express middleware. `modelOptions` are passed through to Sequelize calls (`attributes`, `include`, etc.).

- `list(model, options?, modelOptions?)`
- `single(model, options?, modelOptions?)`
- `create(model, options?, modelOptions?)`
- `update(model, options?, modelOptions?)`
- `patch(model, options?, modelOptions?)`
- `destroy(model, options?, modelOptions?)`
- `crud(model, options?)` // composition helper

For `single()`, `update()`, `patch()`, and `destroy()` the `options` object supports:

- `middleware`: array of middleware functions
- `id_mapping`: string mapping URL param to a field (default `'id'`)
- `param_name` (single only): change the name of the URL parameter used by `single()` for the record id (default `'id'`)
- `member_routes` (single only): array of follow-up routes that run after the single record is loaded. Each item is an object `{ path, handler, method = 'get', middleware = [] }`.

Passing an empty object `{}` as the second argument is ignored (backwards compatibility). Any function argument is treated as middleware.

### Options

Helper options are deliberately minimal. `crud()` accepts:

| Option       | Type   | Default | Description                                                                |
| ------------ | ------ | ------- | -------------------------------------------------------------------------- |
| `middleware` | array  | `[]`    | Global middleware applied (in order) to every operation.                   |
| `routes`     | object | `{}`    | Per‑operation extra middleware: `{ list: [fnA], create: [fnB, fnC] }` etc. |

Example:

```js
const opts = {
  middleware: [authenticate],
  routes: {
    list: [rateLimitList],
    create: [validateBody],
  },
};
app.use("/widgets", crud(Widget, opts));
```

### Identifier mapping

apialize assumes your public identifier is an `id` column. For record operations (`single`, `update`, `patch`, `destroy`), customize which field the URL parameter maps to using `id_mapping`:

```js
// Default behavior - maps :id parameter to 'id' field
app.use("/items", single(Item));
app.use("/items", update(Item));
app.use("/items", patch(Item));
app.use("/items", destroy(Item));

// Custom mapping - maps :id parameter to 'external_id' field
app.use("/items", single(Item, { id_mapping: "external_id" }));
app.use("/items", update(Item, { id_mapping: "external_id" }));
app.use("/items", patch(Item, { id_mapping: "external_id" }));
app.use("/items", destroy(Item, { id_mapping: "external_id" }));

// Example: GET /items/abc-123 will query WHERE external_id = 'abc-123'
//          PUT /items/abc-123 will update WHERE external_id = 'abc-123'
//          PATCH /items/abc-123 will update WHERE external_id = 'abc-123'
//          DELETE /items/abc-123 will delete WHERE external_id = 'abc-123'
```

Pagination & ordering precedence (within `list()`):

1. Query parameters (`api:pagesize`, `api:orderby`, `api:orderdir`)
2. Model defaults (`page_size`, `orderby`, `orderdir` on `model.apialize` – only these pagination/ordering keys are used)
3. Hard‑coded fallbacks: page_size 100, ordering by `id` ascending.

---

## 4. Response formats

Success responses:

- `list` → `{ success: true, meta: { page, page_size, total_pages, count[, order] }, data: [...] }`
  - `meta.order` is included only when `metaShowOrdering: true` is set in list options.
- `single` → `{ success: true, record: { ... } }`
- `create` → `201 { success: true, id }`
- `update` → `{ success: true }`
- `patch` → `{ success: true, id }`
- `destroy` → `{ success: true, id }`

Not found: `404 { success: false, error: "Not Found" }`.
Bad request (invalid filter/order column or type): `400 { success: false, error: "Bad request" }`.

---

## 5. Filtering, pagination, ordering

Every ordinary query parameter becomes a simple equality in `where` (unless already set by earlier middleware). Reserved keys are NOT turned into filters:

- `api:page` – 1‑based page (default 1)
- `api:pagesize` – page size (default 100)
- `api:orderby` – comma separated field list. Supports `-field` for DESC, `+field` for ASC, plain field uses global direction.
- `api:orderdir` – fallback direction (`ASC` | `DESC`) applied to fields without an explicit `+`/`-` (default `ASC`).

Pagination sets `limit` & `offset`. Ordering translates to a Sequelize `order` array like `[["score","DESC"],["name","ASC"]]`. Response structure:

```jsonc
{
	"success": true,
	"meta": { "page": 2, "page_size": 25, "total_pages": 9, "count": 215 },
	"data": [ { "id": 26, ... } ]
}
```

Example (filter + pagination + ordering):  
`GET /items?type=fruit&api:page=2&api:pagesize=25&api:orderby=-score,name` =>

```js
model.findAndCountAll({
  where: { type: "fruit" },
  limit: 25,
  offset: 25,
  order: [
    ["score", "DESC"],
    ["name", "ASC"],
  ],
});
```

If you don't supply `api:orderby`, results default to ascending by `id` (ensuring stable pagination): `ORDER BY id ASC`.

The applied ordering is echoed back in `meta.order` as an array of `[field, direction]` pairs.

Ordering examples:

| Query                                | Resulting order          |
| ------------------------------------ | ------------------------ |
| `api:orderby=name`                   | name ASC                 |
| `api:orderby=name&api:orderdir=DESC` | name DESC                |
| `api:orderby=-score,name`            | score DESC then name ASC |
| `api:orderby=-score,+name`           | score DESC then name ASC |

Complex operators via middleware:

```js
const { Op, literal } = require("sequelize");
function onlyOdd(req, _res, next) {
  req.apialize.options.where[Op.and] = literal("value % 2 = 1");
  next();
}
app.use("/numbers", list(NumberModel, onlyOdd));
```

Add your own sorting / advanced operator grammar (e.g. parse `api:sort=-created_at,name`).

---

## 6. Middleware and `req.apialize`

You can attach middleware at three levels:

1. Global (via `crud` `middleware` option)
2. Per operation (via `crud` `routes.<op>` arrays)
3. Inline for a single helper (`list(Model, auth, audit)`)

All middleware run after an internal context initializer (`apializeContext`) which ensures `req.apialize` exists and merges query/body.

`req.apialize` structure:

```js
req.apialize = {
  options: {
    where: {
      /* merged filters */
    },
    limit,
    offset,
    order,
  },
  values: {
    /* merged body values for create/updates */
  },
};
```

Ownership / authorization middleware can safely merge additional filters and values:

```js
function ownership(req, _res, next) {
  const userId = req.user.id;
  req.apialize.options.where.user_id = userId; // restrict
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    req.apialize.values.user_id = userId; // enforce
  }
  next();
}
```

Update semantics:

- `PUT` (update) performs a full replace: for any attribute not provided, the value is set to the model's `defaultValue` if defined, otherwise `null` (identifier is preserved).
- `PATCH` updates only provided, valid attributes. If body is empty, it verifies existence and returns success.

---

## 7. Pre/Post Hooks and Query Control

All operations (`list`, `single`, `create`, `update`, `patch`, `destroy`) support optional pre/post processing hooks that provide powerful control over database queries and response formatting.

### Hook Configuration

Hooks can be configured as either:

- **Single function**: `pre: async (context) => { ... }`
- **Array of functions**: `pre: [fn1, fn2, fn3]` (executed in order)

```js
// Single function (simple)
app.use(
  "/items",
  list(Item, {
    pre: async (ctx) => {
      /* single pre hook */
    },
    post: async (ctx) => {
      /* single post hook */
    },
  }),
);

// Array of functions (advanced)
app.use(
  "/items",
  list(Item, {
    pre: [
      async (ctx) => {
        /* first pre hook */
      },
      async (ctx) => {
        /* second pre hook */
      },
      async (ctx) => {
        /* third pre hook */
      },
    ],
    post: [
      async (ctx) => {
        /* first post hook */
      },
      async (ctx) => {
        /* second post hook */
      },
    ],
  }),
);

// Mixed configuration
app.use(
  "/items",
  update(Item, {
    pre: async (ctx) => {
      /* single pre hook */
    },
    post: [
      async (ctx) => {
        /* first post hook */
      },
      async (ctx) => {
        /* second post hook */
      },
    ],
  }),
);
```

### Hook Execution Flow

1. **Pre hooks** run before the database query
   - Execute in array order if multiple hooks provided
   - Can modify query options (`where`, `include`, `attributes`, etc.)
   - Return value from last pre hook is stored in `context.preResult`
   - All hooks receive the same context object

2. **Database query** executes with modified options

3. **Post hooks** run after the query and response construction
   - Execute in array order if multiple hooks provided
   - Can modify the response payload before it's sent to client
   - Have access to `context.preResult` from pre hooks

### Transaction Management

- Automatic transaction lifecycle for operations that support it
- Transaction starts before pre hooks and commits after post hooks
- Automatic rollback on any error during hooks or query execution
- Transaction available as `context.transaction` in all hooks

### Context Object

The context object provides access to request data, model, options, and more:

```js
{
  req, res,              // Express request/response objects
  request,               // Alias to req for convenience
  model,                 // Sequelize-like model
  options,               // Operation options passed in
  modelOptions,          // Model options passed in
  apialize,              // Direct reference to req.apialize (for convenience)
  idMapping,             // Effective id mapping
  transaction,           // Sequelize transaction (if available)
  preResult,             // Result from last pre hook (undefined initially)
  payload,               // Response payload (available in post hooks)

  // Operation-specific properties
  page, pageSize,        // (list) pagination info
  appliedFilters,        // (list) filters derived from query
  existing,              // (update/patch) loaded record before save
  nextValues,            // (update/patch) values to be saved
}
```

### Query Control in Pre Hooks

Pre hooks can dynamically modify database queries by manipulating `ctx.apialize.options`:

#### Controlling WHERE Clauses

```js
app.use(
  "/items",
  list(Item, {
    pre: [
      async (ctx) => {
        // Add tenant filtering
        ctx.apialize.options.where.tenant_id = ctx.req.user.tenant_id;
        return { step: 1 };
      },
      async (ctx) => {
        // Add additional status filter with Sequelize operators
        const { Op } = require("sequelize");
        ctx.apialize.options.where.status = "active";
        ctx.apialize.options.where.price = { [Op.gt]: 0 };
        return { step: 2 };
      },
    ],
  }),
);
```

#### Controlling INCLUDE Clauses (Relations)

```js
app.use(
  "/items",
  single(Item, {
    pre: [
      async (ctx) => {
        // Dynamically include related models based on user permissions
        ctx.apialize.options.include = [{ model: Category, as: "category" }];
        return { step: 1 };
      },
      async (ctx) => {
        // Modify included model attributes based on user role
        if (ctx.req.user.role !== "admin") {
          ctx.apialize.options.include[0].attributes = ["name", "description"];
        }
        return { step: 2 };
      },
    ],
  }),
);
```

#### Controlling ATTRIBUTES (Field Selection)

```js
app.use(
  "/items",
  single(Item, {
    pre: [
      async (ctx) => {
        // Start with basic fields
        ctx.apialize.options.attributes = ["id", "name", "external_id"];
        return { step: 1 };
      },
      async (ctx) => {
        // Add additional fields based on user permissions
        if (ctx.req.user.role === "admin") {
          ctx.apialize.options.attributes.push("internal_notes", "cost");
        }
        if (ctx.req.user.role === "manager") {
          ctx.apialize.options.attributes.push("status");
        }
        return { step: 2 };
      },
    ],
  }),
);
```

### Response Control in Post Hooks

Post hooks can modify the response payload before it's sent to the client:

```js
app.use(
  "/items",
  list(Item, {
    pre: async (ctx) => {
      return { startTime: Date.now() };
    },
    post: [
      async (ctx) => {
        // Add metadata to response
        ctx.payload.meta.generated_by = "apialize";
        ctx.payload.meta.query_time_ms = Date.now() - ctx.preResult.startTime;
      },
      async (ctx) => {
        // Add user-specific data
        ctx.payload.meta.user_id = ctx.req.user.id;
        ctx.payload.meta.permissions = ctx.req.user.permissions;
      },
    ],
  }),
);
```

### Real-World Examples

#### Multi-tenant Application

```js
app.use(
  "/items",
  crud(Item, {
    routes: {
      list: {
        pre: async (ctx) => {
          // Enforce tenant isolation
          ctx.apialize.options.where.tenant_id = ctx.req.user.tenant_id;
        },
      },
      create: {
        pre: async (ctx) => {
          // Auto-inject tenant ID
          ctx.apialize.values.tenant_id = ctx.req.user.tenant_id;
          ctx.apialize.values.created_by = ctx.req.user.id;
        },
      },
    },
  }),
);
```

#### Role-based Field Access

```js
app.use(
  "/users",
  single(User, {
    pre: [
      async (ctx) => {
        // Base fields for all users
        const baseFields = ["id", "name", "email"];
        ctx.apialize.options.attributes = [...baseFields];
        return { role: ctx.req.user.role };
      },
      async (ctx) => {
        // Add fields based on role
        if (ctx.preResult.role === "admin") {
          ctx.apialize.options.attributes.push(
            "internal_id",
            "created_at",
            "last_login",
          );
        } else if (ctx.preResult.role === "manager") {
          ctx.apialize.options.attributes.push("department", "hire_date");
        }
      },
    ],
    post: async (ctx) => {
      // Add computed fields
      ctx.payload.record.display_name = ctx.payload.record.name.toUpperCase();
      ctx.payload.record.can_edit =
        ctx.req.user.id === ctx.payload.record.id ||
        ctx.req.user.role === "admin";
    },
  }),
);
```

#### Audit and Logging

```js
app.use(
  "/sensitive-data",
  destroy(SensitiveData, {
    pre: async (ctx) => {
      // Log access attempt
      await AuditLog.create({
        user_id: ctx.req.user.id,
        action: "DELETE_ATTEMPT",
        resource_id: ctx.req.params.id,
        timestamp: new Date(),
      });
      return { audit_id: result.id };
    },
    post: async (ctx) => {
      // Log successful deletion
      await AuditLog.create({
        user_id: ctx.req.user.id,
        action: "DELETE_SUCCESS",
        resource_id: ctx.req.params.id,
        related_audit_id: ctx.preResult.audit_id,
        timestamp: new Date(),
      });
    },
  }),
);
```

#### Dynamic Include with Caching

```js
app.use(
  "/products",
  list(Product, {
    pre: [
      async (ctx) => {
        // Check if client wants expanded data
        const expand = ctx.req.query.expand;
        if (expand) {
          ctx.apialize.options.include = [];

          if (expand.includes("category")) {
            ctx.apialize.options.include.push({
              model: Category,
              as: "category",
              attributes: ["name", "slug"],
            });
          }

          if (expand.includes("reviews") && ctx.req.user.role !== "guest") {
            ctx.apialize.options.include.push({
              model: Review,
              as: "reviews",
              limit: 5,
              order: [["created_at", "DESC"]],
            });
          }
        }
        return { expanded: expand };
      },
    ],
    post: async (ctx) => {
      // Add cache headers for expanded queries
      if (ctx.preResult.expanded) {
        ctx.res.set("Cache-Control", "public, max-age=300"); // 5 minutes
      }

      // Add expansion info to response
      ctx.payload.meta.expanded = ctx.preResult.expanded || [];
    },
  }),
);
```

### Error Handling

Hooks automatically participate in transaction rollback:

```js
app.use(
  "/items",
  update(Item, {
    pre: async (ctx) => {
      // Validation that can fail
      if (!ctx.req.user.can_edit) {
        throw new Error("Insufficient permissions");
      }
      // Transaction will be rolled back automatically
    },
    post: async (ctx) => {
      // Any error here also triggers rollback
      await notifyWebhook(ctx.payload);
    },
  }),
);

// Destroy with hooks
app.use(
  "/items",
  destroy(Item, {
    pre: async (ctx) => {
      // e.g., check permissions or enqueue audit
    },
    post: async (ctx) => {
      ctx.payload.deleted = true;
    },
  }),
);
```

Note: The final HTTP response body is taken from `context.payload` so your `post()` hook can modify it.

---

## 8. Related models with `single(..., { related: [...] })`

### Related model endpoints via `single()`

`single(model, { related: [...] })` can mount child endpoints under a parent resource, e.g., `/users/:id/posts`.

Config per related item:

```js
single(User, {
  related: [
    {
      model: Post, // required
      path: "articles", // optional, overrides path derived from model name
      foreignKey: "user_id", // optional, default: `${parentModelName.toLowerCase()}_id`
      operations: ["list", "get", "post", "put", "patch", "delete"], // choose explicitly (none enabled by default)
      options: {
        // base options forwarded into child helpers
        // same knobs as list/create/update/patch/destroy options
        middleware: [ownership],
        allowFiltering: true, // list option example
        defaultPageSize: 25, // list option example
        id_mapping: "id", // default child id mapping
        modelOptions: { attributes: { exclude: ["secret"] } }, // Sequelize options
      },
      perOperation: {
        // optional: per-op overrides
        list: { allowFiltering: false }, // e.g. lock down filters only for list
        get: { modelOptions: { attributes: ["id", "title"] } },
        post: { middleware: [validatePostBody] },
        put: { id_mapping: "id" },
        patch: {},
        delete: {
          /* middleware, id_mapping, modelOptions... */
        },
      },
    },
  ],
});
```

Behavior:

- Path: derived from related model name → snake_case + plural (e.g., `RelatedThing` → `related_things`), unless `path` is set.
- Parent filtering: list/get only return rows with `foreignKey = :id` of the parent.
- Writes: POST/PUT/PATCH automatically set the foreign key to the parent id; clients don’t need to send it.
- Responses follow the same shapes as base helpers (`list`, `single`, `create`, `update`, `patch`, `destroy`).
- Per‑operation overrides: `perOperation.{list|get|post|put|patch|delete}` can override `middleware`, `id_mapping`, and `modelOptions` (and list options) for that specific operation.

Examples:

- `GET /users/:id/posts` → list posts for a user
- `POST /users/:id/posts` → create a post for a user (FK auto‑injected)
- `GET /users/:id/posts/:postId` → fetch one
- `PUT /users/:id/posts/:postId` → update one
- `PATCH /users/:id/posts/:postId` → patch one
- `DELETE /users/:id/posts/:postId` → delete one

---

## 9. Member routes (follow-up routes on a single resource)

`single(model, { member_routes: [...] })` lets you add custom subroutes that operate on an already-loaded record. These routes mount under `/:id/<path>` (or your custom `param_name`).

Key behaviors:

- Consistent loading: The record is loaded using the same `id_mapping`, merged `where`, and inline middleware as the main `single` GET. If not found, a 404 is returned and your handler is not called.
- Request context: After loading, you get:
  - `req.apialize.rawRecord` – the ORM instance
  - `req.apialize.record` – a plain object, normalized by `id_mapping`
  - `req.apialize.singlePayload` – `{ success: true, record }`
- Response rules:
  - If your handler sends a response, nothing else happens.
  - If your handler returns a value, it is sent as JSON.
  - If your handler returns `undefined` and did not send a response, the default `{ success: true, record }` is returned.
- Verbs: Supports `get`, `post`, `put`, `patch`, and `delete`.
- Middleware: `single()` inline middleware runs first; you can also add per-route middleware.

Config shape for each member route:

```ts
{
  path: string;                 // required: e.g. "profile" or "/profile"
  handler: (req, res) => any;   // required
  method?: 'get'|'post'|'put'|'patch'|'delete'; // default 'get'
  middleware?: Function[];      // optional additional Express middleware
}
```

Examples:

```js
// GET /users/:id/profile
app.use(
  "/users",
  single(User, {
    member_routes: [
      {
        path: "profile",
        method: "get",
        async handler(req) {
          const user = req.apialize.record;
          return { success: true, userName: user.name };
        },
      },
    ],
  }),
);

// POST /orders/:id/cancel with extra middleware
app.use(
  "/orders",
  single(Order, {
    middleware: [requireAuth],
    member_routes: [
      {
        path: "cancel",
        method: "post",
        middleware: [requireRole("manager")],
        async handler(req) {
          const order = req.apialize.rawRecord; // ORM instance
          await order.update({ status: "canceled" });
          // No return => responds with { success: true, record }
        },
      },
    ],
  }),
);

// Full verb coverage example in one go
app.use(
  "/users",
  single(User, {
    member_routes: [
      { path: "get-verb", method: "get", handler: (req) => ({ ok: true }) },
      {
        path: "post-verb",
        method: "post",
        handler: (req) => ({ posted: req.body }),
      },
      {
        path: "put-verb",
        method: "put",
        async handler(req) {
          await req.apialize.rawRecord.update({ name: "put" });
          return { name: "put" };
        },
      },
      {
        path: "patch-verb",
        method: "patch",
        async handler(req) {
          await req.apialize.rawRecord.update({
            name: req.apialize.rawRecord.get("name") + "~",
          });
          return { name: req.apialize.rawRecord.get("name") };
        },
      },
      {
        path: "delete-verb",
        method: "delete",
        async handler(req) {
          await req.apialize.rawRecord.destroy();
          return { deleted: true };
        },
      },
    ],
  }),
);
```

Notes:

- `path` is required for each member route; it mounts under the same base as `single()` using `param_name` (default `'id'`).
- Use `req.apialize.record` for plain normalized data; use `req.apialize.rawRecord` for mutations and ORM methods.
- Your existing `single()` middleware (auth/ownership/etc.) runs before the member route loader, ensuring consistent scoping.

---

## 10. Nested related routes (recursion)

You can nest related definitions at any depth by attaching a `related` array on a child related item. The child `get` operation is implemented using the same core `single()` helper under the hood, so all of its behavior (middleware, `id_mapping`, `modelOptions`, and further `related` nesting) applies consistently.

Key points:

- Recursion: define `related` on any child to continue nesting (e.g., users → posts → comments → ...).
- Parent scoping: every nested level is automatically filtered by the parent through its foreign key; writes inject the correct parent foreign key automatically.
- Identifier mapping: each level can customize `id_mapping` independently.
- Param names: the parent `single()` uses `param_name` (default `'id'`). Nested levels use a child id parameter segment internally; clients see concrete values in the URL, so the actual placeholder name is only relevant if you inspect `req.params` in middleware.

Example: users → posts → comments, with external identifiers and attribute exclusions at each level:

```js
app.use(
  "/users",
  single(
    User,
    {
      // Expose users by external_id and hide internal id in responses
      id_mapping: "external_id",
      middleware: [auth],
      related: [
        {
          model: Post,
          path: "posts", // optional; defaults from model name
          foreignKey: "user_id", // optional; defaults to `${parent}_id`
          options: {
            id_mapping: "external_id",
            modelOptions: { attributes: { exclude: ["id"] } },
          },
          // Nest comments under each post
          related: [
            {
              model: Comment,
              options: {
                id_mapping: "uuid",
                modelOptions: { attributes: { exclude: ["id", "post_id"] } },
              },
            },
          ],
          perOperation: {
            list: { defaultPageSize: 25 },
            get: {
              modelOptions: { attributes: ["external_id", "title", "content"] },
            },
          },
        },
      ],
    },
    {
      // Sequelize options for the top-level single() query
      attributes: { exclude: ["id"] },
    },
  ),
);
```

This mounts endpoints like:

- `GET /users/:id/posts` and `GET /users/:id/posts/:post` (id mapping applied per level)
- `POST /users/:id/posts` (FK injected)
- `GET /users/:id/posts/:post/comments` and `GET /users/:id/posts/:post/comments/:comment`
- `PUT|PATCH|DELETE` available per allowed operations at each level

Because nested `get` uses core `single()`, you get consistent 404 handling, response shape `{ success: true, record }`, and you can keep nesting by adding further `related` entries.

---

## 11. Bulk delete on related collections

apialize supports a collection-level DELETE for related resources mounted via `single(..., { related: [...] })`. This lets you remove all child records for a given parent (or nested parent) in one call — with a built-in dry-run safety.

Key behavior:

- Endpoint: DELETE on the related collection path (no `:id` at the end).
  - Examples:
    - `DELETE /users/:userId/posts` (delete all posts for the user)
    - `DELETE /users/:userId/posts/:postId/comments` (delete all comments for the post)
- Dry-run by default: If `?confirm=true` is not provided, the endpoint does not delete anything and instead returns the list of identifiers that would be deleted.
- Confirm to execute: Pass `?confirm=true` to proceed with deletion.
- Parent scoping: Deletions are always scoped to the current parent(s) based on the configured foreign key.
- Identifier mapping: The identifiers in the response respect the per-operation `id_mapping` for `delete` if provided; otherwise they default to `'id'`.
- Mount control: The bulk route is disabled by default; enable it by setting `perOperation.delete.allow_bulk_delete = true` on a related resource that also enables the `delete` operation.

Config example (third level):

```js
single(User, {
  related: [
    {
      model: Post,
      related: [
        {
          model: Comment,
          perOperation: {
            delete: {
              // Show comment_key in responses instead of internal id
              id_mapping: "comment_key",
              // Optional: disable collection DELETE route entirely
              // allow_bulk_delete: false,
            },
          },
        },
      ],
    },
  ],
});
```

Requests and responses:

- Dry run (no confirm):

  `DELETE /users/123/posts/456/comments`

  Response:

  ```json
  { "success": true, "confirm_required": true, "ids": ["k1", "k2", "k3"] }
  ```

- Confirmed deletion:

  `DELETE /users/123/posts/456/comments?confirm=true`

  Response:

  ```json
  { "success": true, "deleted": 3, "ids": ["k1", "k2", "k3"] }
  ```

Notes:

- The bulk DELETE route is mounted only when `delete` operations are enabled AND `allow_bulk_delete` is set to `true` (disabled by default).
- The result `ids` array is derived using the configured `id_mapping` for `delete`; if none is set, `'id'` is used.
- Any scoping middleware you add (e.g., parent or ownership filters) will also apply to the bulk DELETE via `req.apialize.options.where`.

## License

MIT
