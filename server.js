// server.js
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg');
const session = require('express-session');

const { RedisStore } = require('connect-redis');

const { createClient } = require('redis');

const bcrypt = require('bcryptjs'); // ✅ bcryptjs (stable on Windows)
require('dotenv').config();




const app = express();
const port = process.env.PORT || 3000;

/* =========================
   DATABASE
   ========================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


pool.on('error', (err) =>
  console.error('Unexpected PG idle client error', err)
);

/* =========================
   REDIS CLIENT
   ========================= */
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', err => console.error('Redis Client Error', err));

redisClient.connect()
  .then(() => console.log('Redis connected'))
  .catch(console.error);




/* =========================
   SESSION (REDIS STORE)
   ========================= */
app.use(
  session({
    store: new RedisStore({
      client: redisClient,
    }),
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);


/* =========================
   MIDDLEWARE
   ========================= */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// app.use(
//   session({
//     secret: process.env.SESSION_SECRET || 'change_this_secret',
//     resave: false,
//     saveUninitialized: false,
//     cookie: { maxAge: 24 * 60 * 60 * 1000 },
//   })
// );

/* =========================
   AUTH MIDDLEWARE
   ========================= */
function ensureAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.redirect('/admin/login');
}

function ensureUser(req, res, next) {
  if (req.session?.user) return next();
  res.redirect('/login');
}
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});


/* =========================
   COUPONS
   ========================= */
const COUPONS = {
  SAVE10: { type: 'percent', value: 10 },
  SAVE20: { type: 'percent', value: 20 },
  NEWUSER: { type: 'percent', value: 15 },
};

/* =========================
   PUBLIC ROUTES
   ========================= */

   /* =========================
   EDIT ROOM
   ========================= */

