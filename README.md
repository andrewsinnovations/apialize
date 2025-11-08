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
7. Input Validation
8. Pre/Post Hooks and Query Control
9. Related models with `single(..., { related: [...] })`
10. Member routes (follow-up routes on a single resource)
11. Nested related routes (recursion)
12. Bulk delete on related collections

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
  search,
  update,
  patch,
  destroy,
  crud,
} = require('apialize');
```

Individual mounting (choose only what you need):

```js
app.use('/widgets', create(Widget)); // POST /widgets
app.use('/widgets', search(Widget)); // POST /widgets/search
app.use('/widgets', list(Widget)); // GET /widgets
app.use('/widgets', single(Widget)); // GET /widgets/:id
app.use('/widgets', update(Widget)); // PUT /widgets/:id
app.use('/widgets', patch(Widget)); // PATCH /widgets/:id
app.use('/widgets', destroy(Widget)); // DELETE /widgets/:id
```

Bundled mounting:

```js
app.use('/widgets', crud(Widget));
// Exposes all endpoints:
// GET /widgets          (list)
// GET /widgets/:id      (single)
// POST /widgets         (create)
// POST /widgets/search  (search)
// PUT /widgets/:id      (update)
// PATCH /widgets/:id    (patch)
// DELETE /widgets/:id   (destroy)
```

`crud(model, options)` is sugar that internally mounts every operation with shared configuration + shared/global middleware.

### Helper signatures

Each helper accepts `(model, options = {}, modelOptions = {})` unless otherwise stated. `options.middleware` is an array of Express middleware. `modelOptions` are passed through to Sequelize calls (`attributes`, `include`, etc.).

#### `modelOptions.scopes`

You can apply Sequelize scopes declaratively by including a `scopes` array in `modelOptions`. Scopes are applied automatically before pre-hooks run, allowing you to filter data at the model level:

```js
// Define scopes in your model
Person.addScope('active', { where: { status: 'active' } });
Person.addScope('byTenant', (tenantId) => ({ where: { tenant_id: tenantId } }));
Person.addScope('featured', { where: { is_featured: true } });

// Apply single scope
app.use(
  '/people',
  list(
    Person,
    {},
    {
      scopes: ['active'], // Only show active people
    }
  )
);

// Apply multiple scopes (combined with AND logic)
app.use(
  '/people',
  list(
    Person,
    {},
    {
      scopes: ['active', 'featured'], // Only show active AND featured people
    }
  )
);

// Apply parameterized scopes
app.use(
  '/people',
  single(
    Person,
    {},
    {
      scopes: [
        'active',
        { name: 'byTenant', args: [req.user.tenantId] }, // Parameterized scope
      ],
    }
  )
);

// Works with write operations to restrict which records can be modified
app.use(
  '/people',
  update(
    Person,
    {},
    {
      scopes: ['active'], // Only allow updates to active people (404 if inactive)
    }
  )
);

app.use(
  '/people',
  destroy(
    Person,
    {},
    {
      scopes: ['byTenant', 'active'], // Only allow deletion of active people in tenant
    }
  )
);
```

**Key behaviors:**

- **Applied before pre-hooks**: Scopes are applied first, then pre-hooks can add additional filtering
- **All operations**: Works with `list`, `single`, `create`, `update`, `patch`, `destroy`, and `search`
- **Combinable**: Can be combined with other `modelOptions` like `attributes`, `include`, etc.
- **Write operation restrictions**: For `single`, `update`, `patch`, and `destroy`, scopes limit which records can be accessed/modified (returns 404 if no matching record found)
- **AND logic**: Multiple scopes are combined with AND logic
- **Error handling**: Invalid scopes are logged as errors but don't prevent the operation from continuing

```js
// Example: Multi-tenant application with role-based access
app.use(
  '/documents',
  list(
    Document,
    {},
    {
      scopes: [
        { name: 'byTenant', args: [req.user.tenantId] },
        'published',
        { name: 'byAccessLevel', args: [req.user.role] },
      ],
      attributes: ['id', 'title', 'created_at'],
      include: [{ model: Person, as: 'author', attributes: ['name'] }],
    }
  )
);
```

- `list(model, options?, modelOptions?)`
- `single(model, options?, modelOptions?)`
- `create(model, options?, modelOptions?)`
- `search(model, options?, modelOptions?)` // POST body-driven list variant
- `update(model, options?, modelOptions?)`
- `patch(model, options?, modelOptions?)`
- `destroy(model, options?, modelOptions?)`
- `crud(model, options?)` // composition helper

For `single()`, `update()`, `patch()`, and `destroy()` the `options` object supports:

- `middleware`: array of middleware functions
- `id_mapping`: string mapping URL param to a field (default `'id'`)
- `validate` (create/update/patch only): boolean, enables automatic Sequelize validation on request body (default `true`)
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
    // search uses default path '/search' under crud. You can attach middleware here.
    search: [requireRole('analyst')],
  },
};
app.use('/widgets', crud(Widget, opts));
```

### Create options

The `create(model, options?, modelOptions?)` helper also supports:

- `allow_bulk_create` (boolean, default `false`)
  - When the request body is an array and this flag is `true`, `create` will insert all records in a single transaction using the model's `bulkCreate` and return an array of created objects.
  - When `false` (the default) and the request body is an array, the request is rejected with `400 { success: false, error: "Bulk create disabled" }`.
  - Identifier mapping is respected for array responses: if `id_mapping` is set (e.g., `'external_id'`), each returned object will also have `id` set to that mapped value.

- `validate` (boolean, default `true`)
  - When `true` (the default), enables automatic Sequelize model validation on request body data before other middleware runs.
  - Validation runs on the input data using `model.build(data).validate()` for single objects or each item in arrays.
  - For `PATCH` operations, only validates the fields being updated (partial validation).
  - If validation fails, returns `400 { success: false, error: "Validation failed", details: [...] }` where `details` contains an array of validation error objects with `field`, `message`, and `value` properties.
  - When `false`, no automatic validation is performed - validation occurs at the Sequelize level during save operations.

### Identifier mapping

apialize assumes your public identifier is an `id` column. For record operations (`single`, `update`, `patch`, `destroy`), customize which field the URL parameter maps to using `id_mapping`:

```js
// Default behavior - maps :id parameter to 'id' field
app.use('/items', single(Item));
app.use('/items', update(Item));
app.use('/items', patch(Item));
app.use('/items', destroy(Item));

// Custom mapping - maps :id parameter to 'external_id' field
app.use('/items', single(Item, { id_mapping: 'external_id' }));
app.use('/items', update(Item, { id_mapping: 'external_id' }));
app.use('/items', patch(Item, { id_mapping: 'external_id' }));
app.use('/items', destroy(Item, { id_mapping: 'external_id' }));

// Example: GET /items/abc-123 will query WHERE external_id = 'abc-123'
//          PUT /items/abc-123 will update WHERE external_id = 'abc-123'
//          PATCH /items/abc-123 will update WHERE external_id = 'abc-123'
//          DELETE /items/abc-123 will delete WHERE external_id = 'abc-123'
```

For related model filtering and ordering, see the `relation_id_mapping` option documented in the filtering sections below.

Pagination & ordering precedence (within `list()`):

