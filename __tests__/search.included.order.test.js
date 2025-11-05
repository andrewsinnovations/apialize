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
    { tableName: 'artists_search_order', timestamps: false }
  );

  const Album = sequelize.define(
    'Album',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(100), allowNull: false },
      artist_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: 'albums_search_order', timestamps: false }
  );

  Album.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
  Artist.hasMany(Album, { as: 'albums', foreignKey: 'artist_id' });

  await sequelize.sync({ force: true });

  const app = express();
  app.use(bodyParser.json());
  app.use(
    '/albums',
    search(
      Album,
      { metaShowOrdering: true },
      { include: [{ model: Artist, as: 'artist' }] }
    )
  );

  return { sequelize, Artist, Album, app };
}

async function seed(Artist, Album) {
  const [beethoven, prince] = await Artist.bulkCreate(
    [{ name: 'Beethoven' }, { name: 'Prince' }],
    { returning: true }
  );
  await Album.bulkCreate([
    { title: 'Symphony No. 5', artist_id: beethoven.id },
    { title: '1999', artist_id: prince.id },
    { title: 'Purple Rain', artist_id: prince.id },
  ]);
}

function titles(res) {
  return res.body.data.map((r) => r.title);
}

describe('search ordering by included attribute', () => {
  let sequelize;
  afterEach(async () => {
    if (sequelize) {
      await sequelize.close();
      sequelize = null;
    }
  });

  test('order by artist.name DESC then title ASC via POST body', async () => {
    const ctx = await buildAppAndModels();
    sequelize = ctx.sequelize;
    const { Artist, Album, app } = ctx;
    await seed(Artist, Album);

    const res = await request(app)
      .post('/albums/search')
      .send({
        ordering: [
          { orderby: 'artist.name', direction: 'DESC' },
          { orderby: 'title', direction: 'ASC' },
        ],
      });
    expect(res.status).toBe(200);
    // Prince first (1999, Purple Rain), then Beethoven
    expect(titles(res)).toEqual(['1999', 'Purple Rain', 'Symphony No. 5']);
    expect(res.body.meta.order).toEqual([
      ['artist.name', 'DESC'],
      ['title', 'ASC'],
    ]);
  });
});
