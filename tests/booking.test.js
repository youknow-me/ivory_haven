const request = require('supertest');

jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    on: jest.fn()   // fix pool.on() error
  };
  return { Pool: jest.fn(() => mPool) };
});

const app = require('../server');

describe('Booking API', () => {
  const { Pool } = require('pg');
  const pool = new Pool();

  beforeEach(() => jest.clearAllMocks());

  it('rejects double booking', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const res = await request(app).post('/api/book').send({
      guest_name: 'A',
      guest_email: 'a@example.com',
      check_in_date: '2025-12-01',
      check_out_date: '2025-12-03',
      room_id: 1
    });

    expect(res.status).toBe(409);
  });
});