1. Query parameters (`api:page_size`, `api:order_by`, `api:order_dir`)
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

Every ordinary query parameter becomes a simple equality in `where` (unless already set by earlier middleware). For string attributes, equality is case-insensitive by default (translated to `ILIKE` on Postgres, `LIKE` elsewhere without wildcards). Reserved keys are NOT turned into filters:

- `api:page` – 1‑based page (default 1)
- `api:page_size` – page size (default 100)
- `api:order_by` – comma separated field list. Supports `-field` for DESC, `+field` for ASC, plain field uses global direction.
- `api:order_dir` – fallback direction (`ASC` | `DESC`) applied to fields without an explicit `+`/`-` (default `ASC`).

Pagination sets `limit` & `offset`. Ordering translates to a Sequelize `order` array like `[["score","DESC"],["name","ASC"]]`. Response structure:

```jsonc
{
	"success": true,
	"meta": { "page": 2, "page_size": 25, "total_pages": 9, "count": 215 },
	"data": [ { "id": 26, ... } ]
}
```

Example (filter + pagination + ordering):  
`GET /items?type=fruit&api:page=2&api:page_size=25&api:order_by=-score,name` =>

```js
model.findAndCountAll({
  where: { type: 'fruit' },
  limit: 25,
  offset: 25,
  order: [
    ['score', 'DESC'],
    ['name', 'ASC'],
  ],
});
```

If you don't supply `api:order_by`, results default to ascending by `id` (ensuring stable pagination): `ORDER BY id ASC`.

The applied ordering is echoed back in `meta.order` as an array of `[field, direction]` pairs.

Ordering examples:

| Query                                  | Resulting order          |
| -------------------------------------- | ------------------------ |
| `api:order_by=name`                    | name ASC                 |
| `api:order_by=name&api:order_dir=DESC` | name DESC                |
| `api:order_by=-score,name`             | score DESC then name ASC |
| `api:order_by=-score,+name`            | score DESC then name ASC |

### Filtering on included models (dotted paths)

When you pass Sequelize `include` options to `list()` via the third argument (`modelOptions`) or in a pre hook, you can filter on attributes of included associations using dotted paths. apialize translates these to the `$alias.attribute$` form supported by Sequelize.

Example:

```js
// Mount list on Album and include Artist under alias 'artist'
app.use(
  '/albums',
  list(Album, {}, { include: [{ model: Artist, as: 'artist' }] })
);

// GET /albums?artist.name=prince
// Default equality on string fields is case-insensitive, so this matches 'Prince'.

// You can also use operators:
// GET /albums?artist.name:ieq=PRINCE   // case-insensitive equality
// GET /albums?artist.name:contains=inc // substring match
```

If a dotted path doesn’t match an included alias/attribute, the request returns `400 Bad request`.

### Relation ID mapping for filtering and ordering

The `relation_id_mapping` option allows filters and ordering on related model 'id' fields to be mapped to custom fields (e.g., `external_id`). This is particularly useful when your related models use custom public identifiers instead of internal database IDs.

Configuration:

```js
// Configure list with relation_id_mapping
app.use(
  '/songs',
  list(
    Song,
    {
      relation_id_mapping: [
        { model: Artist, id_field: 'external_id' },
        { model: Album, id_field: 'external_id' },
      ],
    },
    {
      include: [
        { model: Artist, as: 'artist' },
        { model: Album, as: 'album' },
      ],
    }
  )
);

// Now artist.id filters will use artist.external_id instead of artist.id
// GET /songs?artist.id=artist-beethoven   // Uses artist.external_id
// GET /songs?album.id=album-symphony-5    // Uses album.external_id
// GET /songs?api:order_by=artist.id        // Orders by artist.external_id
```

The mapping applies to:

- **Equality filters**: `?artist.id=value` → `artist.external_id = value`
- **Operator filters**: `?artist.id:in=val1,val2` → `artist.external_id IN (val1, val2)`
- **Ordering**: `?api:order_by=artist.id` → `ORDER BY artist.external_id`
- **Foreign key flattening**: Foreign key values in response data are replaced with mapped ID values

#### Foreign key flattening in responses

When `relation_id_mapping` is configured, apialize automatically replaces foreign key values in response data with their corresponding mapped ID values. This provides consistency when using external IDs throughout your API:

```js
// Configure with relation_id_mapping
app.use(
  '/albums',
  list(Album, {
    relation_id_mapping: [{ model: Artist, id_field: 'external_id' }],
  })
);

// Example response data transformation:
// Database: { id: 1, title: 'Symphony No. 5', artist_id: 123 }
// Response: { id: 1, title: 'Symphony No. 5', artist_id: 'artist-beethoven' }
```

**Automatic foreign key detection:**
Foreign keys are automatically detected using common naming patterns and replaced with external IDs:

- `{model_name}_id` → Uses the model's `id_field` value
- `{model_name}Id` → Camel case variant
- `{model_name}_key` → Alternative suffix pattern
- `{model_name}Key` → Camel case key variant

```js
// Multiple foreign key mapping example
app.use(
  '/songs',
  list(Song, {
    relation_id_mapping: [
      { model: Artist, id_field: 'external_id' },
      { model: Album, id_field: 'external_id' },
    ],
  })
);

// Response transformation:
// Database: { id: 1, title: 'Track 1', artist_id: 123, album_id: 456 }
// Response: { id: 1, title: 'Track 1', artist_id: 'artist-beethoven', album_id: 'album-symphony-5' }
```

**How it works:**

1. **Detection**: Identifies foreign key fields by matching patterns against configured models
2. **Bulk lookup**: Efficiently fetches all needed external IDs in batch queries
3. **Replacement**: Substitutes internal IDs with external IDs in the response data
4. **Error handling**: Gracefully handles missing mappings by keeping original values

Only affects `.id` field references and foreign key mappings; other fields like `artist.name` work normally. Can be combined with regular `id_mapping` for the root model:

```js
app.use(
  '/songs',
  list(Song, {
    id_mapping: 'external_id', // Root model uses external_id for id
    relation_id_mapping: [
      // Related models also use external_id for id
      { model: Artist, id_field: 'external_id' },
      { model: Album, id_field: 'external_id' },
    ],
  })
);
```

#### Complete example: Music streaming API with external IDs

```js
// Models with both internal IDs and external IDs
const Artist = sequelize.define('Artist', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  external_id: { type: DataTypes.STRING, unique: true }, // e.g. 'artist-beethoven'
  name: DataTypes.STRING,
});

const Album = sequelize.define('Album', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  external_id: { type: DataTypes.STRING, unique: true }, // e.g. 'album-symphony-5'
  title: DataTypes.STRING,
  artist_id: DataTypes.INTEGER, // Foreign key to artist
});

const Song = sequelize.define('Song', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  external_id: { type: DataTypes.STRING, unique: true }, // e.g. 'song-movement-1'
  title: DataTypes.STRING,
  album_id: DataTypes.INTEGER, // Foreign key to album
  artist_id: DataTypes.INTEGER, // Foreign key to artist
});

// Configure API with relation_id_mapping
app.use(
  '/songs',
  list(Song, {
    id_mapping: 'external_id',
    relation_id_mapping: [
      { model: Artist, id_field: 'external_id' },
      { model: Album, id_field: 'external_id' },
    ],
  })
);

// API behavior examples:
// GET /songs?artist.id=artist-beethoven
// → Filters by artist.external_id = 'artist-beethoven'

// GET /songs
// → Response includes foreign key flattening:
// [
//   {
//     "id": "song-movement-1",           // Root model uses external_id
//     "title": "Symphony No. 5 - Movement 1",
//     "artist_id": "artist-beethoven",   // Flattened from internal 123 → external_id
//     "album_id": "album-symphony-5"     // Flattened from internal 456 → external_id
//   }
// ]
```

