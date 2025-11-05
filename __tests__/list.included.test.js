const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const { Sequelize, DataTypes } = require('sequelize');
const { list } = require('../src');

async function buildAppAndModels() {
  const sequelize = new Sequelize('sqlite::memory:', { logging: false });
  const Artist = sequelize.define(
    'Artist',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
    },
    { tableName: 'artists_list', timestamps: false }
  );

  const Album = sequelize.define(
    'Album',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(100), allowNull: false },
      artist_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'albums_list', timestamps: false }
  );

  Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
  Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  // Mount list with include so $artist.name$ can be used via dotted filters
  app.use(
    '/albums',
    list(Album, {}, { include: [{ model: Artist, as: 'artist' }] })
  );

  return { sequelize, Artist, Album, app };
}

async function seed(Artist, Album) {
  const [prince, beethoven] = await Artist.bulkCreate(
    [{ name: 'Prince' }, { name: 'Ludwig van Beethoven' }],
    { returning: true }
  );
  await Album.bulkCreate([
    { title: 'Purple Rain', artist_id: prince.id },
    { title: '1999', artist_id: prince.id },
    { title: 'Symphony No. 5', artist_id: beethoven.id },
  ]);
}

function titles(res) {
  return res.body.data.map((r) => r.title);
}

describe('list operation: included models filtering (dotted paths)', () => {
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

    // Default equality on string is case-insensitive: lower-case query matches 'Prince'
    const res = await request(app).get(
      '/albums?artist.name=prince&api:order_by=id'
    );
    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Purple Rain', '1999']);

    // Explicit case-insensitive equality operator also works
    const res2 = await request(app).get(
      '/albums?artist.name:ieq=PRINCE&api:order_by=id'
    );
    expect(res2.status).toBe(200);
    expect(titles(res2)).toEqual(['Purple Rain', '1999']);
  });
});
