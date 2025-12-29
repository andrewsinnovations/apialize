# Relation ID Mapping

Relation ID mapping allows you to use external identifiers (like UUIDs or custom IDs) when filtering, ordering, or referencing related models in your API. This keeps your API consistent when you're using custom ID fields across your models.

## Quick Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| [`relation_id_mapping`](#relation_id_mapping) | `Object` \| `Array` | `null` | Explicit mapping of related models to their ID fields |
| [`auto_relation_id_mapping`](#auto_relation_id_mapping) | `boolean` | `true` | Automatically detect and apply ID mappings |

## Supported Operations

Relation ID mapping is available on the following operations:

| Operation | Filtering | Ordering | Response Mapping | Input Mapping |
|-----------|-----------|----------|------------------|---------------|
| [list](list.md) | ✓ | ✓ | ✓ | - |
| [search](search.md) | ✓ | ✓ | ✓ | - |
| [single](single.md) | ✓ | - | ✓ | - |
| [create](create.md) | - | - | ✓ | ✓ |
| [update](update.md) | - | - | ✓ | ✓ |
| [patch](patch.md) | - | - | ✓ | ✓ |

## The Problem

When using custom ID fields (like `external_id` or `uuid`) with `id_mapping`, your API exposes these fields as `id`. However, related models also need their IDs mapped for a consistent API experience.

### Example Data

Consider a music database with `artists` and `songs` tables:

**artists table:**

| id | external_id | name |
|----|-------------|------|
| 1 | artist-beethoven | Beethoven |
| 2 | artist-mozart | Mozart |

**songs table:**

| id | external_id | title | artist_id |
|----|-------------|-------|-----------|
| 1 | song-sym5 | Symphony No. 5 | 1 |
| 2 | song-requiem | Requiem | 2 |

Note that `songs.artist_id` references `artists.id` (the internal numeric ID).

### Without Relation ID Mapping

```javascript
// Artist model uses external_id as its public ID
app.use('/artists', list(Artist, { id_mapping: 'external_id' }));

// Songs also use external_id as their public ID
app.use('/songs', list(Song, { id_mapping: 'external_id' }, {
  include: [{ model: Artist, as: 'artist' }]
}));
```

```json
{
  "data": [
    {
      "id": "song-sym5",
      "title": "Symphony No. 5",
      "artist_id": 1,
      "artist": {
        "id": 1,
        "name": "Beethoven"
      }
    }
  ]
}
```

The song's `id` is correctly mapped to the external ID, but `artist_id` and the nested `artist.id` still show internal database IDs. This inconsistency is confusing for API consumers.

### With Relation ID Mapping

```json
{
  "data": [
    {
      "id": "song-sym5",
      "title": "Symphony No. 5",
      "artist_id": "artist-beethoven",
      "artist": {
        "id": "artist-beethoven",
        "name": "Beethoven"
      }
    }
  ]
}
```

Now the API is consistent—external IDs are used everywhere.

## Automatic Relation ID Mapping (Default)

By default, `auto_relation_id_mapping` is enabled. It automatically detects related models that have `apialize_id` configured and applies the appropriate ID mapping.

### Setting Up Automatic Mapping

Configure `apialize_id` in your Sequelize model options:

```javascript
const Artist = sequelize.define('Artist', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  external_id: { type: DataTypes.STRING, unique: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false }
}, {
  tableName: 'artists',
  apialize: {
    apialize_id: 'external_id'  // This enables auto-mapping
  }
});

const Album = sequelize.define('Album', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  external_id: { type: DataTypes.STRING, unique: true, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  artist_id: { type: DataTypes.INTEGER, allowNull: false }
}, {
  tableName: 'albums',
  apialize: {
    apialize_id: 'external_id'
  }
});

// Set up associations
Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });
```

### Automatic Mapping in Action

With models configured as above, relation ID mapping works automatically:

```javascript
// No explicit relation_id_mapping needed!
app.use('/albums', list(Album, {}, {
  include: [{ model: Artist, as: 'artist' }]
}));
```

**Filter by artist's external ID:**
```http
GET /albums?artist.id=artist-beethoven
```

**Response with mapped IDs:**
```json
{
  "data": [
    {
      "id": "album-sym5",
      "title": "Symphony No. 5",
      "artist_id": "artist-beethoven",
      "artist": {
        "id": "artist-beethoven",
        "name": "Beethoven"
      }
    }
  ]
}
```

### Operations That Benefit from Auto-Mapping

#### List Operation

```javascript
app.use('/songs', list(Song, {}, {
  include: [
    { model: Artist, as: 'artist' },
    { model: Album, as: 'album' }
  ]
}));
```

```http
GET /songs?artist.id=artist-beethoven&album.id=album-sym5
```

#### Search Operation

```javascript
app.use('/songs', search(Song, {}, {
  include: [
    { model: Artist, as: 'artist' },
    { model: Album, as: 'album' }
  ]
}));
```

```http
POST /songs/search
Content-Type: application/json

{
  "filtering": {
    "artist.id": "artist-beethoven"
  }
}
```

#### Single Operation

```javascript
app.use('/albums', single(Album, {}, {
  include: [{ model: Artist, as: 'artist' }]
}));
```

```http
GET /albums/1
```

Response automatically maps `artist_id` to the external ID.

#### Create Operation

```javascript
app.use('/albums', create(Album));
```

```http
POST /albums
Content-Type: application/json

{
  "external_id": "album-new",
  "title": "New Album",
  "artist_id": "artist-beethoven"
}
```

The `artist_id` is automatically resolved from `"artist-beethoven"` to the internal numeric ID when saving to the database.

#### Update and Patch Operations

```javascript
app.use('/albums', patch(Album));
```

```http
PATCH /albums/1
Content-Type: application/json

{
  "artist_id": "artist-mozart"
}
```

The external ID is resolved to the internal ID before updating.

## Manual Relation ID Mapping

For fine-grained control, you can configure `relation_id_mapping` explicitly.

### Array Syntax

More explicit configuration with model references:

```javascript
app.use('/songs', list(Song, {
  relation_id_mapping: [
    { model: Artist, id_field: 'external_id' },
    { model: Album, id_field: 'external_id' }
  ]
}, {
  include: [
    { model: Artist, as: 'artist' },
    { model: Album, as: 'album' }
  ]
}));
```

### Partial Mapping

You can map only specific relationships:

```javascript
app.use('/songs', list(Song, {
  relation_id_mapping: [
    { model: Artist, id_field: 'external_id' }
    // Album not mapped - will use internal ID
  ]
}, {
  include: [
    { model: Artist, as: 'artist' },
    { model: Album, as: 'album' }
  ]
}));
```

**Filter by artist (uses external_id):**
```http
GET /songs?artist.id=artist-beethoven
```

**Filter by album (uses internal id):**
```http
GET /songs?album.id=1
```

## Disabling Auto-Mapping

To use internal IDs even when models have `apialize_id` configured:

```javascript
app.use('/songs', list(Song, {
  auto_relation_id_mapping: false
}, {
  include: [{ model: Artist, as: 'artist' }]
}));
```

Now filtering uses internal database IDs:

```http
GET /songs?artist.id=1
```

## Configuration Options

### relation_id_mapping

**Type:** `Object` | `Array`  
**Default:** `null`

Explicit configuration for mapping related model IDs.

**Object format:**
```javascript
relation_id_mapping: {
  'association_alias': 'id_field_name'
}
```

**Array format:**
```javascript
relation_id_mapping: [
  { model: ModelReference, id_field: 'field_name' }
]
```

When provided, this takes precedence over automatic mapping.

### auto_relation_id_mapping

**Type:** `boolean`  
**Default:** `true`

When enabled, automatically detects `belongsTo` associations where the target model has `apialize_id` configured, and applies the ID mapping.

**Requirements for auto-detection:**
1. The model must have a `belongsTo` association
2. The target model must have `options.apialize.apialize_id` set
3. `auto_relation_id_mapping` must be `true` (default)

## Filtering with Relation ID Mapping

### Simple Equality

```http
GET /songs?artist.id=artist-beethoven
```

### Filter Operators

All standard filter operators work with mapped IDs:

```http
GET /songs?artist.id:in=artist-beethoven,artist-mozart
GET /songs?album.id:neq=album-sym5
```

### Search Body Filters

```http
POST /songs/search
Content-Type: application/json

{
  "filtering": {
    "artist.id": "artist-beethoven",
    "album.id": {
      "in": ["album-sym5", "album-sym9"]
    }
  }
}
```

## Ordering with Relation ID Mapping

Order by related model's mapped ID field:

```http
GET /songs?api:order_by=artist.id
GET /songs?api:order_by=-artist.id
```

```http
POST /songs/search
Content-Type: application/json

{
  "ordering": [
    { "order_by": "artist.id", "direction": "DESC" }
  ]
}
```

## Response ID Mapping

When relation ID mapping is configured (automatically or manually), responses include mapped IDs:

### Foreign Key Fields

The foreign key field in the main record is mapped:

```json
{
  "id": 1,
  "title": "Symphony No. 5",
  "artist_id": "artist-beethoven"
}
```

### Included Model IDs

Nested included models have their IDs mapped:

```json
{
  "id": 1,
  "title": "Symphony No. 5",
  "artist_id": "artist-beethoven",
  "artist": {
    "id": "artist-beethoven",
    "name": "Beethoven"
  }
}
```

## Input ID Mapping (Create/Update/Patch)

When creating or updating records, external IDs in foreign key fields are automatically resolved to internal IDs:

```http
POST /albums
Content-Type: application/json

{
  "external_id": "album-new",
  "title": "New Album",
  "artist_id": "artist-beethoven"
}
```

The server resolves `"artist-beethoven"` to the internal integer ID before saving.

## Combining with Other Features

### With Flattening

Relation ID mapping works seamlessly with [flattening](flattening.md):

```javascript
app.use('/employees', single(Employee, {
  id_mapping: 'emp_uuid',
  relation_id_mapping: [
    { model: Department, id_field: 'dept_uuid' },
    { model: Company, id_field: 'company_uuid' }
  ],
  flattening: [
    { model: Department, as: 'Department', attributes: [['name', 'department_name']] },
    { model: Company, as: 'Company', attributes: [['name', 'company_name']] }
  ]
}, {
  include: [
    { model: Department, as: 'Department' },
    { model: Company, as: 'Company' }
  ]
}));
```

**Response:**
```json
{
  "record": {
    "id": "e1111111-1111-1111-1111-111111111111",
    "first_name": "John",
    "department_id": "d1111111-1111-1111-1111-111111111111",
    "company_id": "c1111111-1111-1111-1111-111111111111",
    "department_name": "Engineering",
    "company_name": "Tech Corp"
  }
}
```

## Best Practices

### 1. Use apialize_id Consistently

Configure `apialize_id` on all models that use custom ID fields:

```javascript
const Model = sequelize.define('Model', { /* ... */ }, {
  apialize: {
    apialize_id: 'external_id'
  }
});
```

This enables automatic mapping across your entire API.

### 2. Let Auto-Mapping Do the Work

In most cases, you don't need explicit `relation_id_mapping`. Configure your models properly and let `auto_relation_id_mapping` handle it.

### 3. Use Manual Mapping for Edge Cases

Only use explicit `relation_id_mapping` when:
- A model doesn't have `apialize_id` configured
- You need different ID fields for different endpoints
- You want to override automatic detection

### 4. Keep IDs Consistent

If `Artist` uses `external_id` in one endpoint, it should use it everywhere. This makes your API predictable for consumers.

## Related Documentation

- [list](list.md) - List operation with relation ID mapping
- [search](search.md) - Search operation with relation ID mapping
- [single](single.md) - Single operation with relation ID mapping
- [create](create.md) - Create operation with input ID mapping
- [Flattening](flattening.md) - Flatten nested relationships
- [Filtering](filtering.md) - Filter operators for relation fields