#### Multi-level filtering and ordering (list)

You can filter and order by attributes multiple levels deep as long as the nested includes are present.

```js
// Album → Artist → Label
app.use(
  '/albums',
  list(
    Album,
    { metaShowOrdering: true },
    {
      include: [
        {
          model: Artist,
          as: 'artist',
          include: [{ model: Label, as: 'label' }],
        },
      ],
    }
  )
);

// Filter: label name (case-insensitive equality by default)
// GET /albums?artist.label.name=warner

// Order: first by label name, then by artist name
// GET /albums?api:order_by=artist.label.name,artist.name
```

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

### List filtering operators (colon syntax)

Beyond raw equality (`?field=value`), the list endpoint supports operator-style filters using the `field:operator=value` syntax. Multiple filters are implicitly ANDed.

Supported operators:

- Equality/inequality: `eq`, `=`, `neq`, `!=`
- Case-insensitive equality: `ieq`
- Comparisons: `gt`, `gte`, `lt`, `lte`
- Sets: `in` (comma-separated), `not_in` (comma-separated)
- Strings: `contains`, `icontains`, `starts_with`, `ends_with`, `not_contains`, `not_icontains`, `not_starts_with`, `not_ends_with`
- Booleans: raw equality works (`?active=true`); for completeness, `is_true` and `is_false` are also accepted (e.g., `?active:is_true=true`)

Examples:

- `GET /items?name:icontains=display` → case-insensitive substring match
- `GET /items?score:gte=2` → numeric comparison
- `GET /items?category:in=A,B` → set membership (comma-separated)
- `GET /items?name:not_icontains=auto&api:order_by=id` → excludes case-insensitive matches, ordered by id
- `GET /items?name:starts_with=dis` → prefix match
- `GET /items?name:ends_with=lay` → suffix match
- `GET /items?category:not_in=tools,vehicles` → not in set
- `GET /items?name:ieq=alpha` → case-insensitive equality (matches `Alpha` and `alpha`)

### Response Flattening

The `list` and `search` operations support automatic flattening of included model attributes into the main response object. This feature allows you to expose selected attributes from associated models as if they were part of the main model, simplifying client-side data handling and enabling direct filtering and ordering on flattened fields.

#### Configuration

Configure flattening by passing a `flattening` option to `list` or `search`:

```js
app.use(
  '/available-people',
  list(
    Person,
    {
      id_mapping: 'external_id',
      flattening: {
        model: PersonNames,
        as: 'Names',
        attributes: ['first_name', ['last_name', 'lname']],
      },
    }
    // No need to specify include - it's auto-created from flattening config!
  )
);
```

**Flattening Configuration:**

- `model`: The Sequelize model to flatten (must match an included model)
- `as`: The alias used in the include (must match exactly)
- `attributes`: Array of attributes to flatten. Each item can be:
  - A string: `'first_name'` → flattened as `first_name`
  - An array: `['last_name', 'lname']` → flattened as `lname`

#### Response Transformation

Without flattening:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-123",
      "login": "john.doe@example.com",
      "Names": {
        "first_name": "John",
        "last_name": "Doe"
      }
    }
  ]
}
```

With flattening:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-123",
      "login": "john.doe@example.com",
      "first_name": "John",
      "lname": "Doe"
    }
  ]
}
```

#### Filtering and Ordering on Flattened Fields

Once configured, you can filter and order by flattened field names directly:

```js
// Filter by flattened fields
GET /available-people?first_name=John
GET /available-people?lname:icontains=doe
GET /available-people?first_name=John&lname:starts_with=D

// Order by flattened fields
GET /available-people?api:order_by=lname
GET /available-people?api:order_by=first_name,lname
GET /available-people?api:order_by=-lname,first_name
```

#### Search API Support

Flattening works seamlessly with the search API and also auto-creates includes:

```js
// Include is automatically created from flattening config
app.use('/people/search', search(Person, {
    flattening: {
        model: PersonNames,
        as: 'Names',
        attributes: ['first_name', ['last_name', 'surname']]
    }
}));

// POST /people/search
{
  "filtering": {
    "first_name": { "icontains": "john" },
    "surname": "smith"
  },
  "ordering": [
    { "orderby": "surname", "direction": "ASC" },
    { "orderby": "first_name", "direction": "ASC" }
  ]
}
```

#### Automatic Include Creation

**New in this version:** If a matching include doesn't exist, apialize will automatically create one from your flattening configuration. This means you don't need to configure both the include and the flattening separately!

```js
// Before: Required explicit include configuration
app.use(
  '/people',
  list(
    Person,
    {
      flattening: {
        model: PersonNames,
        as: 'Names',
        attributes: ['first_name', 'last_name'],
      },
    },
    {
      include: [{ model: PersonNames, as: 'Names', required: true }],
    }
  )
);

// Now: Include is auto-created from flattening config
app.use(
  '/people',
  list(Person, {
    flattening: {
      model: PersonNames,
      as: 'Names',
      attributes: ['first_name', 'last_name'],
    },
  })
);
```

The auto-created include will:

- Use `required: true` by default (can be overridden with `flattening.required`)
- Support all standard Sequelize include options like `where`, `include` (nested), `separate`, `or`, `on`, `limit`, etc.
- **Note:** The `attributes` property in flattening config is used for defining what to flatten and how to alias it (e.g., `['last_name', 'surname']`). It is NOT copied to the Sequelize include. If you need to limit which attributes are loaded from the database, provide an explicit include configuration.

```js
// Auto-include with custom options
app.use(
  '/people',
  list(Person, {
    flattening: {
      model: PersonNames,
      as: 'Names',
      attributes: ['first_name', 'last_name'],
      required: false, // Optional include
      where: { is_active: true }, // Additional filtering
      separate: true, // Use separate query for hasMany
      limit: 10, // Limit results when using separate
    },
  })
);
```

If you provide an explicit include that matches the flattening alias, it will be used instead of auto-creating one.

#### Supported Include Options in Flattening Config

The flattening configuration supports all standard Sequelize include options. When auto-creating an include, these options are passed through to the Sequelize query:

