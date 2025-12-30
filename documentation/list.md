# List Operation

The `list` operation provides a GET endpoint for retrieving collections of records with filtering, sorting, and pagination support.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Configuration Options](#configuration-options)
- [Query String Parameters](#query-string-parameters)
- [Response Format](#response-format)
- [Examples](#examples)
- [Model Configuration](#model-configuration)

## Basic Usage

```javascript
const { list } = require('apialize');

// Item is a sequelize model
app.use('/items', list(Item));
```

This creates a `GET /items` endpoint.

## Default Usage (No Configuration)

With no configuration, the list operation provides full functionality out of the box:

### Example Request

```http
GET /items
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
| Filtering | All fields allowed |
| Ordering | All fields allowed |

### Example with Query Parameters

Lets order by price descending, with a page size of 10.

```http
GET /items?category=electronics&api:order_by=-price&api:page_size=10
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

The `list` function accepts three parameters:

```javascript
list(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allow_filtering_on` | `Array<string>` \| `null` | `null` | Whitelist of fields that can be filtered |
| `block_filtering_on` | `Array<string>` \| `null` | `null` | Blacklist of fields that cannot be filtered |
| `allow_filtering` | `boolean` | `true` | Enable/disable all query string filtering |
| `allow_ordering_on` | `Array<string>` \| `null` | `null` | Whitelist of fields that can be used for ordering |
| `block_ordering_on` | `Array<string>` \| `null` | `null` | Blacklist of fields that cannot be used for ordering |
| `allow_ordering` | `boolean` | `true` | Enable/disable query string ordering |
| `default_order_by` | `string` | `'id'` | Default field to order by |
| `default_order_dir` | `'ASC'` \| `'DESC'` | `'ASC'` | Default sort direction |
| `default_page_size` | `number` | `100` | Default number of records per page |
| `id_mapping` | `string` | `'id'` | Field to use as the resource identifier |
| `meta_show_filters` | `boolean` | `false` | Include applied filters in response metadata |
| `meta_show_ordering` | `boolean` | `false` | Include ordering info in response metadata |
| `middleware` | `Array<Function>` | `[]` | Express middleware functions to run before the operation |
| `pre` | `Function` \| `Array<Function>` | `null` | Hook(s) called before query execution. See [Hooks](hooks.md) |
| `post` | `Function` \| `Array<Function>` | `null` | Hook(s) called after query execution |
| `aliases` | `Object` | `null` | Map external field names to internal column names. See [Field Aliasing](aliasing.md) |
| `relation_id_mapping` | `Object` \| `Array` | `null` | Configure ID mapping for related models. See [Relation ID Mapping](relation_id_mapping.md) |
| `auto_relation_id_mapping` | `boolean` | `true` | Auto-detect ID mappings for related models. See [Relation ID Mapping](relation_id_mapping.md) |
| `flattening` | `Object` | `null` | Configuration for flattening nested relationships. See [Flattening](flattening.md) |
| `disable_subquery` | `boolean` | `true` | Disable subQuery for Sequelize include operations |

#### Filtering Options

See [Filtering](filtering.md) for detailed information on filter operators and syntax.

##### `allow_filtering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null` (all fields allowed)
- **Description:** Whitelist of fields that can be filtered. When set, only these fields can be used in query string filters. See [Filtering](filtering.md) for available operators.

```javascript
app.use('/items', list(Item, {
  allow_filtering_on: ['category', 'status']
}));

// Allowed: GET /items?category=electronics
// Blocked: GET /items?name=Product (returns 400)
```

##### `block_filtering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null`
- **Description:** Blacklist of fields that cannot be filtered. Takes precedence over `allow_filtering_on`. See [Filtering](filtering.md).

```javascript
app.use('/items', list(Item, {
  block_filtering_on: ['password', 'secret_key']
}));
```

##### `allow_filtering`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** When `false`, disables all query string filtering. Users can still fetch all records but cannot filter them. See [Filtering](filtering.md).

```javascript
app.use('/items', list(Item, {
  allow_filtering: false
}));
```

#### Ordering Options

##### `allow_ordering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null` (all fields allowed)
- **Description:** Whitelist of fields that can be used for ordering.

```javascript
app.use('/items', list(Item, {
  allow_ordering_on: ['name', 'created_at', 'score']
}));

// Allowed: GET /items?api:order_by=name
// Blocked: GET /items?api:order_by=price (returns 400)
```

##### `block_ordering_on`
- **Type:** `Array<string>` or `null`
- **Default:** `null`
- **Description:** Blacklist of fields that cannot be used for ordering.

```javascript
app.use('/items', list(Item, {
  block_ordering_on: ['password_hash', 'internal_score']
}));
```

##### `allow_ordering`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** When `false`, disables query string ordering. Results use the default order only.

```javascript
app.use('/items', list(Item, {
  allow_ordering: false
}));
```

##### `default_order_by`
- **Type:** `string`
- **Default:** `'id'` (or the `id_mapping` field)
- **Description:** Default field to order by when no `api:order_by` is specified.

```javascript
app.use('/items', list(Item, {
  default_order_by: 'created_at'
}));
```

##### `default_order_dir`
- **Type:** `'ASC'` or `'DESC'`
- **Default:** `'ASC'`
- **Description:** Default sort direction.

```javascript
app.use('/items', list(Item, {
  default_order_by: 'created_at',
  default_order_dir: 'DESC'
}));
```

#### Pagination Options

##### `default_page_size`
- **Type:** `number`
- **Default:** `100`
- **Description:** Default number of records per page when `api:page_size` is not specified.

```javascript
app.use('/items', list(Item, {
  default_page_size: 25
}));
```

#### ID Mapping

##### `id_mapping`
- **Type:** `string`
- **Default:** `'id'`
- **Description:** Field to use as the resource identifier. When set, records are ordered by this field by default, and the field is aliased as `id` in responses.

```javascript
app.use('/items', list(Item, {
  id_mapping: 'external_id'
}));

// Records ordered by external_id by default
// Response: { id: "uuid-123", name: "Item" } (no external_id field)
```

#### Metadata Options

##### `meta_show_filters`
- **Type:** `boolean`
- **Default:** `false`
- **Description:** Include applied filters in response metadata. See [Filtering](filtering.md) for details on filter syntax.

```javascript
app.use('/items', list(Item, {
  meta_show_filters: true
}));

// Response includes:
// { 
//   data: [...],
//   meta: {
//     filtering: { category: "electronics" }
//   }
// }
```

##### `meta_show_ordering`
- **Type:** `boolean`
- **Default:** `false`
- **Description:** Include ordering information in response metadata.

```javascript
app.use('/items', list(Item, {
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
- **Description:** Array of Express middleware functions to run before the list operation.

```javascript
const authMiddleware = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', list(Item, {
  middleware: [authMiddleware]
}));
```

#### Hooks

##### `pre`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called before query execution. Can return data to pass to post hooks. See [Hooks](hooks.md) for comprehensive documentation.

```javascript
app.use('/items', list(Item, {
  pre: async (context) => {
    console.log('Pre-list hook');
    return { timestamp: Date.now() };
  }
}));
```

##### `post`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called after query execution. Can modify the response payload.

```javascript
app.use('/items', list(Item, {
  post: async (context) => {
    // Access pre hook result
    console.log('Pre result:', context.preResult);
    // Modify payload
    context.payload.meta.custom = 'value';
  }
}));
```

#### Field Aliases

##### `aliases`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Map external field names to internal database column names. See [Field Aliasing](aliasing.md) for comprehensive documentation.

```javascript
app.use('/items', list(Item, {
  aliases: {
    'name': 'item_name',
    'category': 'item_category'
  }
}));

// Client uses: GET /items?name=Product
// Translates to: WHERE item_name = 'Product'
```

#### Relation ID Mapping

##### `relation_id_mapping`
- **Type:** `Object` or `Array`
- **Default:** `null`
- **Description:** Configure ID mapping for related models when filtering, ordering, or in responses. See [Relation ID Mapping](relation_id_mapping.md) for comprehensive documentation.

```javascript
app.use('/items', list(Item, {
  relation_id_mapping: {
    'category': 'external_id'
  }
}));
```

##### `auto_relation_id_mapping`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** Automatically detect and apply ID mappings for related models that have `apialize_id` configured. See [Relation ID Mapping](relation_id_mapping.md).

#### Advanced Options

##### `flattening`
- **Type:** `Object` or `null`
- **Default:** `null`
- **Description:** Configuration for flattening nested relationships into the main response. See [Response Flattening](flattening.md) for comprehensive documentation.

##### `disable_subquery`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** When true, disables subQuery for Sequelize include operations to improve performance. Also accepts the longer form `disable_subquery_on_include_request`.

### Model Options Parameter

Standard Sequelize query options that are merged into the list query:

```javascript
app.use('/items', list(Item, {}, {
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

## Query String Parameters

### Filtering

See [Filtering](filtering.md) for comprehensive documentation on filter operators and syntax.

Basic equality filter:
```
GET /items?category=electronics
```

Filter operators:
- `:icontains` - Case-insensitive contains
- `:not_icontains` - Case-insensitive does not contain
- `:starts_with` - Starts with
- `:ends_with` - Ends with
- `:gte` - Greater than or equal
- `:gt` - Greater than
- `:lte` - Less than or equal
- `:lt` - Less than
- `:in` - In list (comma-separated)
- `:not_in` - Not in list
- `:neq` - Not equal

```
GET /items?name:icontains=phone
GET /items?price:gte=100
GET /items?category:in=electronics,books
```

Filtering on included models (use dot notation):
```
GET /items?Parent.parent_name=Acme
```

### Ordering

Single field:
```
GET /items?api:order_by=name
GET /items?api:order_by=-name  (DESC with minus prefix)
```

Multiple fields with global direction:
```
GET /items?api:order_by=category,name&api:order_dir=ASC
```

### Pagination

```
GET /items?api:page=1&api:page_size=25
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
      "count": 100,      // Total number of records
      "page": 1,         // Current page
      "size": 25,        // Page size
      "total_pages": 4   // Total pages
    }
  }
}
```

With `meta_show_filters` and `meta_show_ordering` enabled:

```json
{
  "success": true,
  "data": [...],
  "meta": {
    "paging": { ... },
    "filtering": {
      "category": "electronics"
    },
    "ordering": [
      { "order_by": "name", "direction": "ASC" }
    ]
  }
}
```

## Examples

### Basic List with Filters

```javascript
const { list } = require('apialize');

app.use('/items', list(Item));

// GET /items?category=electronics&price:gte=100
```

### Restricted Fields

```javascript
app.use('/items', list(Item, {
  allow_filtering_on: ['category', 'status'],
  allow_ordering_on: ['name', 'created_at'],
  default_page_size: 20
}));
```

### With Authentication Scoping

```javascript
const scopeToUser = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', list(Item, {
  middleware: [scopeToUser],
  default_order_by: 'created_at',
  default_order_dir: 'DESC'
}));
```

### Custom ID Mapping

```javascript
app.use('/items', list(Item, {
  id_mapping: 'external_id',
  meta_show_ordering: true
}, {
  attributes: [['external_id', 'id'], 'name', 'category']
}));

// Response uses external_id as id:
// { "id": "uuid-123", "name": "Item" }
```

### With Hooks

```javascript
app.use('/items', list(Item, {
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

## Model Configuration

You can also set defaults in the model's `apialize` property:

```javascript
Item.apialize = {
  page_size: 50,
  orderby: 'created_at',
  orderdir: 'DESC'
};

app.use('/items', list(Item));
```

These are used as defaults when options are not specified in the `list()` call.
