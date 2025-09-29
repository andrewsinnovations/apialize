# apialize

Turn a Sequelize‑like model into a production ready REST(ish) CRUD API in a few lines.

> Drop‐in Express routers for list / read / create / update / patch / destroy with:
> * Pluggable middleware (auth, ownership, validation)
> * Custom primary identifier field (declare `Model.apialize = { id_attribute: 'your_column' }`)
> * Per-model default pagination + ordering (`page_size`, `orderby`, `orderdir`)
> * Automatic equality filtering from query string (`?field=value`)
> * Consistent response shapes + 404 handling

No heavy abstractions, no magic: you keep full control of Express and your models. Works with Sequelize or any model object that implements the required methods.

---

## Contents
1. Installation
2. Quick start
3. Exported helpers
4. Options (`middlewares`, per‑route composition, model id_attribute)
5. Middleware patterns (auth, ownership, validation, dynamic filters)
6. Filtering + pagination via query string
7. Full vs partial updates (PUT vs PATCH)
8. Custom identifier / UUID example
9. Multi‑user ownership example
10. Shaping `req.apialize` (advanced)
11. Response formats & errors
12. FAQ / Tips
13. Pagination


## 1. Installation

```bash
npm install apialize
# or
yarn add apialize
```

Peer expectations: you provide an Express app and a “Sequelize‑like” model exposing the following methods (same signatures as Sequelize):

* `findAndCountAll(options)`
* `findOne(options)`
* `create(values, options)`
* `update(values, options)` (static)
* `destroy(options)` (static)

Instances returned by `create` / `findOne` can optionally implement `.get({ plain: true })`; if not present, objects are shallow‑copied.

---

## 2. Quick start

```js
const express = require('express');
const bodyParser = require('body-parser');
const { crud } = require('apialize');
const { Thing } = require('./models'); // Sequelize model example

const app = express();
app.use(bodyParser.json());

// Mount full CRUD at /things (uses default identifier = "id")
app.use('/things', crud(Thing));

app.listen(3000, () => console.log('API on :3000'));
```

You instantly get:

| Method | Path          | Helper    | Description |
|--------|---------------|-----------|-------------|
| GET    | /things       | `list`    | List + count (with optional filters) |
| GET    | /things/:id   | `single`  | Fetch one (404 if not found) |
| POST   | /things       | `create`  | Create (201) returns `{ success: true, id }` |
| PUT    | /things/:id   | `update`  | Full replace (omitted fields nulled / defaulted) |
| PATCH  | /things/:id   | `patch`   | Partial update (only provided fields) |
| DELETE | /things/:id   | `destroy` | Delete (404 if nothing affected) |

---

## 3. Exported helpers

All helpers return an `express.Router` you mount under a base path:

```js
const { list, single, create, update, patch, destroy, crud } = require('apialize');
```

| list      | `{ success: true, meta:{ page, page_size, total_pages, count }, data:[...] }` | Query params `api:page` (1-based) & `api:pagesize` (default 100) control pagination; rows objects normalize id. |
Individual mounting (choose only what you need):

```js
app.use('/widgets', create(Widget));
app.use('/widgets', list(Widget));
app.use('/widgets', single(Widget));
```

Bundled mounting:

```js
app.use('/widgets', crud(Widget));
```

`crud(model, options)` is sugar that internally mounts every operation with shared configuration + shared/global middlewares.

### Helper Signatures

```
list(model, ...middlewares)
single(model, ...middlewares)
create(model, ...middlewares)
update(model, ...middlewares)
patch(model, ...middlewares)
destroy(model, ...middlewares)
crud(model, [options]) // options only supports { middlewares, routes }
```

Passing an empty object `{}` as the second argument is ignored (backwards compatibility). Any function argument is treated as middleware.


## 4. Options

Helper options have been simplified. Identifier configuration moved onto the model itself via `Model.apialize.id_attribute`.

`crud()` accepts:

| Option         | Type        | Default | Description |
|----------------|-------------|---------|-------------|
| `middlewares`  | array       | `[]`    | Global middlewares applied (in order) to every operation. |
| `routes`       | object      | `{}`    | Per‑operation extra middlewares: `{ list: [fnA], create: [fnB, fnC] }` etc. |

Example:
```js
Widget.apialize = { id_attribute: 'uuid' };
const opts = {
  middlewares: [authenticate],
  routes: {
    list: [rateLimitList],
    create: [validateBody],
  },
};
app.use('/widgets', crud(Widget, opts));
```

### Setting a custom identifier & defaults

Assign an object with `id_attribute` (and optional defaults) to your model:

```js
Widget.apialize = {
	id_attribute: 'uuid',
	page_size: 50,      // default page size if api:pagesize not provided
	orderby: 'created_at', // default ordering field(s) if api:orderby absent (comma list allowed)
	orderdir: 'DESC'    // fallback direction for fields without + / - prefix (default 'ASC')
}; // set before mounting routes
app.use('/widgets', crud(Widget));
```