// Show edit room page
app.get('/admin/rooms/:id/edit', ensureAdmin, async (req, res) => {
  try {
    const roomRes = await pool.query(
      'SELECT * FROM rooms WHERE id=$1',
      [req.params.id]
    );

    if (roomRes.rows.length === 0) {
      return res.redirect('/admin/dashboard');
    }

    res.render('pages/admin-edit-room', {
      title: 'Edit Room',
      room: roomRes.rows[0],
      error: null
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
});

// Update room
app.post('/admin/rooms/:id/edit', ensureAdmin, async (req, res) => {
  const { room_type, price_per_night, status } = req.body;

  try {
    await pool.query(
      `
      UPDATE rooms
      SET room_type=$1, price_per_night=$2, status=$3
      WHERE id=$4
      `,
      [room_type, price_per_night, status, req.params.id]
    );

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.render('pages/admin-edit-room', {
      title: 'Edit Room',
      room: { id: req.params.id, ...req.body },
      error: 'Failed to update room'
    });
  }
});

// Delete room
app.post('/admin/rooms/:id/delete', ensureAdmin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM rooms WHERE id=$1',
      [req.params.id]
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
});


   app.get('/admin/rooms/new', ensureAdmin, (req, res) => {
  res.render('pages/admin-room-new', {
    title: 'Add Room',
    error: null,
  });
});


app.post('/admin/rooms/new', ensureAdmin, async (req, res) => {
  const { room_number, room_type, price_per_night } = req.body;

  try {
    await pool.query(
      `INSERT INTO rooms (room_number, room_type, price_per_night, status)
       VALUES ($1,$2,$3,'available')`,
      [room_number, room_type, price_per_night]
    );

    // 🔁 Clear Redis cache so new room appears
    await redisClient.del('rooms');

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.render('pages/admin-room-new', {
      title: 'Add Room',
      error: 'Error adding room',
    });
  }
});



   app.get('/admin/guests', ensureAdmin, async (req, res) => {
  try {
    const guestsRes = await pool.query(
      'SELECT * FROM guests ORDER BY created_at DESC'
    );

    res.render('pages/admin-guests', {
      title: 'All Guests',
      guests: guestsRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading guests');
  }
});

app.get('/', (req, res) =>
  res.render('pages/index', { title: 'Welcome to Ivory Haven' })
);

app.get('/about', (req, res) =>
  res.render('pages/about', { title: 'About Us' })
);

app.get('/contact', (req, res) =>
  res.render('pages/contact', { title: 'Contact Us' })
);


/* =========================
   USER LOGIN
   ========================= */
app.get('/login', (req, res) => {
  res.render('pages/login', { title: 'Login', error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const userRes = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email=$1',
      [email]
    );

    if (userRes.rows.length === 0) {
      return res.render('pages/login', {
        title: 'Login',
        error: 'Invalid email or password',
      });
    }

    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.render('pages/login', {
        title: 'Login',
        error: 'Invalid email or password',
      });
    }

    // STORE USER INFO IN SESSION (REDIS)
    req.session.user = {
      id: user.id,
      role: 'user',
      email: user.email,
    };

    res.redirect('/bookings');
  } catch (err) {
    console.error(err);
    res.render('pages/login', {
      title: 'Login',
      error: 'Server error',
    });
  }
});


/* =========================
   USER REGISTER
   ========================= */
app.get('/register', (req, res) => {
  res.render('pages/register', { title: 'Register', error: null });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    if (!name || !email || !password) {
      return res.render('pages/register', {
        title: 'Register',
        error: 'All fields are required',
      });
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE email=$1',
      [email]
    );

    if (existing.rows.length > 0) {
      return res.render('pages/register', {
        title: 'Register',
        error: 'User already exists',
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)',
      [name, email, hashedPassword]
    );

    res.redirect('/login');
  } catch (err) {
    console.error(err);
    res.render('pages/register', {
      title: 'Register',
      error: 'Server error',
    });
  }
});



/* =========================
   BOOKINGS (RESTORED)
   ========================= */
app.get('/bookings', ensureUser, async (req, res) => {
  try {
    // 1️⃣ Check Redis cache
    const cachedRooms = await redisClient.get('rooms');

    if (cachedRooms) {
      console.log('Serving rooms from Redis cache');
      return res.render('pages/bookings', {
        title: 'Book a Room',
        rooms: JSON.parse(cachedRooms),
      });
    }

    // 2️⃣ Fetch from DB if not cached
    const roomsResult = await pool.query(
      'SELECT * FROM rooms ORDER BY room_number'
    );

    // 3️⃣ Save to Redis for 60 seconds
    await redisClient.setEx(
      'rooms',
      60,
      JSON.stringify(roomsResult.rows)
    );

    res.render('pages/bookings', {
      title: 'Book a Room',
      rooms: roomsResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching room data.');
  }
});


app.post('/api/validate-coupon', (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false });

  const coupon = COUPONS[code.toUpperCase()];
  if (!coupon) return res.json({ valid: false });

  res.json({ valid: true, coupon });
});

app.post('/api/book', async (req, res) => {
  try {
    const {
      guest_name,
      guest_email,
      check_in_date,
      check_out_date,
      room_id,
      promo_code,
    } = req.body;

    if (
      !guest_name ||
      !guest_email ||
      !check_in_date ||
      !check_out_date ||
      !room_id
    ) {
      return res
        .status(400)
        .json({ success: false, message: 'All fields required' });
    }

    const overlap = await pool.query(
      `
      SELECT 1 FROM bookings
      WHERE room_id=$1
        AND status!='cancelled'
        AND check_in_date < $3::date
        AND check_out_date > $2::date
      LIMIT 1
    `,
      [room_id, check_in_date, check_out_date]
    );

    if (overlap.rows.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: 'Room already booked' });
    }

    let guestRes = await pool.query(
      'SELECT id FROM guests WHERE email=$1',
      [guest_email]
    );
    let guestId;

    if (guestRes.rows.length > 0) {
      guestId = guestRes.rows[0].id;
    } else {
      const newGuest = await pool.query(
        'INSERT INTO guests (name,email) VALUES ($1,$2) RETURNING id',
        [guest_name, guest_email]
      );
      guestId = newGuest.rows[0].id;
    }

    const priceRes = await pool.query(
      'SELECT price_per_night FROM rooms WHERE id=$1',
      [room_id]
    );

    const nights =
      (new Date(check_out_date) - new Date(check_in_date)) /
      (1000 * 60 * 60 * 24);

    let total = nights * priceRes.rows[0].price_per_night;
    let discount = 0;
    let couponUsed = null;

    if (promo_code && COUPONS[promo_code.toUpperCase()]) {
      const c = COUPONS[promo_code.toUpperCase()];
      discount = (c.value / 100) * total;
      total -= discount;
      couponUsed = promo_code.toUpperCase();
    }

    const booking = await pool.query(
      `
      INSERT INTO bookings
      (guest_id, room_id, check_in_date, check_out_date,
       total_price, discount_amount, coupon_code, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed')
      RETURNING *
    `,
      [
        guestId,
        room_id,
        check_in_date,
        check_out_date,
        total.toFixed(2),
        discount.toFixed(2),
        couponUsed,
      ]
    );

    res.json({ success: true, booking: booking.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   ADMIN AUTH (FIXED)
   ========================= */
app.get('/admin/login', (req, res) =>
  res.render('pages/admin-login', { title: 'Admin Login', error: null })
);


app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error(err);
      return res.redirect('/');
    }
    res.clearCookie('connect.sid'); // session cookie
    res.redirect('/');
  });
});


app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const adminRes = await pool.query(
      'SELECT id, username, password_hash FROM admins WHERE username=$1',
      [username]
    );

    if (adminRes.rows.length === 0) {
      return res.render('pages/admin-login', {
        title: 'Admin Login',
        error: 'Invalid username or password',
      });
    }

    const admin = adminRes.rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);

    if (!match) {
      return res.render('pages/admin-login', {
        title: 'Admin Login',
        error: 'Invalid username or password',
      });
    }

   

