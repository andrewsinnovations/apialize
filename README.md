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
7. Related models with `single(..., { related: [...] })`

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

| Method | Path        | Helper    | Description                                      |
| ------ | ----------- | --------- | ------------------------------------------------ |
| GET    | /things     | `list`    | List + count (with optional filters)             |
| GET    | /things/:id | `single`  | Fetch one (404 if not found)                     |
| POST   | /things     | `create`  | Create (201) returns `{ success: true, id }`     |
| PUT    | /things/:id | `update`  | Full replace (unspecified fields null/default)   |
| PATCH  | /things/:id | `patch`   | Partial update (only provided fields)            |
| DELETE | /things/:id | `destroy` | Delete (404 if nothing affected)                 |

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

| list | `{ success: true, meta:{ page, page_size, total_pages, count }, data:[...] }` | Query params `api:page` (1-based) & `api:pagesize` (default 100) control pagination; rows objects normalize id. |
Individual mounting (choose only what you need):

```js
app.use("/widgets", create(Widget));
app.use("/widgets", list(Widget));
app.use("/widgets", single(Widget));
```

Bundled mounting:

```js
app.use("/widgets", crud(Widget));
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

Passing an empty object `{}` as the second argument is ignored (backwards compatibility). Any function argument is treated as middleware.

## 4. Options

Helper options are deliberately minimal. `crud()` accepts:

| Option        | Type   | Default | Description                                                                 |
| ------------- | ------ | ------- | --------------------------------------------------------------------------- |
| `middleware` | array  | `[]`    | Global middleware applied (in order) to every operation.                   |
| `routes`      | object | `{}`    | Per‑operation extra middleware: `{ list: [fnA], create: [fnB, fnC] }` etc. |

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
app.use("/items", single(Item, { id_mapping: 'external_id' }));
app.use("/items", update(Item, { id_mapping: 'external_id' }));
app.use("/items", patch(Item, { id_mapping: 'external_id' }));
app.use("/items", destroy(Item, { id_mapping: 'external_id' }));

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
  where: { type: "fruit", name: "pear" },
  limit,
  offset,
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
  options: { where: {/* merged filters */}, limit, offset, order },
  values: {/* merged body values for create/updates */},
};
```

Ownership / authorization middleware can safely merge additional filters and values:

```js
function ownership(req, _res, next) {
  const userId = req.user.id;
  req.apialize.options.where.user_id = userId; // restrict
  if (["POST","PUT","PATCH"].includes(req.method)) {
    req.apialize.values.user_id = userId; // enforce
  }
  next();
}
```

Update semantics:
- `PUT` (update) performs a full replace: for any attribute not provided, the value is set to the model's `defaultValue` if defined, otherwise `null` (identifier is preserved).
- `PATCH` updates only provided, valid attributes. If body is empty, it verifies existence and returns success.

---

## 7. Related models with `single(..., { related: [...] })`

### Related model endpoints via `single()`

`single(model, { related: [...] })` can mount child endpoints under a parent resource, e.g., `/users/:id/posts`.

Config per related item:

```js
single(User, {
  related: [
    {
      model: Post,                 // required
      path: 'articles',            // optional, overrides path derived from model name
      foreignKey: 'user_id',       // optional, default: `${parentModelName.toLowerCase()}_id`
      operations: ['list','get','post','put','patch','delete'], // subset allowed
      options: {                   // base options forwarded into child helpers
        // same knobs as list/create/update/patch/destroy options
        middleware: [ownership],
        allowFiltering: true,      // list option example
        defaultPageSize: 25,       // list option example
        id_mapping: 'id',          // default child id mapping
        modelOptions: { attributes: { exclude: ['secret'] } } // Sequelize options
      },
      perOperation: {              // optional: per-op overrides
        list: { allowFiltering: false }, // e.g. lock down filters only for list
        get:  { modelOptions: { attributes: ['id','title'] } },
        post: { middleware: [validatePostBody] },
        put:  { id_mapping: 'id' },
        patch:{},
        delete: { /* middleware, id_mapping, modelOptions... */ }
      }
    }
  ]
})
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

## 8. Nested related routes (recursion)

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
  single(User, {
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
          get:  { modelOptions: { attributes: ["external_id", "title", "content"] } },
        },
      },
    ],
  }, {
    // Sequelize options for the top-level single() query
    attributes: { exclude: ["id"] },
  })
);
```

This mounts endpoints like:
- `GET /users/:id/posts` and `GET /users/:id/posts/:post` (id mapping applied per level)
- `POST /users/:id/posts` (FK injected)
- `GET /users/:id/posts/:post/comments` and `GET /users/:id/posts/:post/comments/:comment`
- `PUT|PATCH|DELETE` available per allowed operations at each level

Because nested `get` uses core `single()`, you get consistent 404 handling, response shape `{ success: true, record }`, and you can keep nesting by adding further `related` entries.

---

## 9. Bulk delete on related collections

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
- Mount control: The bulk route is enabled by default when `delete` operations are allowed for the related resource; you can disable it via `perOperation.delete.allow_bulk_delete = false`.

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
              id_mapping: 'comment_key',
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

- The bulk DELETE route is mounted only when `delete` operations are enabled for that related item and `allow_bulk_delete` is not set to `false`.
- The result `ids` array is derived using the configured `id_mapping` for `delete`; if none is set, `'id'` is used.
- Any scoping middleware you add (e.g., parent or ownership filters) will also apply to the bulk DELETE via `req.apialize.options.where`.

## License

MIT