| Option               | Type        | Description                                                                         |
| -------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `model`              | Model       | **Required**. The Sequelize model to include                                        |
| `as`                 | string      | **Required**. The alias for the association                                         |
| `where`              | object      | WHERE clauses for the child model (converts to inner join unless `required: false`) |
| `required`           | boolean     | If true, uses inner join; if false, uses left join (default: `true`)                |
| `include`            | Array       | Nested includes for multi-level associations                                        |
| `separate`           | boolean     | Run a separate query for hasMany associations                                       |
| `limit`              | number      | Limit results (only with `separate: true`)                                          |
| `order`              | Array       | Order the included records                                                          |
| `on`                 | object      | Custom ON condition for the join                                                    |
| `or`                 | boolean     | Bind ON and WHERE with OR instead of AND                                            |
| `right`              | boolean     | Use right join if supported by dialect                                              |
| `association`        | Association | Use association object instead of model/as                                          |
| `through`            | object      | Options for belongsToMany join table                                                |
| `through.where`      | object      | Filter conditions on the join table                                                 |
| `through.attributes` | Array       | Attributes to select from the join table                                            |
| `through.as`         | string      | Custom alias for the join table                                                     |
| `through.paranoid`   | boolean     | Include/exclude soft-deleted join records                                           |
| `duplicating`        | boolean     | Mark as duplicating to prevent subqueries                                           |
| `paranoid`           | boolean     | Include/exclude soft-deleted records                                                |

**Important Sequelize Limitations:**

- `separate: true` is **only supported for hasMany** associations, not for belongsToMany
- For belongsToMany relationships, you cannot use `limit` without `separate: true`

**Example with through table (belongsToMany):**

```js
// Many-to-many relationship with enrollment data
Student.belongsToMany(Course, {
  through: Enrollment,
  as: 'Courses'
});

app.use('/students', list(Student, {
  flattening: {
    model: Course,
    as: 'Courses',
    attributes: ['course_code', 'title', 'credits'],
    through: {
      where: { status: 'active' },  // Only active enrollments
      attributes: ['grade', 'semester']  // Include enrollment data
    },
    required: true
  }
}));

// Filters students by course fields
GET /students?course_code=CS101
GET /students?credits:gte=3

// Orders by flattened course fields
GET /students?api:order_by=course_code
```

**Example with multiple options:**

```js
app.use(
  '/people',
  list(Person, {
    flattening: {
      model: PersonNames,
      as: 'Names',
      attributes: ['first_name', 'last_name'],
      where: { is_active: true },
      required: true,
      include: [
        {
          model: Address,
          as: 'Addresses',
          required: false,
        },
      ],
      separate: false,
      order: [['last_name', 'ASC']],
    },
  })
);
```

#### Important Notes

- **Include Auto-Creation**: If no matching include exists, one is automatically created from the flattening config
- **Explicit Override**: Manually specified includes with the same alias take precedence over auto-creation
- **Subquery Disabling**: Flattening automatically disables subqueries to ensure proper JOIN behavior
- **Validation**: apialize validates that the specified model and alias are consistent between flattening and includes
- **Performance**: Use flattening judiciously—it requires JOINs which may impact query performance on large datasets
- **Attribute Conflicts**: If a flattened attribute name conflicts with a main model attribute, the flattened value takes precedence in filtering/ordering

#### Complete Example

```js
// Models with associations
const Person = sequelize.define('Person', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  external_id: { type: DataTypes.UUID, unique: true },
  login: DataTypes.STRING,
});

const PersonNames = sequelize.define('PersonNames', {
  id: { type: DataTypes.INTEGER, primaryKey: true },
  person_id: DataTypes.INTEGER,
  first_name: DataTypes.STRING,
  last_name: DataTypes.STRING,
});

Person.hasMany(PersonNames, { foreignKey: 'person_id', as: 'Names' });

// Option 1: Simple auto-include (recommended)
router.use(
  '/available-people',
  list(
    Person,
    {
      id_mapping: 'external_id',
      flattening: {
        model: PersonNames,
        as: 'Names',
        attributes: ['first_name', ['last_name', 'lname']],
      },
    }
    // Include is auto-created from flattening config!
  )
);

// Option 2: Using scopes with explicit include (when you need more control)
Person.addScope('api', {
  include: [
    {
      model: PersonNames,
      as: 'Names',
      attributes: ['last_name', 'first_name'],
      required: true,
    },
  ],
});

router.use(
  '/people-with-scope',
  list(
    Person,
    {
      id_mapping: 'external_id',
      flattening: {
        model: PersonNames,
        as: 'Names',
        attributes: ['first_name', ['last_name', 'lname']],
      },
    },
    {
      scopes: ['api'],
    }
  )
);
```

---

## 6. Middleware and `req.apialize`

You can attach middleware at three levels:

1. Global (via `crud` `middleware` option)
2. Per operation (via `crud` `routes.<op>` arrays)
3. Inline for a single helper (`list(Model, auth, audit)`)

All middleware run after the library automatically initializes `req.apialize` and merges query/body data.

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
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.apialize.values.user_id = userId; // enforce
  }
  next();
}
```

Update semantics:

- `PUT` (update) performs a full replace: for any attribute not provided, the value is set to the model's `defaultValue` if defined, otherwise `null` (identifier is preserved).
- `PATCH` updates only provided, valid attributes. If body is empty, it verifies existence and returns success.

---

## 7. Input Validation

apialize supports automatic input validation using your Sequelize model's validation rules. Validation is **enabled by default** for operations that accept request body data and runs before all other middleware, providing consistent error responses.

### Validation is Enabled by Default

Validation is automatically enabled for `create`, `update`, and `patch` operations. No configuration is needed:

```js
const { create, update, patch } = require('apialize');

// Validation is enabled by default - no configuration needed
app.use('/people', create(Person));
app.use('/people', update(Person));
app.use('/people', patch(Person));

// Or use crud for all operations
app.use('/people', crud(Person));
```

### Disabling Validation

If you need to disable validation for specific operations, set `validate: false`:

```js
// Disable validation for create operations
app.use('/people', create(Person, { validate: false }));

// Disable validation for specific operations via crud
app.use(
  '/people',
  crud(Person, {
    routes: {
      create: { validate: false },
      update: { validate: false },
    },
  })
);
```

### Model Validation Rules

Define validation rules in your Sequelize model as usual:

```js
const Person = sequelize.define('Person', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Name cannot be empty' },
      len: { args: [2, 50], msg: 'Name must be 2-50 characters' },
    },
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isEmail: { msg: 'Must be a valid email address' },
    },
  },
  age: {
    type: DataTypes.INTEGER,
    validate: {
      min: { args: [0], msg: 'Age must be positive' },
      max: { args: [120], msg: 'Age must be realistic' },
    },
  },
});
```

### Validation Behavior

- **Create**: Validates the entire request body against all model rules
- **Update**: Validates the entire request body (full replacement)
- **Patch**: Validates only the fields being updated (partial validation)
- **Bulk Create**: Validates each item in the array individually

### Validation Error Response

When validation fails, a `400` response is returned:

```js
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "email",
      "message": "Must be a valid email address",
      "value": "invalid-email"
    },
    {
      "field": "age",
      "message": "Age must be positive",
      "value": -5
    }
  ]
}
```

### Validation Timing

The validation middleware runs **before** all other middleware in this order:

1. `apializeContext` (parses query/body data)
2. **Validation middleware** (when `validate: true`)
3. Your custom middleware
4. Main operation handler

This ensures invalid data is rejected early, before any business logic or database operations.

---

## 8. Pre/Post Hooks and Query Control

All operations (`list`, `single`, `create`, `update`, `patch`, `destroy`) support optional pre/post processing hooks that provide powerful control over database queries and response formatting.

### Hook Configuration

Hooks can be configured as either:

- **Single function**: `pre: async (context) => { ... }`
- **Array of functions**: `pre: [fn1, fn2, fn3]` (executed in order)

```js
// Single function (simple)
app.use(
  '/items',
  list(Item, {
    pre: async (ctx) => {
      /* single pre hook */
    },
    post: async (ctx) => {
      /* single post hook */
    },
  })
);

