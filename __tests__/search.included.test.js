const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { search } = require('../src');

async function buildAppAndModels() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Artist = sequelize.define(
    'Artist',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { tableName: 'artists', timestamps: false }
  );

  const Album = sequelize.define(
    'Album',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(100), allowNull: false },
      artist_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'albums', timestamps: false }
  );

  Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
  Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  // Mount search with include so $artist.name$ can be used
  app.use(
    '/albums',
    search(Album, {}, { include: [{ model: Artist, as: 'artist' }] })
  );

  return { sequelize, Artist, Album, app };
}

async function seed(Artist, Album) {
  const [a1, a2] = await Artist.bulkCreate(
    [{ name: 'Ludwig van Beethoven' }, { name: 'Wolfgang Amadeus Mozart' }],
    { returning: true }
  );
  await Album.bulkCreate([
    { title: 'Symphony No. 5', artist_id: a1.id },
    { title: 'Symphony No. 9', artist_id: a1.id },
    { title: 'Requiem', artist_id: a2.id },
  ]);
}

function titles(res) {
  return res.body.data.map((r) => r.title);
}

describe('search operation: included models filtering', () => {
  let sequelize;

  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('filters by included association attribute using dotted path', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, app } = ctx;

    await seed(Artist, Album);

    // Equality match on included model attribute
    const res1 = await request(app)
      .post('/albums/search')
      .send({ filters: { 'artist.name': 'Ludwig van Beethoven' } });

    expect(res1.status).toBe(200);
    expect(titles(res1)).toEqual(['Symphony No. 5', 'Symphony No. 9']);

    // Case-insensitive contains on included attribute
    const res2 = await request(app)
      .post('/albums/search')
      .send({ filters: { 'artist.name': { icontains: 'mozart' } } });

    expect(res2.status).toBe(200);
    expect(titles(res2)).toEqual(['Requiem']);
  });
});
