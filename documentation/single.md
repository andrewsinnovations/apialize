# Single Operation

The `single` operation provides a GET endpoint for retrieving a single record by its ID, with support for middleware, hooks, related models, custom member routes, and data flattening.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Default Usage (No Configuration)](#default-usage-no-configuration)
- [Configuration Options](#configuration-options)
- [Response Format](#response-format)
- [Examples](#examples)
- [Related Features](#related-features)

## Basic Usage

```javascript
const { single } = require('apialize');

// User is a sequelize model
app.use('/users', single(User));
```

This creates a `GET /users/:id` endpoint.

## Default Usage (No Configuration)

With no configuration, the single operation provides full functionality out of the box:

### Example Request

```http
GET /users/1
```

### Example Response

```json
{
  "success": true,
  "record": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "created_at": "2025-01-15T10:30:00.000Z",
    "updated_at": "2025-01-15T10:30:00.000Z"
  }
}
```

### Default Behavior

| Feature | Default Value |
|---------|---------------|
| ID mapping | `id` |
| Parameter name | `id` |
| Related models | None |
| Member routes | None |
| Flattening | Disabled |

## Configuration Options

The `single` function accepts three parameters:

```javascript
single(model, options, modelOptions)
```

### Options Parameter

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `id_mapping` | `string` | `'id'` | Field to use as the resource identifier |
| `param_name` | `string` | `'id'` | URL parameter name for the ID |
| `middleware` | `Array<Function>` | `[]` | Express middleware functions to run before the operation |
| `pre` | `Function` \| `Array<Function>` | `null` | Hook(s) called before query execution. See [Hooks](hooks.md) |
| `post` | `Function` \| `Array<Function>` | `null` | Hook(s) called after query execution |
| `related` | `Array<Object>` | `[]` | Configuration for related model endpoints. See [Related Models](single_related_models.md) |
| `member_routes` | `Array<Object>` | `[]` | Custom routes on the single resource. See [Member Routes](single_member_routes.md) |
| `flattening` | `Object` | `null` | Configuration for flattening nested relationships. See [Flattening](flattening.md) |
| `relation_id_mapping` | `Object` \| `Array` | `null` | Configure ID mapping for related models. See [Relation ID Mapping](relation_id_mapping.md) |
| `auto_relation_id_mapping` | `boolean` | `true` | Auto-detect ID mappings for related models. See [Relation ID Mapping](relation_id_mapping.md) |
| `aliases` | `Object` | `null` | Map external field names to internal column names. See [Field Aliasing](aliasing.md) |
| `apialize_context` | `string` | `'default'` | Context name for model-level configuration |

#### ID Mapping

##### `id_mapping`
- **Type:** `string`
- **Default:** `'id'`
- **Description:** Field to use as the resource identifier. When set, records are looked up using this field, and the field is aliased as `id` in responses (with the original field name removed).

```javascript
app.use('/users', single(User, {
  id_mapping: 'external_id'
}));

// GET /users/uuid-123
// Response: { "success": true, "record": { "id": "uuid-123", "name": "John" } }
// Note: external_id field is replaced with id in the response
```

##### `param_name`
- **Type:** `string`
- **Default:** `'id'`
- **Description:** The URL parameter name used to capture the resource identifier.

```javascript
app.use('/users', single(User, {
  param_name: 'userId'
}));

// Creates route: GET /users/:userId
```

#### Middleware

##### `middleware`
- **Type:** `Array<Function>`
- **Default:** `[]`
- **Description:** Array of Express middleware functions to run before the single operation. Middleware can modify `req.apialize` to add filters or other context.

```javascript
const scopeToOrganization = (req, res, next) => {
  req.apialize.apply_where({ organization_id: req.user.org_id });
  next();
};

app.use('/users', single(User, {
  middleware: [scopeToOrganization]
}));
```

Middleware has access to the apialize context helpers:
- `req.apialize.apply_where(whereClause)` - Add WHERE conditions
- `req.apialize.options` - Query options object

#### Hooks

##### `pre`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called before query execution. Can return data to pass to post hooks. For single operations, `context.transaction` is `undefined` (read-only operation). See [Hooks](hooks.md) for comprehensive documentation.

```javascript
app.use('/users', single(User, {
  pre: async (context) => {
    console.log('About to fetch user');
    return { startTime: Date.now() };
  }
}));
```

With multiple hooks:

```javascript
app.use('/users', single(User, {
  pre: [
    async (context) => {
      console.log('Pre hook 1');
      return { step: 1 };
    },
    async (context) => {
      console.log('Pre hook 2');
      return { step: 2, finalPre: true };  // This becomes context.preResult
    }
  ]
}));
```

##### `post`
- **Type:** `Function` or `Array<Function>`
- **Default:** `null`
- **Description:** Hook(s) called after query execution. Can modify the response payload.

```javascript
app.use('/users', single(User, {
  post: async (context) => {
    // Access pre hook result
    console.log('Pre result:', context.preResult);
    // Access the raw record
    console.log('Record:', context.record);
    // Modify payload
    context.payload.meta = { fetchTime: Date.now() };
  }
}));
```

The context object available to hooks:

| Property | Description |
|----------|-------------|
| `context.model` | The Sequelize model |
| `context.req` | Express request object |
| `context.res` | Express response object |
| `context.preResult` | Return value from pre hook(s) |
| `context.record` | The fetched Sequelize instance (after query) |
| `context.payload` | The response payload (modifiable in post hooks) |

#### Field Aliases

##### `aliases`
- **Type:** `Object`
- **Default:** `null`
- **Description:** Map external field names to internal database column names. The response will use external names. See [Field Aliasing](aliasing.md) for comprehensive documentation.

```javascript
app.use('/users', single(User, {
  aliases: {
    'userName': 'user_name',
    'emailAddress': 'email'
  }
}));

// Database has: user_name, email
// Response shows: userName, emailAddress
```

#### Relation ID Mapping

##### `relation_id_mapping`
- **Type:** `Object` or `Array`
- **Default:** `null`
- **Description:** Configure ID mapping for related/included models. When using associations with custom ID fields, this ensures nested objects and foreign keys use the correct ID mapping. See [Relation ID Mapping](relation_id_mapping.md) for comprehensive documentation.

```javascript
app.use('/users', single(User, {
  relation_id_mapping: {
    'category': 'external_id'
  }
}, {
  include: [{ model: Category, as: 'category' }]
}));
```

With array format for multiple mappings:

```javascript
app.use('/users', single(User, {
  relation_id_mapping: [
    { model: Category, id_field: 'external_id' },
    { model: Department, id_field: 'uuid' }
  ]
}));
```

##### `auto_relation_id_mapping`
- **Type:** `boolean`
- **Default:** `true`
- **Description:** When `true`, automatically detects and applies ID mappings for related models that have `apialize_id` configured in their model options. See [Relation ID Mapping](relation_id_mapping.md).

```javascript
// If Category model has: Category.options.apialize = { apialize_id: 'external_id' }
// Then auto_relation_id_mapping will automatically normalize Category.id to external_id

app.use('/users', single(User, {
  auto_relation_id_mapping: true  // default
}, {
  include: [{ model: Category }]
}));
```

#### Flattening

##### `flattening`
- **Type:** `Object` or `null`
- **Default:** `null`
- **Description:** Configuration for flattening nested relationships into the main response object. Automatically creates the necessary `include` if not explicitly provided. See [Response Flattening](flattening.md) for comprehensive documentation.

```javascript
app.use('/users', single(User, {
  flattening: {
    model: UserProfile,
    as: 'Profile',
    attributes: ['first_name', 'last_name', 'avatar_url']
  }
}));

// Without flattening:
// { id: 1, email: "john@example.com", Profile: { first_name: "John", last_name: "Doe" } }

// With flattening:
// { id: 1, email: "john@example.com", first_name: "John", last_name: "Doe" }
```

Flattening configuration options:

| Option | Type | Description |
|--------|------|-------------|
| `model` | `Model` | The Sequelize model to flatten |
| `as` | `string` | The association alias |
| `attributes` | `Array` | Fields to flatten into the main response |

See [Response Flattening](flattening.md) for additional options like `where`, `required`, `through`, and support for multiple flattenings.

You can also use attribute aliasing:

```javascript
app.use('/users', single(User, {
  flattening: {
    model: UserProfile,
    as: 'Profile',
    attributes: [
      'first_name',
      ['last_name', 'surname']  // Rename last_name to surname
    ]
  }
}));
```

### Model Options Parameter

Standard Sequelize query options that are merged into the single query:

```javascript
app.use('/users', single(User, {}, {
  attributes: ['id', 'name', 'email'],  // Only return these fields
  include: [{
    model: Department,
    as: 'department',
    attributes: ['id', 'name']
  }],
  where: {
    active: true  // Additional filter applied to all queries
  }
}));
```

Common model options:

| Option | Description |
|--------|-------------|
| `attributes` | Fields to include in the response |
| `include` | Associated models to include |
| `where` | Additional WHERE conditions |
| `scope` | Named scope to apply |
| `schema` | Database schema to use |

## Response Format

### Success Response

```json
{
  "success": true,
  "record": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "created_at": "2025-01-15T10:30:00.000Z",
    "updated_at": "2025-01-15T10:30:00.000Z"
  }
}
```

### With Associations

```json
{
  "success": true,
  "record": {
    "id": 1,
    "name": "John Doe",
    "email": "john@example.com",
    "department": {
      "id": 5,
      "name": "Engineering"
    }
  }
}
```

### Error Response - Not Found

```json
{
  "error": "Not found"
}
```

HTTP Status: `404 Not Found`

## Examples

### Basic Single Record Retrieval

```javascript
const { single } = require('apialize');

app.use('/users', single(User));

// GET /users/1
// Response: { "success": true, "record": { "id": 1, "name": "John" } }
```

### Custom ID Mapping (UUID)

```javascript
app.use('/users', single(User, {
  id_mapping: 'external_id'
}));

// GET /users/uuid-abc-123
// Looks up: WHERE external_id = 'uuid-abc-123'
// Response: { "success": true, "record": { "id": "uuid-abc-123", "name": "John" } }
```

### With Authentication Scoping

```javascript
const authMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.apialize.apply_where({ organization_id: req.user.org_id });
  next();
};

app.use('/users', single(User, {
  middleware: [authMiddleware]
}));
```

### With Associations and Flattening

```javascript
app.use('/users', single(User, {
  flattening: {
    model: UserProfile,
    as: 'Profile',
    attributes: ['first_name', 'last_name', 'bio']
  }
}, {
  include: [
    { model: Department, as: 'department', attributes: ['id', 'name'] }
  ]
}));

// Response includes flattened profile fields + nested department
```

### With Pre and Post Hooks

```javascript
app.use('/users', single(User, {
  pre: async (context) => {
    console.log(`Fetching user: ${context.req.params.id}`);
    return { startTime: Date.now() };
  },
  post: async (context) => {
    const duration = Date.now() - context.preResult.startTime;
    context.payload.meta = { queryTime: `${duration}ms` };
    
    // Optionally modify the record
    context.payload.record.fullName = 
      `${context.payload.record.first_name} ${context.payload.record.last_name}`;
  }
}));
```

### Query String Filtering

The single operation supports query string filtering to add additional WHERE conditions:

```javascript
app.use('/users', single(User));

// GET /users/1?organization_id=5
// Looks up: WHERE id = 1 AND organization_id = 5
```

This is useful for ownership validation:

```javascript
// Only returns the user if they belong to organization 5
// GET /users/1?organization_id=5

// Returns 404 if user 1 doesn't belong to organization 5
```

## Error Handling

| Status Code | Condition |
|-------------|-----------|
| `200 OK` | Record found successfully |
| `404 Not Found` | Record doesn't exist or doesn't match filters |
| `400 Bad Request` | Invalid flattening configuration |
| `500 Internal Server Error` | Database or server error |

## Related Features

For more advanced single operation features, see:

- [Member Routes](single_member_routes.md) - Add custom action routes to single resources
- [Related Models](single_related_models.md) - Nest CRUD operations under single resources

## See Also

- [list](list.md) - Retrieve multiple records with filtering and pagination
- [search](search.md) - Search for records using request body filters
- [create](create.md) - Create new records
- [update](update.md) - Full update of existing records
- [patch](patch.md) - Partial update of existing records
- [destroy](destroy.md) - Delete records
