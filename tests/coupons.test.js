// tests/coupons.test.js
const request = require('supertest');
const app = require('../server');

describe('Coupons', () => {
  it('invalid coupon returns invalid', async () => {
    const res = await request(app).post('/api/validate-coupon').send({ code: 'BADCODE' });
    expect(res.body.valid).toBe(false);
  });

  it('valid coupon returns coupon info', async () => {
    const res = await request(app).post('/api/validate-coupon').send({ code: 'SAVE10' });
    expect(res.body.valid).toBe(true);
    expect(res.body.coupon.value).toBe(10);
  });
});