// Array of functions (advanced)
app.use(
  '/items',
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
  })
);

// Mixed configuration
app.use(
  '/items',
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
  })
);
```

### Hook Execution Flow

1. **Model scopes** are applied first (from `modelOptions.scopes`)
   - Scopes filter data at the model level before any hooks run
   - Multiple scopes are combined with AND logic

2. **Pre hooks** run before the database query
   - Execute in array order if multiple hooks provided
   - Can modify query options (`where`, `include`, `attributes`, etc.) on top of applied scopes
   - Return value from last pre hook is stored in `context.preResult`
   - All hooks receive the same context object

3. **Database query** executes with modified options (scopes + pre hook modifications)

4. **Post hooks** run after the query and response construction
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

  // Helper functions (available directly on context for convenience)
  applyWhere,            // Apply where conditions (overwrites existing keys)
  applyScope,            // Apply Sequelize scopes (when model available)
  applyMultipleWhere,    // Apply multiple where conditions at once
  applyWhereIfNotExists, // Apply conditions only if they don't exist
  applyScopes,           // Apply multiple scopes in sequence (when model available)
  removeWhere,           // Remove specific where conditions
  replaceWhere,          // Replace entire where clause
}
```

### Context Helper Functions

The context object in pre/post hooks includes built-in helper functions for convenience. These same functions are also available on `req.apialize` for use in middleware:

#### `context.applyWhere(additionalWhere)` | `req.apialize.applyWhere(additionalWhere)`

Apply additional where conditions to the existing where clause. New conditions overwrite existing conditions for the same keys:

```js
// In pre/post hooks
app.use(
  '/items',
  list(Item, {
    pre: async (context) => {
      // Simple where conditions - use context directly for convenience
      context.applyWhere({
        tenant_id: context.req.user.tenantId,
        status: 'active',
      });

      // With Sequelize operators
      const { Op } = require('sequelize');
      context.applyWhere({
        price: { [Op.gt]: 0 },
        created_at: { [Op.gte]: new Date('2024-01-01') },
      });

      // Later calls overwrite earlier ones for the same keys
      context.applyWhere({ status: 'published' }); // status becomes 'published'

      return { tenantFiltered: true };
    },
  })
);

// In middleware (req.apialize helpers are automatically available)
const tenantMiddleware = (req, res, next) => {
  req.apialize.applyWhere({ tenant_id: req.user.tenantId });
  next();
};

app.use(
  '/items',
  list(Item, {
    middleware: [tenantMiddleware],
  })
);
```

**Behavior:**

- Last condition wins for the same key
- Simple and predictable overwrite behavior
- Available in middleware, pre hooks, and post hooks
- For complex AND logic, build the condition explicitly:

```js
// Instead of multiple calls, build complex conditions explicitly
req.apialize.applyWhere({
  [Op.and]: [
    { price: { [Op.gte]: 100 } },
    { price: { [Op.lte]: 500 } },
    { category: 'electronics' },
  ],
});
```

#### `context.applyScope(scope, ...args)` | `req.apialize.applyScope(scope, ...args)`

Apply Sequelize scopes to modify query options (only available when model is present):

```js
// Define scopes in your model
Item.addScope('byTenant', (tenantId) => ({
  where: { tenant_id: tenantId },
}));

Item.addScope('activeOnly', {
  where: { status: 'active' },
});

// Use in pre hooks
app.use(
  '/items',
  list(Item, {
    pre: async (context) => {
      // Apply parameterized scope - use context directly
      context.applyScope('byTenant', context.req.user.tenantId);

      // Apply simple scope
      context.applyScope('activeOnly');

      return { scopesApplied: true };
    },
  })
);
```

#### `context.applyWhereIfNotExists(conditionalWhere)`

Apply where conditions only if they don't already exist:

```js
app.use(
  '/items',
  list(Item, {
    pre: async (context) => {
      // Always apply tenant filtering
      context.applyWhere({ tenant_id: context.req.user.tenantId });

      // Only apply default status if user hasn't specified one
      context.applyWhereIfNotExists({ status: 'active' });

      return { conditionalFiltersApplied: true };
    },
  })
);
```

#### `context.applyMultipleWhere(whereConditions)`

Apply multiple where conditions at once:

```js
app.use(
  '/items',
  list(Item, {
    pre: async (context) => {
      const conditions = [
        { tenant_id: context.req.user.tenantId },
        { status: 'active' },
        { price: { [Op.gt]: 0 } },
      ];

      context.applyMultipleWhere(conditions);

      return { multipleFiltersApplied: true };
    },
  })
);
```

#### `context.applyScopes(scopes)`

Apply multiple scopes in sequence:

```js
app.use(
  '/items',
  list(Item, {
    pre: async (context) => {
      const scopes = [
        'activeOnly',
        { name: 'byTenant', args: [context.req.user.tenantId] },
        'withCategory',
      ];

      context.applyScopes(scopes);

      return { multipleScopesApplied: true };
    },
  })
);
```

#### `context.removeWhere(keysToRemove)` & `context.replaceWhere(newWhere)`

Remove or replace where conditions:

```js
app.use(
  '/items',
  list(Item, {
    pre: async (context) => {
      // Add base conditions
      context.applyWhere({
        tenant_id: context.req.user.tenantId,
        status: 'active',
      });

      // Remove status filter for admin users
      if (context.req.user.role === 'admin') {
        context.removeWhere('status');
      }

      // Or completely replace where clause
      if (context.req.user.role === 'superadmin') {
        context.replaceWhere({}); // See everything
      }

      return { adminAccess: true };
    },
  })
);
```

#### Multi-tenant Example with Helper Functions

```js
app.use(
  '/items',
  crud(Item, {
    routes: {
      list: {
        pre: async (context) => {
          const user = context.req.user;

          // Base tenant isolation (always applied)
          context.applyScope('byTenant', user.tenantId);

          // Role-based filtering
          switch (user.role) {
            case 'admin':
              // Admin sees all items in tenant
              break;

            case 'manager':
              // Manager sees department items
              context.applyScope('byDepartment', user.departmentId);
              break;

            case 'user':
              // User sees only their own items
              context.applyWhere({ created_by: user.id });
              break;
          }

          // Apply common filters
          context.applyScope('activeOnly');

          // Handle special query parameters
          if (context.req.query.archived === 'true') {
            context.removeWhere('status');
            context.applyWhere({ archived_at: { [Op.not]: null } });
          }

          return {
            tenantId: user.tenantId,
            role: user.role,
            filtersApplied: true,
          };
        },
      },

      create: {
        pre: async (context) => {
          const user = context.req.user;

          // Auto-inject tenant and user info
          if (!context.req.apialize.values) {
            context.req.apialize.values = {};
          }

          Object.assign(context.req.apialize.values, {
            tenant_id: user.tenantId,
            created_by: user.id,
            department_id: user.departmentId,
            status: 'active',
          });

          return { autoFieldsInjected: true };
        },
      },
    },
  })
);
```

