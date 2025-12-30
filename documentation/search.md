# Search Operation

The `search` operation provides a POST endpoint for searching records with advanced [filtering](filtering.md) capabilities using a request body. Unlike the `list` operation which uses query parameters, `search` accepts a JSON body allowing for complex nested filters with AND/OR logic.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Configuration Options](#configuration-options)
- [Request Body Format](#request-body-format)
- [Response Format](#response-format)
- [Filter Operators](#filter-operators)
- [Examples](#examples)
- [Search vs List](#search-vs-list)

## Basic Usage

```javascript
const { search } = require('apialize');

// Item is a sequelize model
app.use('/items', search(Item));
```

This creates a `POST /items/search` endpoint.

## Default Usage (No Configuration)

With no configuration, the search operation provides full functionality out of the box:

### Example Request

```http
POST /items/search
Content-Type: application/json

{}
```

### Example Response

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Laptop",
      "category": "electronics",
      "price": 999.99,
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-01-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "name": "Headphones",
      "category": "electronics",
      "price": 149.99,
      "created_at": "2025-01-16T14:20:00.000Z",
      "updated_at": "2025-01-16T14:20:00.000Z"
    },
    {
      "id": 3,
      "name": "Coffee Maker",
      "category": "home",
      "price": 79.99,
      "created_at": "2025-01-17T09:15:00.000Z",
      "updated_at": "2025-01-17T09:15:00.000Z"
    }
  ],
  "meta": {
    "paging": {
      "count": 3,
      "page": 1,
      "size": 100,
      "total_pages": 1
    }
  }
}
```

### Default Behavior

| Feature | Default Value |
|---------|---------------|
| Page size | 100 records |
| Order by | `id` (ascending) |
| [Filtering](filtering.md) | All fields allowed |
| Ordering | All fields allowed |

### Example with Filters and Ordering

```http
POST /items/search
Content-Type: application/json

{
  "filtering": {
    "category": "electronics"
  },
  "ordering": {
    "order_by": "price",
    "direction": "desc"
  },
  "paging": {
    "size": 10
  }
}
```

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Laptop",
      "category": "electronics",
      "price": 999.99,
      "created_at": "2025-01-15T10:30:00.000Z",
      "updated_at": "2025-01-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "name": "Headphones",
      "category": "electronics",
      "price": 149.99,
      "created_at": "2025-01-16T14:20:00.000Z",
      "updated_at": "2025-01-16T14:20:00.000Z"
    }
  ],
  "meta": {
    "paging": {
      "count": 2,
      "page": 1,
      "size": 10,
      "total_pages": 1
    }
  }
}
```

## Configuration Options

The `search` function accepts three parameters:

```javascript
search(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allow_filtering_on` | `Array<string>` \| `null` | `null` | Whitelist of fields that can be filtered. See [Filtering](filtering.md) |
| `block_filtering_on` | `Array<string>` \| `null` | `null` | Blacklist of fields that cannot be filtered. See [Filtering](filtering.md) |
| `allow_ordering_on` | `Array<string>` \| `null` | `null` | Whitelist of fields that can be used for ordering |
| `block_ordering_on` | `Array<string>` \| `null` | `null` | Blacklist of fields that cannot be used for ordering |
| `default_order_by` | `string` | `'id'` | Default field to order by |
| `default_order_dir` | `'ASC'` \| `'DESC'` | `'ASC'` | Default sort direction |
| `default_page_size` | `number` | `100` | Default number of records per page |
| `id_mapping` | `string` | `'id'` | Field to use as the resource identifier |
| `meta_show_ordering` | `boolean` | `false` | Include ordering info in response metadata |
| `middleware` | `Array<Function>` | `[]` | Express middleware functions to run before the operation |
| `pre` | `Function` \| `Array<Function>` | `null` | Hook(s) called before query execution. See [Hooks](hooks.md) |
| `post` | `Function` \| `Array<Function>` | `null` | Hook(s) called after query execution |
| `aliases` | `Object` | `null` | Map external field names to internal column names. See [Field Aliasing](aliasing.md) |
| `relation_id_mapping` | `Object` \| `Array` | `null` | Configure ID mapping for related models. See [Relation ID Mapping](relation_id_mapping.md) |
| `auto_relation_id_mapping` | `boolean` | `true` | Auto-detect ID mappings for related models. See [Relation ID Mapping](relation_id_mapping.md) |
| `flattening` | `Object` | `null` | Configuration for flattening nested relationships. See [Response Flattening](flattening.md) |
| `path` | `string` | `'/search'` | Custom mount path for the search endpoint |

#### Filtering Options

See [Filtering](filtering.md) for detailed information on filter operators and syntax.

##### `allow_filtering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null` (all fields allowed)
- **Description:** Whitelist of fields that can be filtered. When set, only these fields can be used in filters. See [Filtering](filtering.md) for available operators.

```javascript
app.use('/items', search(Item, {
  allow_filtering_on: ['category', 'status']
}));

// Allowed filter: { "filtering": { "category": "electronics" } }
// Blocked filter: { "filtering": { "name": "Product" } } returns 400
```

##### `block_filtering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null`
- **Description:** Blacklist of fields that cannot be filtered. Takes precedence over `allow_filtering_on`. See [Filtering](filtering.md).

```javascript
app.use('/items', search(Item, {
  block_filtering_on: ['password', 'secret_key']
}));
```

#### Ordering Options

##### `allow_ordering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null` (all fields allowed)
- **Description:** Whitelist of fields that can be used for ordering.

```javascript
app.use('/items', search(Item, {
  allow_ordering_on: ['name', 'created_at', 'price']
}));

// Allowed: { "ordering": { "order_by": "name" } }
// Blocked: { "ordering": { "order_by": "score" } } returns 400
```

##### `block_ordering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null`
- **Description:** Blacklist of fields that cannot be used for ordering.

```javascript
app.use('/items', search(Item, {
  block_ordering_on: ['password_hash', 'internal_score']
}));
```

##### `default_order_by`
- **Type:** `string`
- **Default:** `'id'` (or the `id_mapping` field)
- **Description:** Default field to order by when no ordering is specified in the request.

```javascript
app.use('/items', search(Item, {
  default_order_by: 'created_at'
}));
```

##### `default_order_dir`
- **Type:** `'ASC'` or `'DESC'`
- **Default:** `'ASC'`
- **Description:** Default sort direction.

```javascript
app.use('/items', search(Item, {
  default_order_by: 'created_at',
  default_order_dir: 'DESC'
}));
```

#### Pagination Options

##### `default_page_size`
- **Type:** `number`
- **Default:** `100`
- **Description:** Default number of records per page when `paging.size` is not specified.

```javascript
app.use('/items', search(Item, {
  default_page_size: 25
}));
```

#### Metadata Options

##### `meta_show_ordering`
- **Type:** `boolean`
- **Default:** `false`
- **Description:** Include ordering information in response metadata.

```javascript
app.use('/items', search(Item, {
  meta_show_ordering: true
}));

// Response includes:
// {
//   data: [...],
//   meta: {
//     ordering: [
//       { order_by: "name", direction: "ASC" }
//     ]
//   }
// }
```

#### Middleware

##### `middleware`
- **Type:** `Array<Function>`
- **Default:** `[]`
- **Description:** Array of Express middleware functions to run before the search operation.

```javascript
const authMiddleware = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', search(Item, {
  middleware: [authMiddleware]
}));
```

#### Hooks

##### `pre`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called before query execution. Can return data to pass to post hooks. See [Hooks](hooks.md) for comprehensive documentation.

```javascript
app.use('/items', search(Item, {
  pre: async (context) => {
    console.log('Pre-search hook');
    return { timestamp: Date.now() };
  }
}));
```

##### `post`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called after query execution. Can modify the response payload.

```javascript
app.use('/items', search(Item, {
  post: async (context) => {
    // Access pre hook result
    console.log('Pre result:', context.preResult);
    // Modify payload
    context.payload.meta.custom = 'value';
  }
}));
```

#### Custom Path

##### `path`
- **Type:** `string`
- **Default:** `'/search'`
- **Description:** Custom mount path for the search endpoint.

```javascript
app.use('/items', search(Item, {
  path: '/find'
}));

// Creates POST /items/find instead of POST /items/search
```

#### Field Aliases

##### `aliases`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Map external field names to internal database column names. See [Field Aliasing](aliasing.md) for comprehensive documentation.

```javascript
app.use('/items', search(Item, {
  aliases: {
    'name': 'item_name',
    'category': 'item_category'
  },
  path: '/'
}));

// Client sends: { "filtering": { "name": "Product" } }
// Translates to: WHERE item_name = 'Product'
// Response uses: { "data": [{ "name": "...", "category": "..." }] }
```

### Model Options Parameter

Standard Sequelize query options that are merged into the search query:

```javascript
app.use('/items', search(Item, {}, {
  attributes: ['id', 'name', 'category'], // Only return these fields
  include: [{
    model: User,
    as: 'owner',
    attributes: ['id', 'name']
  }],
  where: {
    archived: false  // Additional filter applied to all queries
  }
}));
```

## Request Body Format

The search request body supports three main sections:

```json
{
  "filtering": { },
  "ordering": { },
  "paging": { }
}
```

### Filtering

See [Filtering](filtering.md) for comprehensive documentation on all available filter operators.

#### Simple Equality

```json
{
  "filtering": {
    "category": "electronics",
    "status": "active"
  }
}
```

Multiple fields at the same level are implicitly combined with AND logic.

#### Operator Syntax

Use object syntax to apply operators:

```json
{
  "filtering": {
    "price": { "gte": 100 },
    "name": { "icontains": "phone" }
  }
}
```

#### AND/OR Logic

Use `and` and `or` arrays for complex boolean logic:

```json
{
  "filtering": {
    "and": [
      { "category": "electronics" },
      {
        "or": [
          { "price": { "lt": 100 } },
          { "score": { "gte": 9 } }
        ]
      }
    ]
  }
}
```

### Ordering

#### Single Field

```json
{
  "ordering": {
    "order_by": "name",
    "direction": "asc"
  }
}
```

#### Multiple Fields (Array)

```json
{
  "ordering": [
    { "order_by": "category", "direction": "asc" },
    { "order_by": "price", "direction": "desc" }
  ]
}
```

### Paging

```json
{
  "paging": {
    "page": 1,
    "size": 25
  }
}
```

## Response Format

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Item 1",
      "category": "electronics"
    }
  ],
  "meta": {
    "paging": {
      "count": 100,
      "page": 1,
      "size": 25,
      "total_pages": 4
    }
  }
}
```

With `meta_show_ordering` enabled:

```json
{
  "success": true,
  "data": [...],
  "meta": {
    "paging": { ... },
    "ordering": [
      { "order_by": "name", "direction": "ASC" }
    ]
  }
}
```

## Filter Operators

See [Filtering](filtering.md) for comprehensive documentation on all filter operators and their usage.

### Comparison Operators

| Operator | Description | Example |
|----------|-------------|---------|
| (none/equality) | Exact match | `{ "category": "electronics" }` |
| `neq` | Not equal | `{ "status": { "neq": "deleted" } }` |
| `gt` | Greater than | `{ "price": { "gt": 100 } }` |
| `gte` | Greater than or equal | `{ "price": { "gte": 100 } }` |
| `lt` | Less than | `{ "price": { "lt": 500 } }` |
| `lte` | Less than or equal | `{ "price": { "lte": 500 } }` |

### List Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `in` | In list | `{ "category": { "in": ["electronics", "books"] } }` |
| `not_in` | Not in list | `{ "status": { "not_in": ["deleted", "archived"] } }` |

### String Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `contains` | Contains substring (case-sensitive) | `{ "name": { "contains": "Phone" } }` |
| `icontains` | Contains substring (case-insensitive) | `{ "name": { "icontains": "phone" } }` |
| `not_contains` | Does not contain (case-sensitive) | `{ "name": { "not_contains": "Test" } }` |
| `not_icontains` | Does not contain (case-insensitive) | `{ "name": { "not_icontains": "test" } }` |
| `starts_with` | Starts with | `{ "name": { "starts_with": "Pro" } }` |
| `ends_with` | Ends with | `{ "name": { "ends_with": "Phone" } }` |
| `not_starts_with` | Does not start with | `{ "name": { "not_starts_with": "Test" } }` |
| `not_ends_with` | Does not end with | `{ "name": { "not_ends_with": "Draft" } }` |

### Boolean Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `is_true` | Boolean true | `{ "active": { "is_true": true } }` |
| `is_false` | Boolean false | `{ "active": { "is_false": true } }` |
| (raw boolean) | Direct boolean value | `{ "active": true }` |

## Examples

### Basic Search with Filters

See [Filtering](filtering.md) for all available filter operators.

```javascript
const { search } = require('apialize');

