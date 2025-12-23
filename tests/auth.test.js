const request = require('supertest');

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    on: jest.fn()   // fix pool.on() error
  };
  return { Pool: jest.fn(() => mPool) };
});

const app = require('../server');

describe('Admin login', () => {
  it('rejects missing credentials', async () => {
    const res = await request(app).post('/admin/login').send({});
    expect(res.status).toBe(200);
    expect(res.text).toContain('Missing credentials');
  });
});