### Query Control in Pre Hooks

Pre hooks can dynamically modify database queries either by using the built-in helper functions (recommended) or by directly manipulating `ctx.apialize.options`:

#### Controlling WHERE Clauses (Recommended: Helper Functions)

```js
app.use(
  '/items',
  list(Item, {
    pre: [
      async (ctx) => {
        // Using helper functions (recommended)
        ctx.applyWhere({ tenant_id: ctx.req.user.tenant_id });
        return { step: 1 };
      },
      async (ctx) => {
        // Apply multiple conditions with operators
        const { Op } = require('sequelize');
        ctx.applyWhere({
          status: 'active',
          price: { [Op.gt]: 0 },
        });
        return { step: 2 };
      },
    ],
  })
);
```

#### Controlling WHERE Clauses (Manual Approach)

```js
app.use(
  '/items',
  list(Item, {
    pre: [
      async (ctx) => {
        // Manual manipulation (still supported)
        ctx.apialize.options.where.tenant_id = ctx.req.user.tenant_id;
        return { step: 1 };
      },
      async (ctx) => {
        // Add additional status filter with Sequelize operators
        const { Op } = require('sequelize');
        ctx.apialize.options.where.status = 'active';
        ctx.apialize.options.where.price = { [Op.gt]: 0 };
        return { step: 2 };
      },
    ],
  })
);
```

#### Controlling INCLUDE Clauses (Relations)

```js
app.use(
  '/items',
  single(Item, {
    pre: [
      async (ctx) => {
        // Dynamically include related models based on user permissions
        ctx.apialize.options.include = [{ model: Category, as: 'category' }];
        return { step: 1 };
      },
      async (ctx) => {
        // Modify included model attributes based on user role
        if (ctx.req.user.role !== 'admin') {
          ctx.apialize.options.include[0].attributes = ['name', 'description'];
        }
        return { step: 2 };
      },
    ],
  })
);
```

#### Controlling ATTRIBUTES (Field Selection)

```js
app.use(
  '/items',
  single(Item, {
    pre: [
      async (ctx) => {
        // Start with basic fields
        ctx.apialize.options.attributes = ['id', 'name', 'external_id'];
        return { step: 1 };
      },
      async (ctx) => {
        // Add additional fields based on user permissions
        if (ctx.req.user.role === 'admin') {
          ctx.apialize.options.attributes.push('internal_notes', 'cost');
        }
        if (ctx.req.user.role === 'manager') {
          ctx.apialize.options.attributes.push('status');
        }
        return { step: 2 };
      },
    ],
  })
);
```

### Response Control in Post Hooks

Post hooks can modify the response payload before it's sent to the client:

```js
app.use(
  '/items',
  list(Item, {
    pre: async (ctx) => {
      return { startTime: Date.now() };
    },
    post: [
      async (ctx) => {
        // Add metadata to response
        ctx.payload.meta.generated_by = 'apialize';
        ctx.payload.meta.query_time_ms = Date.now() - ctx.preResult.startTime;
      },
      async (ctx) => {
        // Add user-specific data
        ctx.payload.meta.user_id = ctx.req.user.id;
        ctx.payload.meta.permissions = ctx.req.user.permissions;
      },
    ],
  })
);
```

### Real-World Examples

#### Multi-tenant Application

```js
app.use(
  '/items',
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
  })
);
```

#### Role-based Field Access

```js
app.use(
  '/people',
  single(Person, {
    pre: [
      async (ctx) => {
        // Base fields for all people
        const baseFields = ['id', 'name', 'email'];
        ctx.apialize.options.attributes = [...baseFields];
        return { role: ctx.req.user.role };
      },
      async (ctx) => {
        // Add fields based on role
        if (ctx.preResult.role === 'admin') {
          ctx.apialize.options.attributes.push(
            'internal_id',
            'created_at',
            'last_login'
          );
        } else if (ctx.preResult.role === 'manager') {
          ctx.apialize.options.attributes.push('department', 'hire_date');
        }
      },
    ],
    post: async (ctx) => {
      // Add computed fields
      ctx.payload.record.display_name = ctx.payload.record.name.toUpperCase();
      ctx.payload.record.can_edit =
        ctx.req.user.id === ctx.payload.record.id ||
        ctx.req.user.role === 'admin';
    },
  })
);
```

#### Audit and Logging

```js
app.use(
  '/sensitive-data',
  destroy(SensitiveData, {
    pre: async (ctx) => {
      // Log access attempt
      await AuditLog.create({
        user_id: ctx.req.user.id,
        action: 'DELETE_ATTEMPT',
        resource_id: ctx.req.params.id,
        timestamp: new Date(),
      });
      return { audit_id: result.id };
    },
    post: async (ctx) => {
      // Log successful deletion
      await AuditLog.create({
        user_id: ctx.req.user.id,
        action: 'DELETE_SUCCESS',
        resource_id: ctx.req.params.id,
        related_audit_id: ctx.preResult.audit_id,
        timestamp: new Date(),
      });
    },
  })
);
```

#### Dynamic Include with Caching

```js
app.use(
  '/products',
  list(Product, {
    pre: [
      async (ctx) => {
        // Check if client wants expanded data
        const expand = ctx.req.query.expand;
        if (expand) {
          ctx.apialize.options.include = [];

          if (expand.includes('category')) {
            ctx.apialize.options.include.push({
              model: Category,
              as: 'category',
              attributes: ['name', 'slug'],
            });
          }

          if (expand.includes('reviews') && ctx.req.user.role !== 'guest') {
            ctx.apialize.options.include.push({
              model: Review,
              as: 'reviews',
              limit: 5,
              order: [['created_at', 'DESC']],
            });
          }
        }
        return { expanded: expand };
      },
    ],
    post: async (ctx) => {
      // Add cache headers for expanded queries
      if (ctx.preResult.expanded) {
        ctx.res.set('Cache-Control', 'public, max-age=300'); // 5 minutes
      }

      // Add expansion info to response
      ctx.payload.meta.expanded = ctx.preResult.expanded || [];
    },
  })
);
```

### Error Handling

Hooks automatically participate in transaction rollback:

```js
app.use(
  '/items',
  update(Item, {
    pre: async (ctx) => {
      // Validation that can fail
      if (!ctx.req.user.can_edit) {
        throw new Error('Insufficient permissions');
      }
      // Transaction will be rolled back automatically
    },
    post: async (ctx) => {
      // Any error here also triggers rollback
      await notifyWebhook(ctx.payload);
    },
  })
);

// Destroy with hooks
app.use(
  '/items',
  destroy(Item, {
    pre: async (ctx) => {
      // e.g., check permissions or enqueue audit
    },
    post: async (ctx) => {
      ctx.payload.deleted = true;
    },
  })
);
```

Note: The final HTTP response body is taken from `context.payload` so your `post()` hook can modify it.

---

## Search (body-driven filtering via POST)

`search(model, options?, modelOptions?)` exposes a POST route that returns the same response shape as `list`, but accepts complex boolean filters in the request body instead of using query parameters. Mount it under a separate subpath to avoid colliding with `create` (which also uses POST):