Precedence when determining the identifier column:
1. `Model.apialize.id_attribute` if set
2. First primary key attribute whose name is not `id`
3. Fallback `'id'`

Responses always normalize the chosen field back to `id`.

Pagination & ordering precedence (within `list()`):
1. Query parameters (`api:pagesize`, `api:orderby`, `api:orderdir`)
2. Model defaults (`page_size`, `orderby`, `orderdir` on `model.apialize`)
3. Hard-coded fallbacks: page_size 100, orderby = identifier ascending.

### Migration from idField option (BREAKING CHANGE)

Previous versions accepted `{ idField: 'uuid' }` as an option to each helper / crud(). This has been removed. To migrate:

Before:
```js
app.use('/widgets', crud(Widget, { idField: 'uuid' }));
```
After:
```js
Widget.apialize = { id_attribute: 'uuid' };
app.use('/widgets', crud(Widget));
```

---

## 5. Middleware patterns

You can attach middleware at three levels:

1. Global (via `crud` `middlewares` option)
2. Per operation (via `crud` `routes.<op>` arrays)
3. Inline for a single helper (`list(Model, auth, audit)`)

All middlewares run **after** an internal context initializer (`apializeContext`) which ensures `req.apialize` exists.

### `req.apialize` structure

`apializeContext` builds:
```js
req.apialize = {
	options: { where: { /* merged filters */ } },
	values: { /* merged body values for create/updates */ }
};
```

Ownership / authorization middleware can safely merge additional filters:

```js
function ownership(req, _res, next) {
	const userId = req.user.id;
	req.apialize.options.where.user_id = userId; // restrict every op to a user id by setting into where clause
	if (['POST','PUT','PATCH'].includes(req.method)) {
		req.apialize.values.user_id = userId; // force value
	}
	next();
}
```

Validation example:

```js
function requireName(req, res, next) {
	if (['POST','PUT'].includes(req.method) && !req.body.name) {
		return res.status(422).json({ error: 'name required' });
	}
	next();

app.use('/things', create(Thing, requireName));
```

Access denial: just send a response (e.g. 403) and skip `next()`.

---

## 6. Filtering + pagination + ordering via query string

Every ordinary query parameter becomes a simple equality in `where` (unless already set by earlier middleware). Reserved keys are NOT turned into filters:

* `api:page` – 1‑based page (default 1)
* `api:pagesize` – page size (default 100)
* `api:orderby` – comma separated field list. Supports `-field` for DESC, `+field` for ASC, plain field uses global direction.
* `api:orderdir` – fallback direction (`ASC` | `DESC`) applied to fields without an explicit `+`/`-` (default `ASC`).

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
model.findAndCountAll({ where: { type: 'fruit', name: 'pear' }, limit, offset })
```

If you don't supply `api:orderby`, results default to ascending by the effective id field (ensuring stable pagination): `ORDER BY <idField> ASC`.

The applied ordering is echoed back in `meta.order` as an array of `[field, direction]` pairs.

Ordering examples:

| Query | Resulting order |
|-------|-----------------|
| `api:orderby=name` | name ASC |
| `api:orderby=name&api:orderdir=DESC` | name DESC |
| `api:orderby=-score,name` | score DESC then name ASC |
| `api:orderby=-score,+name` | score DESC then name ASC |

Complex operators via middleware:

```js
const { Op, literal } = require('sequelize');
function onlyOdd(req, _res, next) {
	req.apialize.options.where[Op.and] = literal('value % 2 = 1');
	next();
}
app.use('/numbers', list(NumberModel, onlyOdd));
```

Add your own sorting / advanced operator grammar (e.g. parse `api:sort=-created_at,name`).

---

## 7. Full vs partial updates

`PUT /:id` (`update`) performs a **full replacement**:

* Any attribute defined on the model but missing from the request body is set to `null` (or `defaultValue` if defined) except the id.
* Ensures clients must send the complete new object.

`PATCH /:id` (`patch`) performs a **merge**:

* Only provided, valid attributes are updated.
* If you send nothing, it still verifies existence (404 if missing) and returns success.

---

## 8. Custom identifier / UUID

Declare it on the model (recommended to set before seeding or routing):

```js
Widget.apialize = { id_attribute: 'uuid', page_size: 25, orderby: 'uuid', orderdir: 'ASC' };
app.use('/widgets', crud(Widget));
```

Sequelize hook example for server‑generated UUID:

```js
const { v4: uuid } = require('uuid');
Widget.beforeCreate(w => { if (!w.uuid) w.uuid = uuid(); });
```

Clients still call `GET /widgets/:uuidValue`. Responses expose `{ id: <uuid> }`.

---

## 9. Multi‑user ownership example

Scenario: external UUID id, user ownership, bearer auth. Users can only see their own records; others resolve as 404.

```js
const { crud } = require('apialize');
const { v4: uuid } = require('uuid');

// Sequelize model: Record(id int PK auto, external_id string unique, user_id string, data string)
Record.beforeCreate(r => { if (!r.external_id) r.external_id = uuid(); });

