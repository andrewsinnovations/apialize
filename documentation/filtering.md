# Filtering

Apialize provides powerful filtering capabilities for both the `list` and `search` operations. This guide covers filter operators, syntax, and configuration options.

## Overview

| Operation | Method | Filter Location | Syntax Style |
|-----------|--------|-----------------|--------------|
| [list](list.md) | GET | Query string | `?field:operator=value` |
| [search](search.md) | POST | Request body | `{ "filtering": { "field": { "operator": value } } }` |

Both operations support the same filtering capabilities, just with different syntax.

## Filter Operators

### Equality & Comparison

| Operator | List Syntax | Search Syntax | Description |
|----------|-------------|---------------|-------------|
| Equality | `?field=value` | `{ "field": "value" }` | Exact match (case-sensitive) |
| Case-insensitive equality | `?field:ieq=value` | `{ "field": { "ieq": "value" } }` | Exact match (case-insensitive) |
| Not equal | `?field:neq=value` | `{ "field": { "neq": "value" } }` | Not equal to |
| Greater than | `?field:gt=value` | `{ "field": { "gt": value } }` | Greater than |
| Greater or equal | `?field:gte=value` | `{ "field": { "gte": value } }` | Greater than or equal |
| Less than | `?field:lt=value` | `{ "field": { "lt": value } }` | Less than |
| Less or equal | `?field:lte=value` | `{ "field": { "lte": value } }` | Less than or equal |

### String Matching

| Operator | List Syntax | Search Syntax | Description |
|----------|-------------|---------------|-------------|
| Contains | `?field:contains=value` | `{ "field": { "contains": "value" } }` | Contains substring (case-sensitive) |
| Contains (case-insensitive) | `?field:icontains=value` | `{ "field": { "icontains": "value" } }` | Contains substring (case-insensitive) |
| Not contains | `?field:not_contains=value` | `{ "field": { "not_contains": "value" } }` | Does not contain (case-sensitive) |
| Not contains (case-insensitive) | `?field:not_icontains=value` | `{ "field": { "not_icontains": "value" } }` | Does not contain (case-insensitive) |
| Starts with | `?field:starts_with=value` | `{ "field": { "starts_with": "value" } }` | Starts with string |
| Not starts with | `?field:not_starts_with=value` | `{ "field": { "not_starts_with": "value" } }` | Does not start with string |
| Ends with | `?field:ends_with=value` | `{ "field": { "ends_with": "value" } }` | Ends with string |
| Not ends with | `?field:not_ends_with=value` | `{ "field": { "not_ends_with": "value" } }` | Does not end with string |

### List & Boolean

| Operator | List Syntax | Search Syntax | Description |
|----------|-------------|---------------|-------------|
| In list | `?field:in=a,b,c` | `{ "field": { "in": ["a", "b", "c"] } }` | Value is in list |
| Not in list | `?field:not_in=a,b,c` | `{ "field": { "not_in": ["a", "b", "c"] } }` | Value is not in list |
| Is true | `?field:is_true` | `{ "field": { "is_true": true } }` | Boolean field is true |
| Is false | `?field:is_false` | `{ "field": { "is_false": true } }` | Boolean field is false |

## List Operation Filtering

The list operation uses query string parameters for filtering.

### Basic Equality

```http
GET /items?category=electronics
GET /items?status=active&type=product
```

### Using Operators

Append the operator to the field name with a colon:

```http
GET /items?name:icontains=phone
GET /items?price:gte=100
GET /items?price:lt=500
GET /items?category:in=electronics,books,toys
GET /items?status:neq=deleted
```

### Combining Filters

Multiple filters are combined with AND logic:

```http
GET /items?category=electronics&price:gte=100&price:lte=500
```

This returns items where category is "electronics" AND price is between 100 and 500.

### Filtering on Related Models

Use dot notation to filter on included/associated models:

```http
GET /items?Category.name=Electronics
GET /items?Owner.email:icontains=@company.com
```

## Search Operation Filtering

The search operation uses a JSON request body for filtering.

### Basic Equality

```json
POST /items/search
{
  "filtering": {
    "category": "electronics",
    "status": "active"
  }
}
```

### Using Operators

Use the operator name as the key within the field object:

```json
POST /items/search
{
  "filtering": {
    "name": { "icontains": "phone" },
    "price": { "gte": 100, "lte": 500 },
    "category": { "in": ["electronics", "books"] }
  }
}
```

### Multiple Conditions on Same Field

```json
{
  "filtering": {
    "price": {
      "gte": 100,
      "lte": 500
    },
    "created_at": {
      "gte": "2025-01-01",
      "lt": "2025-02-01"
    }
  }
}
```

## Configuration Options

Control filtering behavior through operation options:

### `allow_filtering_on`

Whitelist specific fields that can be filtered:

```javascript
app.use('/items', list(Item, {
  allow_filtering_on: ['category', 'status', 'price']
}));

// Allowed: GET /items?category=electronics
// Blocked: GET /items?secret_field=value (returns 400)
```

### `block_filtering_on`

Blacklist specific fields from filtering. Takes precedence over `allow_filtering_on`:

```javascript
app.use('/items', list(Item, {
  block_filtering_on: ['password', 'secret_key', 'internal_id']
}));
```

### `allow_filtering`

Disable all filtering entirely:

```javascript
app.use('/items', list(Item, {
  allow_filtering: false
}));

// All filter parameters are ignored
// Users can only fetch unfiltered results
```

### `meta_show_filters`

Include applied filters in the response metadata:

```javascript
app.use('/items', list(Item, {
  meta_show_filters: true
}));
```

Response:

```json
{
  "success": true,
  "data": [...],
  "meta": {
    "paging": { ... },
    "filtering": {
      "category": "electronics",
      "price": { "gte": 100 }
    }
  }
}
```

## Examples

### Price Range Filter

**List:**
```http
GET /items?price:gte=50&price:lte=200
```

**Search:**
```json
{
  "filtering": {
    "price": { "gte": 50, "lte": 200 }
  }
}
```

### Text Search

**List:**
```http
GET /items?name:icontains=laptop&description:icontains=gaming
```

**Search:**
```json
{
  "filtering": {
    "name": { "icontains": "laptop" },
    "description": { "icontains": "gaming" }
  }
}
```

### Category Selection

**List:**
```http
GET /items?category:in=electronics,computers,accessories
```

**Search:**
```json
{
  "filtering": {
    "category": { "in": ["electronics", "computers", "accessories"] }
  }
}
```

### Date Range

**List:**
```http
GET /items?created_at:gte=2025-01-01&created_at:lt=2025-02-01
```

**Search:**
```json
{
  "filtering": {
    "created_at": {
      "gte": "2025-01-01",
      "lt": "2025-02-01"
    }
  }
}
```

### Exclude Deleted Items

**List:**
```http
GET /items?status:neq=deleted
```

**Search:**
```json
{
  "filtering": {
    "status": { "neq": "deleted" }
  }
}
```

## See Also

- [list](list.md) - GET-based collection retrieval
- [search](search.md) - POST-based search with request body