```js
app.use('/items/search', search(Item)); // POST /items/search

// With scopes applied automatically before search filters
app.use(
  '/items/search',
  search(
    Item,
    {},
    {
      scopes: ['active', { name: 'byTenant', args: [req.user.tenantId] }],
    }
  )
); // Only search within active items in user's tenant
```

Request body shape:

```jsonc
{
  "filtering": {
    // implicit AND of keys when no boolean wrapper provided
    "and": [
      { "status": "active" },
      {
        "or": [{ "category": "electronics" }, { "name_contains": "display" }],
      },
      { "price": { "gte": 100, "lt": 500 } },
    ],
  },
  "ordering": [{ "orderby": "price", "direction": "asc" }],
  "paging": { "page": 1, "size": 50 },
}
```

### Filtering on included models (dotted paths)

When you pass Sequelize `include` options to `search()` via the third argument (`modelOptions`) or in a pre hook, you can filter on attributes of included associations using dotted paths. apialize will translate these to the `$alias.attribute$` form supported by Sequelize.

Example:

```js
// Mount search on Album and include Artist under alias 'artist'
app.use(
  '/albums',
  search(Album, {}, { include: [{ model: Artist, as: 'artist' }] })
);

// POST /albums/search with filters on included model
// { "filtering": { "artist.name": { "icontains": "beethoven" } } }
```

Supported operators and boolean grouping work the same as for top‑level attributes. If a dotted path doesn’t match an included alias/attribute, the request returns `400 Bad request`.

### Relation ID mapping for search filtering and ordering

The `relation_id_mapping` option works with `search()` endpoints in the same way as `list()`, allowing filters and ordering on related model 'id' fields to be mapped to custom fields (e.g., `external_id`).

Configuration:

```js
// Configure search with relation_id_mapping
app.use(
  '/songs/search',
  search(
    Song,
    {
      relation_id_mapping: [
        { model: Artist, id_field: 'external_id' },
        { model: Album, id_field: 'external_id' },
      ],
    },
    {
      include: [
        { model: Artist, as: 'artist' },
        { model: Album, as: 'album' },
      ],
    }
  )
);
```

Usage in search requests:

```js
// POST /songs/search - Filter by artist.id using external_id
{
  "filtering": {
    "artist.id": "artist-beethoven"    // Uses artist.external_id
  }
}

// POST /songs/search - Complex filters with operators
{
  "filtering": {
    "album.id": {
      "in": ["album-symphony-5", "album-requiem"]  // Uses album.external_id
    }
  }
}

// POST /songs/search - Ordering by relation id field
{
  "ordering": [
    { "orderby": "artist.id", "direction": "DESC" }  // Orders by artist.external_id
  ]
}
```

The mapping applies to the same cases as in `list()`:

- **Equality filters**: `"artist.id": "value"` → `artist.external_id = value`
- **Operator filters**: `"artist.id": { "in": [...] }` → `artist.external_id IN (...)`
- **Ordering**: `"orderby": "artist.id"` → `ORDER BY artist.external_id`
- **Foreign key flattening**: Foreign key values in response data are replaced with mapped ID values

```js
// Search response with foreign key flattening
// POST /songs/search returns:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Symphony No. 5 - Movement 1",
      "artist_id": "artist-beethoven",  // Mapped from internal ID
      "album_id": "album-sym5"          // Mapped from internal ID
    }
  ]
}
```

Foreign key flattening works the same way as in `list()` operations - see the detailed documentation in the filtering section above.

#### Multi-level filtering and ordering (search)

```js
// Album → Artist → Label
app.use(
  '/albums',
  search(
    Album,
    { metaShowOrdering: true },
    {
      include: [
        {
          model: Artist,
          as: 'artist',
          include: [{ model: Label, as: 'label' }],
        },
      ],
    }
  )
);

// Filter by label name (default case-insensitive equality)
// POST /albums/search
// { "filtering": { "artist.label.name": "warner" } }

// Order by label desc, then artist asc, then title asc
// POST /albums/search
// {
//   "ordering": [
//     { "orderby": "artist.label.name", "direction": "DESC" },
//     { "orderby": "artist.name", "direction": "ASC" },
//     { "orderby": "title", "direction": "ASC" }
//   ]
// }

// meta.order echoes readable paths, e.g.:
// [["artist.label.name","DESC"],["artist.name","ASC"],["title","ASC"]]
```

### Filtering operators (what you can express in filters)

You can express complex filters using an operator-object form per field. Top-level keys are implicitly ANDed; provide explicit boolean arrays `and: [...]` and `or: [...]` for grouping.

Operator-object form (supported keys):

- Equality: `eq`, `=`
- Inequality: `neq`, `!=`
- Comparisons: `gt`, `>`, `gte`, `>=`, `lt`, `<`, `lte`, `<=`
- Sets: `in`, `not_in`
- Strings: `contains`, `icontains`, `starts_with`, `ends_with`,
  `not_contains`, `not_icontains`, `not_starts_with`, `not_ends_with`
- Booleans: `is_true`, `is_false` (raw equality `"active": true` is also supported)

Examples (operator-object form):

```jsonc
{
  "filtering": {
    "price": { "gte": 100, "lt": 500 },
    "status": { "neq": "archived" },
    "category": { "in": ["A", "B"] },
    "name": { "icontains": "display" },
    "title": { "not_contains": "draft" },
    "sku": { "not_starts_with": "TMP-" },
    "ext": { "not_ends_with": ".bak" },
    "active": { "is_true": true },
  },
}
```

Boolean grouping:

```jsonc
{
  "filtering": {
    "and": [
      { "status": "active" },
      {
        "or": [{ "price": { "lt": 300 } }, { "score": { "gte": 9 } }],
      },
    ],
  },
}
```

Multi-field substring search (OR across fields):

```jsonc
{
  "filtering": {
    "or": [
      { "name": { "icontains": "auto" } },
      { "category": { "icontains": "auto" } },
      { "external_id": { "icontains": "auto" } },
    ],
  },
}
```

Notes on case-insensitivity and dialects:

- On Postgres, case-insensitive matches use `iLike`; on other dialects they fall back to `LIKE` with case-insensitive behavior depending on the database (SQLite is case-insensitive for ASCII by default).
- Equality on booleans works with raw values (e.g., `{ "active": true }`) or the explicit `is_true`/`is_false` operators.

Error handling and validation:

- If a filter references a non-existent column or uses a value that doesn’t match the column type, the server responds `400 { success: false, error: "Bad request" }`.
- Invalid order columns also return `400`.

Ordering and paging in search:

- `ordering`: either a single object `{ orderby, direction }` or an array of them. Defaults to the same stable ordering as `list` (by `id` or your configured `id_mapping` ascending) when omitted.
- `paging`: `{ page, size }`, both 1-based positive integers; defaults to page 1 and the operation’s `defaultPageSize`.

Options align with `list` where applicable: `defaultPageSize`, `defaultOrderBy`, `defaultOrderDir`, `metaShowOrdering`, `middleware`, `pre`, `post`, and `id_mapping`. Ordering can be a single object or an array. If omitted, defaults to the same stable ordering as `list` (`id`/`id_mapping` ASC).