app.use('/items', search(Item));

// POST /items/search
// { "filtering": { "category": "electronics", "price": { "gte": 100 } } }
```

### Restricted Fields

```javascript
app.use('/items', search(Item, {
  allow_filtering_on: ['category', 'status', 'price'],
  allow_ordering_on: ['name', 'created_at', 'price'],
  default_page_size: 20
}));
```

### With Authentication Scoping

```javascript
const scopeToUser = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', search(Item, {
  middleware: [scopeToUser],
  default_order_by: 'created_at',
  default_order_dir: 'DESC'
}));
```

### Complex AND/OR Filtering

See [Filtering](filtering.md) for detailed documentation on AND/OR logic.

```javascript
// POST /items/search
{
  "filtering": {
    "and": [
      { "category": "electronics" },
      {
        "or": [
          { "price": { "lt": 100 } },
          { "name": { "icontains": "premium" } }
        ]
      }
    ]
  }
}
```

### Multi-field Ordering with Pagination

```javascript
// POST /items/search
{
  "ordering": [
    { "order_by": "category", "direction": "asc" },
    { "order_by": "price", "direction": "desc" }
  ],
  "paging": {
    "page": 2,
    "size": 25
  }
}
```

### Filtering on Included Models

When models are included via `modelOptions`, you can filter on their fields using dot notation. See [Filtering](filtering.md) for more details on filtering included models.

```javascript
app.use('/albums', search(Album, {}, {
  include: [{
    model: Artist,
    as: 'artist',
    include: [{ model: Label, as: 'label' }]
  }]
}));

// POST /albums/search
{
  "filtering": {
    "artist.label.name": "Sony"
  }
}
```

### With Hooks

```javascript
app.use('/items', search(Item, {
  pre: async (context) => {
    console.log('Query starting');
    return { startTime: Date.now() };
  },
  post: async (context) => {
    const duration = Date.now() - context.preResult.startTime;
    context.payload.meta.queryTime = duration;
  }
}));
```

## Search vs List

| Feature | Search (POST) | List (GET) |
|---------|---------------|------------|
| HTTP Method | POST | GET |
| Filters | JSON body | Query string |
| AND/OR logic | Full support | Limited |
| Bookmarkable | No | Yes |
| Cacheable | No (by default) | Yes |
| Complex queries | Better suited | Simpler queries |

Use `search` when you need:
- Complex boolean logic (AND/OR combinations)
- Many filter conditions
- Privacy (filters not visible in URL/logs)

Use `list` when you need:
- Simple filtering
- Bookmarkable/shareable URLs
- HTTP caching

## See Also

- [list](list.md) - GET-based collection retrieval
- [single](single.md) - Retrieve individual records
- [filtering](filtering.md) - Detailed filter operator documentation