async function authOwnership(req, res, next) {
	const header = req.get('Authorization') || '';
	const m = header.match(/^Bearer (.+)$/i);
	if (!m) return res.status(401).json({ error: 'Unauthorized' });
	const token = m[1];
	const session = await Session.findOne({ where: { token } });
	if (!session) return res.status(401).json({ error: 'Unauthorized' });
	const userId = session.user_id;
	// Restrict future queries
	req.apialize.options.where.user_id = userId;
	if (['POST','PUT','PATCH'].includes(req.method)) {
		req.apialize.values.user_id = userId;
	}
	next();
}

app.use('/records', crud(Record, { idField: 'external_id', middlewares: [authOwnership] }));
```js
Widget.apialize = { id_attribute: 'uuid' };
app.use('/widgets', crud(Widget, {
  middlewares: [auth],
  routes: { create: [validate], update: [validate] }
}));
```
---

## 10. Shaping / Extending `req.apialize` (advanced)

`apializeContext` merges:
* `req.body` into `req.apialize.values`
* query params into `req.apialize.options.where` (if that field not already defined)

You can pre‑populate `req.apialize` in earlier middleware (e.g., attach `options.where` for ownership) **before** apialize routes run. The internal middleware preserves and merges rather than overwriting.

Custom addition example (pagination):

```js
function pagination(req, _res, next) {
	const { limit, offset } = req.query;
	if (limit) req.apialize.options.limit = Math.min(parseInt(limit, 10), 100);
	if (offset) req.apialize.options.offset = parseInt(offset, 10) || 0;
	// Remove so they are not treated as equality where filters (optional):
	delete req.apialize.options.where.limit;
	delete req.apialize.options.where.offset;
	next();
}
app.use('/things', list(Thing, pagination));
```

---

## 11. Response formats & errors

| Operation | Success (200/201) shape | Notes |
|-----------|-------------------------|-------|
| list      | `{ success: true, meta:{ page, page_size, total_pages, count, order }, data:[...] }` | Rows include normalized `id`; `meta.order` lists applied ordering. |
| single    | Object representation (NOT wrapped) | Returns 404 `{ success:false, error:'Not Found' }` if missing. |
| create    | `{ success: true, id }` (201) | `id` normalized. |
| update    | Full plain object (replaced) | Includes all attributes except internal id alias removal. |
| patch     | `{ success: true, id }` | Does not return modified fields; fetch separately if needed. |
| destroy   | `{ success: true, id }` | 404 if nothing deleted. |

Other errors: unhandled exceptions bubble to your global error handler; add one after mounting routers.

### 403 vs 404 for ownership
Ownership logic should generally return 404 (to avoid leaking existence) by filtering via `where`. If you need explicit forbidden semantics, send `res.status(403).json({...})` from middleware.

---

## 12. FAQ / Tips

**Q: Can I disable one of the routes with `crud`?**  
Use individual helpers instead of `crud`, or mount `crud` then override (`app._router` surgery) — simpler: just compose only those you need manually.

**Q: How do I add pagination / sorting?**  
Middleware: parse query params, move them onto `req.apialize.options.limit / offset / order` and delete from `where` if inserted.

**Q: How do I return extra metadata (e.g., timing)?**  
Wrap the final handler with your own middleware placed after the apialize route (or replace `res.json`).

**Q: Can I use this without Sequelize?**  
Yes. Provide an object with the listed methods. For `update` / `destroy` you must mimic Sequelize return semantics (`update` returns `[affectedCount]`, `destroy` returns affected count). Instances should offer `.get({ plain: true })` or be plain objects.

**Q: Why does PATCH return only `{ success, id }`?**  
Keeps payload small; avoids second fetch. If you need the updated object, chain a `single` fetch client side or modify the handler (copy `patch` and customize).

**Q: How do I prevent certain fields from being updated?**  
Strip them inside middleware before they reach `req.apialize.values`, or mutate `provided` keys in a forked helper.

**Q: How do I add field validation?**  
Attach middleware to `create` / `update` / `patch` that inspects `req.body` or `req.apialize.values` and returns 422 errors.

**Q: Can I transform outputs (e.g., hide internal columns)?**  
Write a response shaping middleware after routes, or fork the helper and adjust the mapping step where rows are plainified.

---

### Minimal example with custom UUID id + auth + validation

```js
const { crud } = require('apialize');
const { v4: uuid } = require('uuid');

function auth(req, res, next) {
	if (!req.get('Authorization')) return res.status(401).json({ error: 'Unauthorized' });
	next();
}

function validate(req, res, next) {
	if (['POST','PUT'].includes(req.method) && !req.body.name) {
		return res.status(422).json({ error: 'name required' });
	}
	next();
}

Widget.beforeCreate(w => { if (!w.uuid) w.uuid = uuid(); });

app.use('/widgets', crud(Widget, {
	idField: 'uuid',
	middlewares: [auth],
	routes: { create: [validate], update: [validate] }
}));
```

---

## Contributing
PRs very welcome (additional filter operators, pagination helpers, docs). Keep helpers tiny and composable.

## License
MIT