---

## 9. Related models with `single(..., { related: [...] })`

### Related model endpoints via `single()`

`single(model, { related: [...] })` can mount child endpoints under a parent resource, e.g., `/people/:id/posts`.

Config per related item:

```js
single(Person, {
  related: [
    {
      model: Post, // required
      path: 'articles', // optional, overrides path derived from model name
      foreignKey: 'person_id', // optional, default: `${parentModelName.toLowerCase()}_id`
      operations: ['list', 'get', 'post', 'put', 'patch', 'delete'], // choose explicitly (none enabled by default)
      options: {
        // base options forwarded into child helpers
        // same knobs as list/create/update/patch/destroy options
        middleware: [ownership],
        allowFiltering: true, // list option example
        defaultPageSize: 25, // list option example
        id_mapping: 'id', // default child id mapping
        modelOptions: { attributes: { exclude: ['secret'] } }, // Sequelize options
      },
      perOperation: {
        // optional: per-op overrides
        list: { allowFiltering: false }, // e.g. lock down filters only for list
        get: { modelOptions: { attributes: ['id', 'title'] } },
        post: { middleware: [validatePostBody] },
        put: { id_mapping: 'id' },
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

- `GET /people/:id/posts` → list posts for a person
- `POST /people/:id/posts` → create a post for a person (FK auto‑injected)
- `GET /people/:id/posts/:postId` → fetch one
- `PUT /people/:id/posts/:postId` → update one
- `PATCH /people/:id/posts/:postId` → patch one
- `DELETE /people/:id/posts/:postId` → delete one

---

## 10. Member routes (follow-up routes on a single resource)

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
// GET /people/:id/profile
app.use(
  '/people',
  single(Person, {
    member_routes: [
      {
        path: 'profile',
        method: 'get',
        async handler(req) {
          const person = req.apialize.record;
          return { success: true, personName: person.name };
        },
      },
    ],
  })
);

// POST /orders/:id/cancel with extra middleware
app.use(
  '/orders',
  single(Order, {
    middleware: [requireAuth],
    member_routes: [
      {
        path: 'cancel',
        method: 'post',
        middleware: [requireRole('manager')],
        async handler(req) {
          const order = req.apialize.rawRecord; // ORM instance
          await order.update({ status: 'canceled' });
          // No return => responds with { success: true, record }
        },
      },
    ],
  })
);

// Full verb coverage example in one go
app.use(
  '/people',
  single(Person, {
    member_routes: [
      { path: 'get-verb', method: 'get', handler: (req) => ({ ok: true }) },
      {
        path: 'post-verb',
        method: 'post',
        handler: (req) => ({ posted: req.body }),
      },
      {
        path: 'put-verb',
        method: 'put',
        async handler(req) {
          await req.apialize.rawRecord.update({ name: 'put' });
          return { name: 'put' };
        },
      },
      {
        path: 'patch-verb',
        method: 'patch',
        async handler(req) {
          await req.apialize.rawRecord.update({
            name: req.apialize.rawRecord.get('name') + '~',
          });
          return { name: req.apialize.rawRecord.get('name') };
        },
      },
      {
        path: 'delete-verb',
        method: 'delete',
        async handler(req) {
          await req.apialize.rawRecord.destroy();
          return { deleted: true };
        },
      },
    ],
  })
);
```

Notes:

- `path` is required for each member route; it mounts under the same base as `single()` using `param_name` (default `'id'`).
- Use `req.apialize.record` for plain normalized data; use `req.apialize.rawRecord` for mutations and ORM methods.
- Your existing `single()` middleware (auth/ownership/etc.) runs before the member route loader, ensuring consistent scoping.

---

## 11. Nested related routes (recursion)

You can nest related definitions at any depth by attaching a `related` array on a child related item. The child `get` operation is implemented using the same core `single()` helper under the hood, so all of its behavior (middleware, `id_mapping`, `modelOptions`, and further `related` nesting) applies consistently.

Key points:

- Recursion: define `related` on any child to continue nesting (e.g., users → posts → comments → ...).
- Parent scoping: every nested level is automatically filtered by the parent through its foreign key; writes inject the correct parent foreign key automatically.
- Identifier mapping: each level can customize `id_mapping` independently.
- Param names: the parent `single()` uses `param_name` (default `'id'`). Nested levels use a child id parameter segment internally; clients see concrete values in the URL, so the actual placeholder name is only relevant if you inspect `req.params` in middleware.

Example: users → posts → comments, with external identifiers and attribute exclusions at each level:

```js
app.use(
  '/users',
  single(
    User,
    {
      // Expose users by external_id and hide internal id in responses
      id_mapping: 'external_id',
      middleware: [auth],
      related: [
        {
          model: Post,
          path: 'posts', // optional; defaults from model name
          foreignKey: 'user_id', // optional; defaults to `${parent}_id`
          options: {
            id_mapping: 'external_id',
            modelOptions: { attributes: { exclude: ['id'] } },
          },
          // Nest comments under each post
          related: [
            {
              model: Comment,
              options: {
                id_mapping: 'uuid',
                modelOptions: { attributes: { exclude: ['id', 'post_id'] } },
              },
            },
          ],
          perOperation: {
            list: { defaultPageSize: 25 },
            get: {
              modelOptions: { attributes: ['external_id', 'title', 'content'] },
            },
          },
        },
      ],
    },
    {
      // Sequelize options for the top-level single() query
      attributes: { exclude: ['id'] },
    }
  )
);
```

This mounts endpoints like:

- `GET /users/:id/posts` and `GET /users/:id/posts/:post` (id mapping applied per level)
- `POST /users/:id/posts` (FK injected)
- `GET /users/:id/posts/:post/comments` and `GET /users/:id/posts/:post/comments/:comment`
- `PUT|PATCH|DELETE` available per allowed operations at each level

Because nested `get` uses core `single()`, you get consistent 404 handling, response shape `{ success: true, record }`, and you can keep nesting by adding further `related` entries.

---

## 12. Bulk delete on related collections

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

- The bulk DELETE route is mounted only when `delete` operations are enabled AND `allow_bulk_delete` is set to `true` (disabled by default).
- The result `ids` array is derived using the configured `id_mapping` for `delete`; if none is set, `'id'` is used.
- Any scoping middleware you add (e.g., parent or ownership filters) will also apply to the bulk DELETE via `req.apialize.options.where`.

## 12. Utilities for code reuse (maintainers)

For internal consistency and to reduce repetition across operations, a few shared helpers live in `src/utils.js`:

- `filterMiddlewareFns(middleware)` – filters any non-function entries out of middleware arrays.
- `buildHandlers(middleware, handler)` – composes the standard middleware chain with request context initialization and error handling.
- `getProvidedValues(req)` – resolves input precedence for writes: `req.apialize.body` → `req.apialize.values` → `req.body` → `{}`.
- `getOwnershipWhere(req)` – pulls `req.apialize.options.where` or `{}`.
- `getIdFromInstance(instance, idMapping)` – extracts the exposed identifier from a Sequelize instance or plain object.

These are used by `create`, `update`, `patch`, and `destroy` to keep implementation small and consistent. When adding new operations, prefer these utilities to replicate the common patterns.

## License

MIT
