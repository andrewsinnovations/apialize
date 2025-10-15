# Related Models Example

This example demonstrates how to use the new related models feature in the `single()` endpoint.

## Usage

```javascript
const express = require('express');
const { single, create, list, update } = require('apialize');

// Assuming you have models: User, Post, Comment
// User has many Posts
// Post has many Comments

const app = express();
app.use(express.json());

// Setup basic CRUD for users
app.use('/users', create(User));
app.use('/users', list(User));
app.use('/users', update(User));

// Setup single user endpoint with related models
app.use('/users', single(User, {
  related: [
    // Basic related model - will create /users/:id/post endpoints
    { model: Post },
    
    // Custom configuration
    { 
      model: Comment, 
      foreignKey: 'author_id',  // if different from default 'user_id'
      path: 'comments',         // custom path instead of 'comment'
      options: {
        defaultPageSize: 10,    // limit comments to 10 per page
        allowFiltering: false   // disable query filtering on comments
      }
    }
  ]
}));

// This creates the following endpoints:
// GET /users/:id          - Get single user: {success: true, record: {...}}
// PUT /users/:id          - Update user: {success: true}
// GET /users/:id/post     - List all posts for user: {success: true, data: [...], meta: {...}}
// GET /users/:id/post/:postId - Get single post for user: {success: true, record: {...}}
// GET /users/:id/comments - List all comments by user: {success: true, data: [...], meta: {...}}
// GET /users/:id/comments/:commentId - Get single comment by user: {success: true, record: {...}}

app.listen(3000);
```

## API Endpoints Created

### List Related Records
- **GET** `/:id/related_model` - Returns paginated list of related records
- Filters automatically by the parent record's ID
- Supports all the same query parameters as the regular list endpoint (pagination, ordering, filtering)
- Example: `GET /users/123/post?api:page=2&api:pagesize=5`

### Single Related Record  
- **GET** `/:id/related_model/:relatedId` - Returns a single related record
- Ensures the related record belongs to the parent record
- Returns 404 if the related record doesn't exist or doesn't belong to the parent
- Example: `GET /users/123/post/456`

## Configuration Options

### Basic Configuration
```javascript
{ model: Post }
```

### Advanced Configuration
```javascript
{
  model: Post,
  foreignKey: 'author_id',    // Foreign key field (default: parentModelName_id)
  path: 'articles',           // URL path (default: snake_case of model name)
  options: {
    // All standard list/single options are supported
    middleware: [authMiddleware],
    allowFiltering: true,
    defaultPageSize: 20,
    id_mapping: 'slug'
  },
  modelOptions: {
    // Sequelize query options
    attributes: ['id', 'title', 'content'],
    include: [{ model: Tag }]
  }
}
```

## Model Name Conversion

Model names are automatically converted to snake_case for URL paths:
- `Post` → `post`
- `BlogPost` → `blog_post`  
- `RelatedThing` → `related_thing`

You can override this with the `path` option.

## Foreign Key Convention

By default, the foreign key is assumed to be `{parentModelName}_id`:
- Parent model `User` → foreign key `user_id`
- Parent model `BlogPost` → foreign key `blogpost_id`

You can override this with the `foreignKey` option.

## Error Handling

- Returns 404 if the parent record doesn't exist
- Returns 404 if a related record doesn't exist or doesn't belong to the parent
- Validates that the related model has the required methods
- Throws an error if the related model configuration is invalid