// ADD THIS 👇
req.session.user = {
  id: admin.id,
  role: 'admin',
  username: admin.username
};

    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.render('pages/admin-login', {
      title: 'Admin Login',
      error: 'Server error',
    });
  }
});

/* =========================
   ADMIN DASHBOARD
   ========================= */
app.get('/admin/dashboard', ensureAdmin, async (req, res) => {
  try {
    const bookingsRes = await pool.query(
      'SELECT * FROM bookings ORDER BY created_at DESC'
    );

    const roomsRes = await pool.query(
      'SELECT * FROM rooms ORDER BY room_number'
    );

    const guestsRes = await pool.query(
      'SELECT * FROM guests ORDER BY created_at DESC'
    );

    res.render('pages/admin-dashboard', {
      title: 'Admin Dashboard',
      bookings: bookingsRes.rows,
      rooms: roomsRes.rows,     // ✅ needed by EJS
      guests: guestsRes.rows,   // ✅ THIS FIXES CURRENT ERROR
      admin: { username: req.session.user.username },
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading admin dashboard');
  }
});

/* =========================
   ADMIN ACTIONS
   ========================= */

// Cancel booking (soft delete)
app.post('/admin/bookings/:id/cancel', ensureAdmin, async (req, res) => {
  try {
    await pool.query(
      'UPDATE bookings SET status=$1 WHERE id=$2',
      ['cancelled', req.params.id]
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error cancelling booking');
  }
});

// Delete booking (hard delete)
app.post('/admin/bookings/:id/delete', ensureAdmin, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM bookings WHERE id=$1',
      [req.params.id]
    );
    res.redirect('/admin/dashboard');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting booking');
  }
});


/* =========================
   SERVER
   ========================= */
app.listen(port, () => {
  console.log(`Ivory Haven running at http://localhost:${port}`);
});


