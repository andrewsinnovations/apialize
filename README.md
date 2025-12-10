# apialize

Turn a database model into a production ready REST(ish) CRUD API in a few lines.

## Installation

```bash
npm install apialize
```

## Quick Start

```javascript
const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const { crud } = require('apialize');

const sequelize = new Sequelize('sqlite::memory:');
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false }
});

await sequelize.sync();

const app = express();
app.use(express.json());
app.use('/users', crud(User));
app.listen(3000);
```

This creates a full REST API with the following endpoints:
- `GET /users` - List all users
- `GET /users/:id` - Get a single user
- `POST /users` - Create a user
- `PUT /users/:id` - Update a user (full replace)
- `PATCH /users/:id` - Partially update a user
- `DELETE /users/:id` - Delete a user
- `POST /users/search` - Search users with filters

## Documentation

- [List Operation](./documentation/list.md) - Complete guide to filtering, sorting, and pagination

## Basic Usage

### List Operation

List all records with filtering, sorting, and pagination support. [Full documentation](./documentation/list.md)

```javascript
const { list } = require('apialize');

app.use('/items', list(Item));
```

**Example Request:**
```bash
GET /items
GET /items?category=A&page=1&page_size=10
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Item 1", "category": "A" },
    { "id": 2, "name": "Item 2", "category": "A" }
  ],
  "meta": {
    "paging": {
      "count": 2,
      "page": 1,
      "page_size": 10
    }
  }
}
```

### Single Operation

Get a single record by ID.

```javascript
const { single } = require('apialize');

app.use('/users', single(User));
```

**Example Request:**
```bash
GET /users/1
```

**Example Response:**
```json
{
  "success": true,
  "record": {
    "id": 1,
    "name": "Alice"
  }
}
```

### Create Operation

Create a new record.

```javascript
const { create } = require('apialize');

app.use('/items', create(Item));
```

**Example Request:**
```bash
POST /items
Content-Type: application/json

{
  "external_id": "uuid-123",
  "name": "New Item",
  "desc": "Description"
}
```

**Example Response:**
```json
{
  "success": true,
  "id": 1
}
```

### Update Operation

Update a record (full replace - unspecified fields reset to defaults/null).

```javascript
const { update } = require('apialize');

app.use('/items', update(Item));
```

**Example Request:**
```bash
PUT /items/1
Content-Type: application/json

{
  "name": "Updated Name",
  "external_id": "uuid-123"
}
```

**Example Response:**
```json
{
  "success": true,
  "id": "1"
}
```

### Patch Operation

Partially update a record (only modifies provided fields).

```javascript
const { patch } = require('apialize');

app.use('/items', patch(Item));
```

**Example Request:**
```bash
PATCH /items/1
Content-Type: application/json

{
  "name": "Updated Name"
}
```

**Example Response:**
```json
{
  "success": true,
  "id": "1"
}
```

### Destroy Operation

Delete a record.

```javascript
const { destroy } = require('apialize');

app.use('/items', destroy(Item));
```

**Example Request:**
```bash
DELETE /items/1
```

**Example Response:**
```json
{
  "success": true,
  "id": "1"
}
```

### Search Operation

Search records with advanced filtering and predicates.

```javascript
const { search } = require('apialize');

app.use('/items', search(Item));
```

**Example Request:**
```bash
POST /items/search
Content-Type: application/json

{
  "filters": {
    "category": "A",
    "active": true
  },
  "page": 1,
  "page_size": 10
}
```

**Example Response:**
```json
{
  "success": true,
  "data": [
    { "id": 1, "name": "Item 1", "category": "A", "active": true }
  ],
  "meta": {
    "paging": {
      "count": 1,
      "page": 1,
      "page_size": 10
    }
  }
}
```

## Options

### ID Mapping

Use a different field as the resource identifier:

```javascript
// Use external_id instead of id
app.use('/users', single(User, { id_mapping: 'external_id' }));
app.use('/users', create(User, { id_mapping: 'external_id' }));
```

Now you can access: `GET /users/uuid-123` instead of `GET /users/1`

### Model Options

Control which fields are returned or can be modified:

```javascript
// Only return specific fields
app.use('/users', single(User, {}, { 
  attributes: ['id', 'name'] 
}));

// Control which fields can be set on create
app.use('/items', create(Item, {}, { 
  fields: ['external_id', 'name', 'desc'] 
}));
```

### Middleware

Add custom middleware for authentication, validation, or field manipulation:

```javascript
const authMiddleware = (req, res, next) => {
  // Add authentication logic
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', list(Item, { middleware: [authMiddleware] }));
```

### CRUD with All Operations

Mount all operations at once:

```javascript
const { crud } = require('apialize');

// Simple: all operations with defaults
app.use('/users', crud(User));

// With options: customize individual operations
app.use('/items', crud(Item, {
  middleware: [authMiddleware],
  routes: {
    list: { middleware: [cacheMiddleware] },
    create: { middleware: [validationMiddleware] }
  }
}));
```

## Advanced Features

### Scoping and Filtering

Automatically scope queries to the current user:

```javascript
const scopeToUser = (req, res, next) => {
  req.apialize.apply_where({ user_id: req.user.id });
  next();
};

app.use('/items', list(Item, { middleware: [scopeToUser] }));
```

### Field Manipulation

Modify values before saving:

```javascript
const prependPrefix = (req, res, next) => {
  req.apialize.values = {
    ...req.apialize.values,
    name: 'PREFIX-' + req.apialize.values.name
  };
  next();
};

app.use('/items', create(Item, { middleware: [prependPrefix] }));
```

## License

MIT

## Repository

https://github.com/andrewsinnovations/apialize
